#!/usr/bin/env python3
"""Забирать сообщения бота самим, вместо того чтобы Телеграм звонил нам.

Почему не вебхук. Телеграм отвечает на попытку его поставить дословно:
«bad webhook: IPv6-only addresses are not allowed». То есть адрес без записи
A он не принимает вовсе. А по IPv4 эта машина с Телеграмом не разговаривает
ни в одну сторону: наружу 0 ответов из 2 в каждом замере, внутрь —
«Connection timed out». Путь сломан, и починить его с нашей стороны нечем.

Отсюда обратный ход: не ждать звонка, а звонить самим. getUpdates — это
исходящий запрос, а исходящие по IPv6 работают: 4 из 4, изо дня в день.
Заодно исчезает пересылка через Vercel, а с ней и весь сегодняшний узел с
двумя ключами, сторожем и откатами.

Устройство простое до скуки. Держим соединение 25 секунд, получаем пачку
обновлений, отдаём каждое своему же обработчику по петле, запоминаем номер
последнего. Номер — на диске: перезапуск службы не должен приводить к тому,
что человек получит вчерашний ответ дважды.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

OFFSET_FILE = "/var/lib/jt-tg-offset"
BEAT_FILE = "/var/lib/jt-tg-beat"
STATS_FILE = "/var/lib/jt-tg-poll-stats.json"
# Через собственный домен, а не через петлю: на 127.0.0.1 шлюз
# отвечает переадресацией на https, и обновление ушло бы в пустоту.
LOCAL = "https://jobtoo.ru/api/tg.php"


def secret(name: str) -> str:
    """Секреты лежат в app_secrets.php, а он написан через base64_decode.

    Разбирать его текстом нельзя, поэтому спрашиваем сам PHP — тот же
    способ, каким это делают все остальные части.
    """
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "php", "php", "-r",
         '$s = @include "/var/www/api/app_secrets.php";'
         f'echo is_array($s) ? ($s["{name}"] ?? "") : "";'],
        cwd="/opt/jobtoo/infra", capture_output=True, timeout=30,
    )
    return out.stdout.decode("utf-8", "replace").strip()


def record_api_result(attempts: list[tuple[str, bool]], ok: bool,
                      mode: str, error: str) -> None:
    now = int(time.time())
    try:
        with open(STATS_FILE, encoding="utf-8") as f:
            stats = json.load(f)
        if not isinstance(stats, dict):
            stats = {}
    except Exception:
        stats = {}

    stats.setdefault("since", now)
    stats["requests"] = int(stats.get("requests", 0)) + 1
    for attempt_mode, reached in attempts:
        key = "ipv6" if attempt_mode == "ipv6" else "fallback"
        stats[f"{key}_attempts"] = int(stats.get(f"{key}_attempts", 0)) + 1
        if reached:
            stats[f"{key}_reached"] = int(stats.get(f"{key}_reached", 0)) + 1

    stats["last_attempt"] = now
    stats["last_mode"] = mode
    if ok:
        stats["ok"] = int(stats.get("ok", 0)) + 1
        stats["consecutive_failures"] = 0
        stats["last_success"] = now
        stats["last_error"] = ""
    else:
        stats["failed"] = int(stats.get("failed", 0)) + 1
        stats["consecutive_failures"] = int(stats.get("consecutive_failures", 0)) + 1
        stats["last_failure"] = now
        stats["last_error"] = error[:200]

    tmp = f"{STATS_FILE}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(stats, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, STATS_FILE)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def api(token: str, method: str, params: dict, timeout: int) -> dict:
    """Запрос к Телеграму: сначала IPv6, затем системный маршрут."""
    url = f"https://api.telegram.org/bot{token}/{method}"
    base = ["curl", "-sS", "-m", str(timeout + 10), url]
    for key, value in params.items():
        base += ["-d", f"{key}={value}"]

    def attempt(cmd: list[str]) -> tuple[dict, bool, str]:
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=timeout + 20)
        except Exception as exc:
            return {}, False, type(exc).__name__

        raw = out.stdout.decode("utf-8", "replace")
        try:
            payload = json.loads(raw or "null")
        except json.JSONDecodeError:
            payload = None
        reached = out.returncode == 0 and isinstance(payload, dict) and bool(payload)
        if reached:
            error = str(payload.get("description") or payload.get("error_code") or "")
            return payload, True, error
        stderr = out.stderr.decode("utf-8", "replace").strip()
        error = stderr or f"curl={out.returncode}, body={raw[:80]}"
        return {}, False, error.replace(token, "[token]")

    attempts: list[tuple[str, bool]] = []
    payload, reached, error = attempt(base[:1] + ["-6"] + base[1:])
    attempts.append(("ipv6", reached))
    if reached:
        ok = bool(payload.get("ok"))
        record_api_result(attempts, ok, "ipv6", "" if ok else error)
        return payload

    payload, fallback_reached, fallback_error = attempt(base)
    attempts.append(("fallback", fallback_reached))
    ok = bool(payload.get("ok")) if fallback_reached else False
    record_api_result(
        attempts, ok, "fallback" if fallback_reached else "none",
        "" if ok else (fallback_error or error),
    )
    return payload if fallback_reached else {}

def deliver(update: dict, app_secret: str) -> None:
    """Отдать обновление своему обработчику — по петле, минуя интернет.

    Заголовок с пропуском обязателен: tg.php с некоторых пор проверяет, что
    обновление пришло от Телеграма, а не от постороннего. Здесь «от
    Телеграма» удостоверяем мы сами, потому что сами его и забрали.
    """
    body = json.dumps(update, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(LOCAL, data=body, headers={
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": app_secret,
    })
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.HTTPError as e:
        print(f"обработчик ответил {e.code}", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"обработчик недоступен: {e}", file=sys.stderr, flush=True)


def main() -> int:
    token = secret("TG_BOT_TOKEN")
    app_secret = secret("APP_SECRET")
    if not token:
        print("нет токена бота", file=sys.stderr)
        return 1

    # Вебхук и getUpdates у Телеграма взаимоисключающие: пока висит вебхук,
    # getUpdates отвечает отказом. Снимаем — но только свой; если там чужой
    # адрес, значит кто-то поставил его намеренно, и ломать это молча нельзя.
    info = api(token, "getWebhookInfo", {}, 15).get("result", {})
    url = info.get("url", "")
    if url:
        api(token, "deleteWebhook", {"drop_pending_updates": "false"}, 15)
        print(f"снял вебхук {url}", flush=True)

    try:
        offset = int(open(OFFSET_FILE).read().strip())
    except Exception:
        offset = 0

    while True:
        r = api(token, "getUpdates",
                {"offset": offset, "timeout": 25, "allowed_updates":
                 '["message","callback_query","my_chat_member"]'}, 25)

        if not r.get("ok"):
            # Обрыв связи или отказ. Ждём и пробуем снова: сообщения у
            # Телеграма не пропадают, он отдаст их со следующего захода.
            time.sleep(3)
            continue

        # Отметка живости означает успешный ответ Telegram, а не просто
        # очередную попытку. Иначе сторож молчит именно во время тайм-аутов.
        try:
            with open(BEAT_FILE, "w", encoding="utf-8") as f:
                f.write(str(int(time.time())))
        except Exception:
            pass

        for upd in r.get("result", []):
            # Со временем обработки. Жалоба «бот отвечает через двадцать
            # секунд» без замера неотличима от «связь медленная», а это
            # разные починки: одно лечится здесь, другое — в обработчике.
            t0 = time.time()
            deliver(upd, app_secret)
            dt = time.time() - t0
            kind = "сообщение" if "message" in upd else "кнопка" if "callback_query" in upd else "прочее"
            print(f"{time.strftime('%H:%M:%S')} {kind} обработано за {dt:.1f}с", flush=True)
            offset = max(offset, int(upd.get("update_id", 0)) + 1)
            try:
                open(OFFSET_FILE, "w").write(str(offset))
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
