"""Защита браузерного движка: что Chromium не должен уметь на нашем сервере.

Сервер стоит рядом с базой и секретами, а страницу пишет чужая сторона.
Проверка хоста в JupiterBrowserEngine._route закрывает основное, но остаются
щели, которые страница открывает сама:

1. DNS rebinding. _route проверил имя, а Chromium резолвит его второй раз при
   подключении — и получает уже 127.0.0.1. Закрывается пиннингом: браузеру
   запускают с --host-resolver-rules "MAP host <проверенный IP>", повторного
   DNS-запроса для этих имён нет (chromium_args_for_pins).
2. Новые вкладки (window.open, target=_blank): _route смотрит только главный
   фрейм своей вкладки, попап уходил куда угодно. Разрешённый хост — открываем
   в той же вкладке, остальное закрываем.
3. Диалоги (alert/confirm/beforeunload вешают страницу), загрузки, выбор файла
   (только файл резюме), запросы разрешений (геолокация, камера), WebRTC
   (утечка внутреннего IP), service worker (живёт мимо route), file://.
4. Изоляция: контекст на задачу, куки кандидатов не смешиваются.

Модуль зависит только от stdlib; Playwright получает объектами снаружи.
"""
from __future__ import annotations

import ipaddress
import os
import urllib.parse
from contextlib import contextmanager
from typing import Any, Iterator

from policy import NetworkPolicy, PolicyError, is_blocked_address, literal_loopback


class GuardError(RuntimeError):
    pass


# Флаги запуска Chromium. К прежним "--disable-dev-shm-usage", "--no-first-run"
# добавлено то, что режет утечки и фоновую сеть.
CHROMIUM_SAFE_ARGS = [
    "--disable-dev-shm-usage",
    "--no-first-run",
    # WebRTC не раскрывает внутренние адреса сервера (ICE-кандидаты).
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    # Запросы разрешений (геолокация, камера, уведомления) — сразу отказ.
    "--deny-permission-prompts",
    "--disable-notifications",
    "--mute-audio",
    # Никакой фоновой сети браузера: обновления, синхронизация, телеметрия.
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-breakpad",
    "--disable-client-side-phishing-detection",
    "--metrics-recording-only",
    "--no-pings",
]

# Опции new_context(): service worker живёт мимо context.route, поэтому запрет.
CONTEXT_SAFE_OPTIONS: dict[str, Any] = {
    "accept_downloads": False,
    "service_workers": "block",
    "permissions": [],
    "geolocation": None,
    "bypass_csp": False,
}

# Скрипт до кода страницы: WebRTC и service worker недоступны совсем (второй
# рубеж к флагам). Карьерным анкетам ни то, ни другое не нужно.
INIT_SCRIPT = """
(() => {
  for (const n of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
    try { Object.defineProperty(window, n, { value: undefined, configurable: false }); } catch (e) {}
  }
  try { Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined, configurable: false }); } catch (e) {}
})();
"""

_ALLOWED_PAGE_SCHEMES = {"http", "https", "about", "data", "blob"}


def resolve_pins(hosts, *, allow_private: bool = False) -> dict[str, str]:
    """Имя -> проверенный IP для запуска браузера. Адреса-литералы пропускаем.

    Вызывать ДО запуска Chromium (см. README-вставку в отчёте): флаги
    фиксируются при старте процесса.
    """
    pins: dict[str, str] = {}
    policy = NetworkPolicy(set(hosts), allow_private=allow_private)
    for host in sorted({h.lower() for h in hosts}):
        if literal_loopback(host) or _is_ip(host.strip("[]")):
            continue
        try:
            addresses = policy.check_url(f"https://{host}/", resolve=True)
        except PolicyError as exc:
            raise GuardError(str(exc)) from exc
        pins[host] = addresses[0]
    return pins


def _is_ip(raw: str) -> bool:
    try:
        ipaddress.ip_address(raw)
    except ValueError:
        return False
    return True


def chromium_args_for_pins(
    pins: dict[str, str], *, strict: bool = False, allow_private: bool = False
) -> list[str]:
    """CHROMIUM_SAFE_ARGS + --host-resolver-rules с пиннингом имён на IP.

    Браузер не спрашивает DNS для имён из pins, поэтому между проверкой и
    подключением нет окна для rebinding. strict=True — все остальные имена не
    резолвятся вовсе (сторонние CDN тогда не загрузятся; включать, когда их
    список известен и добавлен в pins). strict=False — остальные имена идут
    обычным DNS и защищены только проверкой в _route (окно остаётся).
    """
    rules: list[str] = []
    for host, ip in pins.items():
        host = host.strip().lower()
        if not host or any(c in host for c in " ,*"):
            raise GuardError(f"Недопустимое имя для пиннинга: {host!r}")
        try:
            address = ipaddress.ip_address(ip)
        except ValueError as exc:
            raise GuardError(f"Не IP-адрес для {host}: {ip!r}") from exc
        if is_blocked_address(ip) and not allow_private:
            raise GuardError(f"{host} закреплён за внутренним адресом {ip}")
        target = f"[{ip}]" if address.version == 6 else ip
        rules.append(f"MAP {host} {target}")
    if strict:
        rules.append("MAP * ~NOTFOUND")
    args = list(CHROMIUM_SAFE_ARGS)
    if rules:
        args.append("--host-resolver-rules=" + ", ".join(rules))
    return args


def check_upload_paths(paths, resume_paths) -> list[str]:
    """Пути к загрузке — только из списка резюме (после realpath, без симлинков)."""
    allowed = {os.path.realpath(p) for p in resume_paths}
    out = []
    for path in paths:
        real = os.path.realpath(str(path))
        if real not in allowed:
            raise GuardError(f"Файл не из списка резюме: {path}")
        out.append(real)
    return out


@contextmanager
def isolated_context(browser, **options) -> Iterator[Any]:
    """Свежий контекст на одну задачу: свои куки, storage, кэш. Закрывается сам."""
    context = browser.new_context(**{**CONTEXT_SAFE_OPTIONS, **options})
    try:
        yield context
    finally:
        try:
            context.close()
        except Exception:  # pragma: no cover - браузер мог уже упасть
            pass


def install_guards(
    context,
    page,
    allowed_hosts,
    resume_paths,
    *,
    journal: list | None = None,
    confirm_accept: bool = False,
) -> list:
    """Повесить защиту на контекст и вкладку; вернуть журнал того, что сделано.

    allowed_hosts читается живьём (агент дополняет множество по ходу).
    journal можно передать движку: install_guards(..., journal=self.actions).
    """
    log: list = journal if journal is not None else []
    resumes = [os.path.realpath(p) for p in resume_paths]

    def note(action: str, **data: Any) -> None:
        log.append({"action": action, **data})

    def host_allowed(url: str) -> bool:
        parsed = urllib.parse.urlparse(url)
        if (parsed.scheme or "").lower() not in {"http", "https"}:
            return False
        host = (parsed.hostname or "").lower()
        return bool(host) and host in {h.lower() for h in allowed_hosts}

    context.add_init_script(INIT_SCRIPT)
    try:
        context.clear_permissions()
    except Exception:  # pragma: no cover
        pass

    # Маршрут вешается позже маршрута движка, значит срабатывает раньше него.
    def route(rt, request) -> None:
        url = request.url
        scheme = (urllib.parse.urlparse(url).scheme or "").lower()
        if scheme in {"data", "blob", "about"}:
            rt.fallback()
            return
        if scheme not in {"http", "https"}:
            note("guard_blocked", url=url[:200], reason="scheme")
            rt.abort("blockedbyclient")
            return
        try:
            is_popup = request.frame.page is not page
        except Exception:
            # «Frame не создан»: так выглядит первый запрос нового окна.
            is_popup = request.is_navigation_request()
        if is_popup and request.is_navigation_request() and not host_allowed(url):
            note("guard_blocked", url=url[:200], reason="popup_host_not_allowed")
            rt.abort("blockedbyclient")
            return
        rt.fallback()

    context.route("**/*", route)

    def on_dialog(dialog) -> None:
        kind = dialog.type
        accept = kind in {"alert", "beforeunload"} or (kind == "confirm" and confirm_accept)
        note("guard_dialog", type=kind, message=(dialog.message or "")[:200], accepted=accept)
        try:
            dialog.accept() if accept else dialog.dismiss()
        except Exception:  # pragma: no cover - страница уже закрылась
            pass

    def on_download(download) -> None:
        note("guard_download", url=download.url[:200])
        try:
            download.cancel()
        except Exception:  # pragma: no cover
            pass

    def on_filechooser(chooser) -> None:
        files = resumes if chooser.is_multiple() else resumes[:1]
        files = [f for f in files if os.path.isfile(f)]
        note("guard_filechooser", files=[os.path.basename(f) for f in files])
        chooser.set_files(files)

    def on_navigated(frame) -> None:
        scheme = (urllib.parse.urlparse(frame.url).scheme or "").lower()
        if scheme and scheme not in _ALLOWED_PAGE_SCHEMES:
            note("guard_blocked", url=frame.url[:200], reason="scheme_after_navigation")
            try:
                frame.page.goto("about:blank")
            except Exception:  # pragma: no cover
                pass

    def watch(p) -> None:
        p.on("dialog", on_dialog)
        p.on("download", on_download)
        p.on("filechooser", on_filechooser)
        p.on("framenavigated", on_navigated)

    def on_new_page(new) -> None:
        if new is page:
            return
        watch(new)
        try:
            new.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        url = new.url
        if host_allowed(url):
            note("guard_popup", url=url[:200], decision="same_tab")
            try:
                new.close()
                page.goto(url, wait_until="domcontentloaded")
            except Exception as exc:
                note("guard_popup_error", error=str(exc)[:200])
        else:
            note("guard_popup", url=url[:200], decision="closed")
            try:
                new.close()
            except Exception:  # pragma: no cover
                pass

    watch(page)
    context.on("page", on_new_page)
    return log
