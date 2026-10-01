"""Браузерный движок Юпитера: настоящий Chromium вместо HTTP-клиента.

Решение владельца 28.09.2026: карьерные сайты всё чаще — одностраничные
приложения, анкета появляется после нажатия «Откликнуться», поля живут без
<form>, отправка идёт через fetch. HTTP-движок (engine.py) до такой анкеты не
доходит. Разовый замер (scripts/browser-probe.mjs) на 185 сложных сайтах: 121 —
анкету без действий на странице не найти, 26 — открыта и без капчи.

Образец — открытые браузерные агенты, но код свой и
устроен иначе: у движка тот же интерфейс, что у JupiterWebEngine (open, submit,
load_html, allowed_hosts, read_only, куки), поэтому вся логика агента
(agent.py) — смысл полей, согласия по поручению, «не выдумывать факты»,
проверка успеха, повтор и чеки — работает без изменений. Движок только:

1. открывает страницу в Chromium и сам нажимает «Откликнуться», если анкеты
   не видно;
2. снимает отрисованную страницу и отдаёт её тому же разборщику (_SemanticParser):
   невидимые поля убраны, поля без <form> обёрнуты в виртуальную
   форму, каждому элементу дана метка data-jt-ref;
3. при отправке переносит выбранные агентом значения в живую страницу по
   меткам и нажимает кнопку — отправляет сам сайт, как у человека.

Инварианты не меняются:
- read_only (dry-run) блокирует отправку в submit() И обрывает в браузере
  любой не-GET запрос — даже если скрипт сайта захочет что-то послать сам;
- переходы — только на разрешённые хосты, внутренние адреса (SSRF) закрыты
  так же, как у HTTP-движка (policy.NetworkPolicy / is_blocked_address);
- капчу движок не решает и не отдаёт сервисам распознавания: captcha()
  находит её, captcha_png() снимает только саму картинку (остальная страница
  с ПДн человеку не уходит), enter_captcha() вводит ответ самого кандидата;
- успех отправки на SPA подтверждает ответ сайта: submit() записывает ответы
  API (browser_success) и дописывает к тексту страницы исчезающий тост.

Playwright — необязательная зависимость: без него модуль импортируется, а
при создании движка объясняет, чего не хватает. Остальной Юпитер работает на
stdlib, как и раньше.
"""
from __future__ import annotations

import os
import urllib.parse
from typing import Any

import browser_captcha
import browser_success
from browser_captcha import CaptchaInfo
from engine import (
    ControlState,
    EngineError,
    EngineSecurityError,
    EngineTransportError,
    FormState,
    PageState,
    _SemanticParser,
)
import browser_guard
from browser_custom_controls import (
    CLONE_HOOK_JS, apply_custom_select, discover_custom_selects, fill_masked,
)
from agent import is_application_form
from browser_frames import find_application_frames
from browser_overlays import dismiss_overlays
from policy import NetworkPolicy, PolicyError, is_blocked_address, literal_loopback

try:  # pragma: no cover - наличие зависит от окружения
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    PlaywrightError = Exception  # type: ignore[assignment,misc]
    sync_playwright = None  # type: ignore[assignment]


# Честная подпись: обычный Chrome плюс кто мы. Без «HeadlessChrome» — его
# режут как бота, но и не выдаём себя за человека.
UA_SUFFIX = " JobToo/1.0 (+https://jobtoo.ru; support@jobtoo.ru)"
CUSTOM_WIDGETS = "[role=combobox]:not(select),[role=listbox]:not(select),[aria-haspopup=listbox]:not(select)"
# Прокрутка до низа, чтобы лендинг догрузил блоки: не больше SCROLL_STEPS
# экранов, пауза между ними — чтобы сработали IntersectionObserver и лени.
SCROLL_STEPS = 12
SCROLL_PAUSE_MS = 250
# Ответы, при которых анкеты не будет: защита от ботов, гео- или VPN-блок.
BLOCK_STATUSES = {401, 403, 407, 417, 429, 451}
# Защита от ботов (DDoS-Guard, Qrator и др.) отдаёт 401/403 со скриптом,
# который проверяет браузер и сам перезагружает страницу. Настоящему браузеру
# достаточно подождать. Капча сюда не относится: её решает только человек.
CHALLENGE_WAIT_MS = 12000
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Кнопки, открывающие анкету. Порядок — от самых точных.
APPLY_TEXT_RE = (
    r"откликнуться|отправить резюме|подать заявку|отклик на вакансию|"
    r"хочу у вас работать|хочу в команду|respond|apply( now)?$|^apply"
)
# Опрос всплывашек после отправки: тост живёт секунду-другую, дольше settle.
TOAST_POLL_MS = 200
SUBMIT_TEXT_RE = r"отправ|откликн|подать|далее|продолжить|submit|apply|send|next"

# Снимок отрисованной страницы. Живой DOM не меняем, кроме меток data-jt-ref:
# по ним submit() находит элементы. Всё остальное — в клоне.
SNAPSHOT_JS = r"""
([submitReSrc, customSpecs]) => {
  const sel = 'input,select,textarea,button,[data-jt-cs]';
  const live = Array.from(document.querySelectorAll(sel));
  live.forEach((el, i) => el.setAttribute('data-jt-ref', String(i)));
  const visible = el => {
    if (el.type === 'hidden') return true;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  };
  // Файловые поля и галочки сайты прячут и рисуют вместо них свои кнопки —
  // заполнять их всё равно надо. Прочее невидимое агенту не показываем.
  const keepHidden = el => ['file', 'checkbox', 'radio'].includes((el.type || '').toLowerCase());
  if (!document.documentElement) return { html: '<!doctype html><html></html>', url: location.href, virtualForm: false };
  const clone = document.documentElement.cloneNode(true);
  const byRef = new Map();
  clone.querySelectorAll('[data-jt-ref]').forEach(c => byRef.set(c.getAttribute('data-jt-ref'), c));
  for (const el of live) {
    const c = byRef.get(el.getAttribute('data-jt-ref'));
    if (!c) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'input' && !['checkbox', 'radio', 'file'].includes(type)) c.setAttribute('value', el.value || '');
    // У полей SPA часто нет name — агент тогда не отличит шаг визарда от
    // следующего (подпись шага строится по именам полей).
    if (!c.getAttribute('name') && type !== 'radio' && tag !== 'button')
      c.setAttribute('name', el.id || ('jt-' + c.getAttribute('data-jt-ref')));
    if (type === 'checkbox' || type === 'radio') {
      if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked');
      // Галочка без своей подписи, текст — в соседнем блоке общей обёртки
      // (Huntflow: «Я даю согласие на обработку перс. данных…», 01.10.2026).
      // Берём текст ближайшей обёртки, где нет других полей, — иначе
      // согласие не узнать и форма не уходит.
      const own = (el.labels && el.labels[0] && el.labels[0].innerText.trim())
        || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (!own && type === 'checkbox') {
        let box = el.parentElement;
        for (let i = 0; i < 3 && box; i++, box = box.parentElement) {
          if (box.querySelectorAll('input,select,textarea').length > 1) break;
          const text = (box.innerText || '').replace(/\s+/g, ' ').trim();
          if (text) { if (text.length <= 300) c.setAttribute('aria-label', text); break; }
        }
      }
    }
    if (tag === 'textarea') c.textContent = el.value || '';
    if (tag === 'select') {
      Array.from(el.options).forEach((o, i) => {
        const co = c.options ? c.options[i] : null;
        if (!co) return;
        if (o.selected) co.setAttribute('selected', ''); else co.removeAttribute('selected');
      });
    }
    // Невидимое поле убираем из клона совсем: атрибут hidden разборщик
    // учитывает только для текста, а на пустом <input> ещё и «прячет»
    // остаток страницы.
    if (!visible(el) && !keepHidden(el)) c.remove();
  }
  // Формы с action="javascript:…" отправляет браузер нажатием кнопки —
  // агенту такой адрес не нужен и только мешает.
  clone.querySelectorAll('form').forEach(f => {
    if ((f.getAttribute('action') || '').trim().toLowerCase().startsWith('javascript:')) {
      f.setAttribute('action', location.href);
    }
  });
  // Поля без <form> (так устроены SPA) — в виртуальную форму вокруг их
  // общего предка. Кнопки type=button с «отправить/далее» в ней — submit:
  // иначе агент не узнает в них отправку.
  const submitRe = new RegExp(submitReSrc, 'i');
  let loose = live.filter(el => {
    if (el.form || el.hasAttribute('form')) return false;
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'button') return false;
    if (type === 'hidden' || type === 'search' || type === 'submit' || type === 'button') return false;
    return visible(el) || keepHidden(el);
  });
  let virtualForm = false;
  const buttons = live.filter(el => !el.form && visible(el)
    && (el.tagName === 'BUTTON' || ['submit', 'button'].includes((el.type || '').toLowerCase()))
    && submitRe.test((el.innerText || el.value || '').trim()));
  // Границы анкеты — по личным полям и кнопке отправки: калькулятор или
  // фильтр на той же странице в анкету не попадает (fsk.ru, 29.09.2026).
  const personalRe = /имя|фамил|фио|name|телефон|phone|mail|почт|резюме|resume|\bcv\b/i;
  const personal = loose.filter(el => {
    const t = (el.type || '').toLowerCase();
    if (['email', 'tel', 'file'].includes(t)) return true;
    const lab = el.labels && el.labels[0] ? el.labels[0].innerText : '';
    return personalRe.test([lab, el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(' '));
  });
  if (personal.length) {
    const anchor = personal.concat(buttons);
    let scope = anchor[0];
    while (scope && !anchor.every(n => scope.contains(n))) scope = scope.parentElement;
    if (scope) loose = loose.filter(el => scope.contains(el));
  }
  if (loose.length) {
    const nodes = loose.concat(buttons).map(el => byRef.get(el.getAttribute('data-jt-ref'))).filter(Boolean);
    const ancestors = n => { const out = []; for (let x = n; x; x = x.parentElement) out.push(x); return out; };
    let lca = null;
    if (nodes.length) {
      const first = ancestors(nodes[0]);
      lca = first.find(a => nodes.every(n => a.contains(n))) || null;
    }
    if (lca) {
      const doc = clone.ownerDocument;
      const form = doc.createElement('form');
      form.setAttribute('data-jt-virtual', '1');
      form.setAttribute('method', 'post');
      form.setAttribute('action', location.href);
      const tag = lca.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') {
        const body = clone.querySelector('body') || lca;
        while (body.firstChild) form.appendChild(body.firstChild);
        body.appendChild(form);
      } else {
        lca.parentNode.insertBefore(form, lca);
        form.appendChild(lca);
      }
      form.querySelectorAll('button[type=button], input[type=button]').forEach(b => {
        if (submitRe.test((b.textContent || b.getAttribute('value') || '').trim())) b.setAttribute('type', 'submit');
      });
      virtualForm = true;
    }
  }
  // Самописные списки (role=combobox) — в клоне обычный <select> с их
  // вариантами. После виртуальной формы: та опирается на узлы клона.
  (__CUSTOM_HOOK__)(clone, customSpecs);
  return { html: '<!doctype html>' + clone.outerHTML, url: location.href, virtualForm };
}
""".replace("__CUSTOM_HOOK__", CLONE_HOOK_JS.strip())

# Кнопка «Откликнуться»: видимая, текст по APPLY_TEXT_RE. Возвращает метку
# или null. Ссылки на другие сайты не жмём — туда агент пойдёт сам, по политике.
FIND_APPLY_JS = r"""
(re) => {
  const rx = new RegExp(re, 'i');
  const visible = el => { const st = getComputedStyle(el); return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0; };
  const textOf = el => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
  const offsite = el => {
    if (el.tagName !== 'A') return false;
    const href = el.getAttribute('href') || '';
    try {
      const u = new URL(href, location.href);
      return !!u.host && u.host !== location.host && !href.startsWith('#');
    } catch (e) { return false; }
  };
  const fits = el => {
    const text = textOf(el);
    return text && text.length <= 60 && rx.test(text) && visible(el) && !offsite(el);
  };
  // Метка прошлого поиска могла остаться на другом элементе — снимаем.
  document.querySelectorAll('[data-jt-apply]').forEach(el => el.removeAttribute('data-jt-apply'));
  const mark = el => { el.setAttribute('data-jt-apply', 'apply-0'); return 'apply-0'; };
  // Сначала настоящие кнопки и ссылки.
  for (const el of document.querySelectorAll('a,button,[role=button],input[type=button],input[type=submit]')) {
    if (fits(el)) return mark(el);
  }
  // Потом «кнопки» на div/span: обработчик клика (data-jt-click ставит движок
  // через CDP), onclick, tabindex, role=link или курсор-рука: React и Vue
  // рисуют кнопки без <button>. Из вложенных подходящих берём самый глубокий.
  const soft = Array.from(document.querySelectorAll('div,span,li,p,label,[data-jt-click],[onclick],[tabindex],[role=link]'))
    .filter(el => fits(el) && (el.hasAttribute('data-jt-click') || el.hasAttribute('onclick')
      || (el.hasAttribute('tabindex') && el.tabIndex >= 0) || el.getAttribute('role') === 'link'
      || getComputedStyle(el).cursor === 'pointer'));
  const deepest = soft.find(el => !soft.some(other => other !== el && el.contains(other)));
  return deepest ? mark(deepest) : null;
}
"""

# Поля, в которые печатать нельзя: дата/время HTML5 и jQuery/Bootstrap-
# календари (ввод по буквам они режут или переписывают). Значение — через
# «родной» сеттер (его видит React), затем input/change/blur, для jQuery —
# его change. null — поле обычное, печатаем как всегда.
DIRECT_VALUE_JS = r"""
(el, value) => {
  const type = (el.getAttribute('type') || '').toLowerCase();
  const cls = (el.getAttribute('class') || '').toLowerCase();
  const direct = ['date', 'time', 'datetime-local', 'month', 'week'].includes(type)
    || (['text', ''].includes(type) && (/datepicker|daterangepicker|datetimepicker/.test(cls)
      || el.hasAttribute('data-datepicker') || el.hasAttribute('data-date-format') || el.getAttribute('data-provide') === 'datepicker'));
  if (!direct) return null;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  if (window.jQuery) { try { window.jQuery(el).trigger('change'); } catch (e) {} }
  return el.value;
}
"""

# После обычного ввода: change и blur. fill() шлёт только input, а часть
# форм проверяет поле и снимает ошибку по change/blur.
AFTER_FILL_JS = "el => { el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); }"
UNCHECK_JS = "el => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }"


def launch_options(headless: bool, executable_path: str | None) -> dict[str, Any]:
    """Как запускать Chromium.

    Без явного браузера — полный Chromium (channel="chromium"), а не
    chrome-headless-shell, который Playwright берёт для headless по умолчанию.
    Shell не читает политики вовсе, а доверие к УЦ Минцифры приходит именно
    политикой (infra/jupiter-browser-ca-policy.py). Полный браузер Playwright
    1.63 — Chrome for Testing, его папка /etc/opt/chrome_for_testing/policies. 30.09 из-за
    этого браузерная разведка теряла 30 сайтов — банки, Т-Банк, Positive
    Technologies, Газпром — на ERR_CERT_AUTHORITY_INVALID.
    """
    options: dict[str, Any] = {"headless": headless, "args": browser_guard.CHROMIUM_SAFE_ARGS}
    if executable_path:
        options["executable_path"] = executable_path
    else:
        options["channel"] = "chromium"
    return options

# Элементы с обработчиками клика (addEventListener) — видны только через
# DevTools-API getEventListeners (CDP, includeCommandLineAPI). Помечаем их
# data-jt-click для FIND_APPLY_JS.
MARK_CLICK_LISTENERS_JS = r"""
(() => {
  if (typeof getEventListeners !== 'function') return -1;
  const all = document.querySelectorAll('div,span,li,p,label,img,svg,a');
  if (all.length > 10000) return -2;
  let n = 0;
  for (const el of all) {
    try {
      const l = getEventListeners(el);
      if (l.click || l.mousedown || l.mouseup || l.pointerdown || l.pointerup) {
        el.setAttribute('data-jt-click', '1');
        if (++n > 500) break;
      }
    } catch (e) {}
  }
  return n;
})()
"""


class JupiterBrowserEngine:
    name = "jupiter-browser-engine"
    """Chromium с интерфейсом JupiterWebEngine."""

    def __init__(
        self,
        allowed_hosts: set[str],
        *,
        read_only: bool = False,
        timeout: float = 30.0,
        headless: bool = True,
        executable_path: str | None = None,
        allow_private_addresses: bool | None = None,
        settle_ms: int = 800,
        max_apply_clicks: int = 2,
        ignore_https_errors: bool = False,
    ):
        if sync_playwright is None:
            raise EngineError(
                "Браузерному движку нужен Playwright: pip install playwright "
                "(и Chromium — JUPITER_CHROMIUM или playwright install chromium)"
            )
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        self.allow_private_addresses = (
            any(
                literal_loopback(host) or is_blocked_address(host.strip("[]"))
                for host in self.allowed_hosts
            )
            if allow_private_addresses is None
            else allow_private_addresses
        )
        self.read_only = read_only
        self.timeout_ms = int(timeout * 1000)
        self.settle_ms = settle_ms
        self.max_apply_clicks = max_apply_clicks
        self.page: PageState | None = None
        self.script_history: list[dict[str, str]] = []
        self.last_submit_mode = "none"
        # Что движок сделал сам (нажал «Откликнуться», оборвал запрос) —
        # для журнала и отладки; агент ведёт свою траекторию отдельно.
        self.actions: list[dict[str, Any]] = []
        # Итог browser_success.classify последней отправки (None — не было).
        self.last_api_result: dict[str, Any] | None = None
        self._host_ok: dict[str, bool] = {}
        self._last_status = 200
        self._pw = sync_playwright().start()
        try:
            self._browser = self._pw.chromium.launch(**launch_options(
                headless, executable_path or os.environ.get("JUPITER_CHROMIUM") or None))
            probe = self._browser.new_page()
            ua = probe.evaluate("navigator.userAgent").replace("HeadlessChrome", "Chrome")
            probe.close()
            self._context = self._browser.new_context(
                user_agent=ua + UA_SUFFIX,
                locale="ru-RU",
                viewport={"width": 1280, "height": 900},
                **browser_guard.CONTEXT_SAFE_OPTIONS,
                # Только для облачной лаборатории, где TLS подменяет прокси.
                # На сервере — всегда проверка сертификатов.
                ignore_https_errors=ignore_https_errors,
            )
            self._context.set_default_timeout(self.timeout_ms)
            self._context.route("**/*", self._route)
            self._tab = self._context.new_page()
            # После маршрута движка — значит срабатывает раньше него: попапы,
            # диалоги, загрузки, схемы вроде file://.
            browser_guard.install_guards(self._context, self._tab, self.allowed_hosts, [],
                                         journal=self.actions)
        except Exception:
            self.close()
            raise

    # ── Политика сети ──────────────────────────────────────────────────────
    def _policy(self) -> NetworkPolicy:
        return NetworkPolicy(self.allowed_hosts, allow_private=self.allow_private_addresses)

    def assert_allowed(self, url: str) -> None:
        try:
            self._policy().check_url(url, resolve=False)
        except PolicyError as exc:
            raise EngineSecurityError(str(exc)) from exc

    def assert_reachable(self, url: str) -> None:
        try:
            self._policy().check_url(url, resolve=True)
        except PolicyError as exc:
            raise EngineSecurityError(str(exc)) from exc

    def _public_host(self, host: str) -> bool:
        """Любой запрос браузера (скрипт, картинка, fetch) — только наружу.

        Имя резолвим сами и не пускаем во внутренние сети: иначе чужая
        страница заставила бы наш сервер ходить на 169.254.169.254.
        """
        if host in self._host_ok:
            return self._host_ok[host]
        literal = host.strip("[]")
        if is_blocked_address(literal) or literal_loopback(host):
            ok = self.allow_private_addresses
        else:
            try:
                addresses = NetworkPolicy.resolve(host)
            except Exception:
                addresses = []
            ok = bool(addresses) and (
                self.allow_private_addresses
                or not any(is_blocked_address(a) for a in addresses)
            )
        self._host_ok[host] = ok
        return ok

    def _route(self, route, request) -> None:  # pragma: no cover - вызывает браузер
        url = request.url
        parsed = urllib.parse.urlparse(url)
        scheme = (parsed.scheme or "").lower()
        if scheme in {"data", "blob", "about"}:
            route.continue_()
            return
        host = (parsed.hostname or "").lower()
        reason = ""
        if scheme not in {"http", "https"} or not host:
            reason = "scheme"
        elif not self._public_host(host):
            reason = "internal_address"
        elif self._main_navigation(request) and host not in self.allowed_hosts:
            reason = "host_not_allowed"
        elif self.read_only and request.method.upper() not in SAFE_METHODS:
            reason = "read_only"
        elif request.resource_type in {"media", "font"}:
            route.abort()
            return
        if reason:
            self.actions.append({"action": "blocked_request", "url": url[:300], "reason": reason,
                                 "method": request.method})
            route.abort("blockedbyclient")
            return
        route.continue_()

    def _main_navigation(self, request) -> bool:  # pragma: no cover - вызывает браузер
        try:
            return request.is_navigation_request() and request.frame == self._tab.main_frame
        except PlaywrightError:
            return False  # первый запрос попапа: фрейма ещё нет, его ведёт browser_guard

    def _dismiss_overlays(self) -> None:
        self.actions.extend(dismiss_overlays(self._tab))

    # ── Снимок страницы ────────────────────────────────────────────────────
    def _settle(self, toasts: list[str] | None = None) -> None:
        """Дождаться тишины в сети. С toasts — заодно собирать всплывашки."""
        if toasts is None:
            try:
                self._tab.wait_for_load_state("networkidle", timeout=min(self.timeout_ms, 10000))
            except PlaywrightError:
                pass  # долгие опросы и счётчики — не повод ждать дальше
            self._tab.wait_for_timeout(self.settle_ms)
            return

        def grab() -> None:
            text = browser_success.toast_text(self._tab)
            if text and text not in toasts:
                toasts.append(text)

        # networkidle ждём короткими шагами: тост показывается и гаснет,
        # пока сеть ещё не затихла.
        deadline = min(self.timeout_ms, 10000)
        waited = 0
        while waited < deadline:
            grab()
            try:
                self._tab.wait_for_load_state("networkidle", timeout=TOAST_POLL_MS)
                break
            except PlaywrightError:
                waited += TOAST_POLL_MS
        for _ in range(max(1, self.settle_ms // TOAST_POLL_MS)):
            grab()
            self._tab.wait_for_timeout(TOAST_POLL_MS)
        grab()

    def _snapshot(self) -> PageState:
        data = None
        for attempt in range(2):
            try:
                data = self._tab.evaluate(SNAPSHOT_JS, [SUBMIT_TEXT_RE, self._custom_specs()])
                break
            except PlaywrightError as exc:
                # Страница перерисовалась или ушла по адресу посреди снимка —
                # дождаться и снять ещё раз (fsk.ru, 29.09.2026).
                if attempt or "context was destroyed" not in str(exc).lower():
                    raise EngineTransportError(f"Не удалось снять страницу: {exc}") from exc
                self._settle()
        parser = _SemanticParser(data["url"])
        parser.feed(data["html"])
        parser.close()
        page = parser.finish(
            data["html"], self._last_status, {"content-type": "text/html; charset=utf-8"}
        )
        # Скрипты страницы уже отработали по-настоящему: эвристики HTTP-движка
        # для JS («нужен браузер») здесь не нужны.
        page.has_script = False
        page.script_unsupported = False
        self.page = page
        return page

    def _custom_specs(self) -> list[dict]:
        # discover раскрывает каждый список кликом — только если такие есть.
        try:
            if not self._tab.locator(CUSTOM_WIDGETS).count():
                return []
            return [c.as_dict() for c in discover_custom_selects(self._tab)]
        except PlaywrightError:
            return []

    @staticmethod
    def _has_candidate_form(page: PageState) -> bool:
        # Поиск и фильтры вакансий — тоже формы с текстовыми полями; из-за них
        # «Откликнуться» не нажимался (job.rt.ru, metro, gum.ru; 29.09.2026).
        # Анкета — только то, что агент сам признает анкетой кандидата.
        return any(
            is_application_form(page, form.index)
            or any(page.controls[i].type == "file" for i in form.control_indices)
            for form in page.forms
        )

    def _reveal_form(self, page: PageState) -> PageState:
        page = self._click_apply(page)
        if self._has_candidate_form(page):
            return page
        page = self._open_frame_form(page)
        if self._has_candidate_form(page):
            return page
        # Лендинги (Tilda и другие конструкторы) догружают блоки, только когда
        # до них докрутили: форма отклика внизу появляется после прокрутки.
        page = self._scroll_through()
        return self._click_apply(page)

    def _scroll_through(self) -> PageState:
        try:
            for _ in range(SCROLL_STEPS):
                at_bottom = self._tab.evaluate(
                    "() => { window.scrollBy(0, window.innerHeight * 0.9);"
                    " return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4; }"
                )
                self._tab.wait_for_timeout(SCROLL_PAUSE_MS)
                if at_bottom:
                    break
            self.actions.append({"action": "scroll_through"})
            self._settle()
        except PlaywrightError:
            pass
        return self._snapshot()

    def _open_frame_form(self, page: PageState) -> PageState:
        """Анкета во iframe (Huntflow, Potok и самописные) — открыть её адрес
        страницей, если хост разрешён. Один уровень, без рекурсии."""
        try:
            frames = find_application_frames(self._tab, self.allowed_hosts)
        except PlaywrightError:
            return page
        for item in frames:
            url = item.direct_url or (item.url if item.same_origin and item.url.startswith("http") else "")
            host = (urllib.parse.urlparse(url).hostname or "").lower()
            if not url or host not in self.allowed_hosts:
                self.actions.append({"action": "frame_form_skipped", "url": item.url[:200]})
                continue
            self.actions.append({"action": "frame_open", "url": url[:200]})
            self._goto(url)
            self._dismiss_overlays()
            return self._click_apply(self._snapshot())
        return page

    def _mark_click_listeners(self) -> None:
        try:
            cdp = self._context.new_cdp_session(self._tab)
            try:
                cdp.send("Runtime.evaluate", {
                    "expression": MARK_CLICK_LISTENERS_JS, "includeCommandLineAPI": True,
                    "returnByValue": True,
                })
            finally:
                cdp.detach()
        except PlaywrightError:
            pass  # без пометок останутся onclick, tabindex и курсор-рука

    def _click_apply(self, page: PageState) -> PageState:
        """Анкеты не видно — нажать «Откликнуться» (до max_apply_clicks раз)."""
        for _ in range(self.max_apply_clicks):
            if self._has_candidate_form(page):
                return page
            self._mark_click_listeners()
            mark = self._tab.evaluate(FIND_APPLY_JS, APPLY_TEXT_RE)
            if not mark:
                return page
            self._dismiss_overlays()  # баннер мог появиться с задержкой и перехватить клик
            target = self._tab.locator(f'[data-jt-apply="{mark}"]').first
            label = (target.inner_text(timeout=2000) or "").strip()[:60]
            try:
                target.click(timeout=5000)
            except PlaywrightError:
                try:
                    target.click(timeout=5000, force=True)
                except PlaywrightError as exc:
                    self.actions.append({"action": "apply_click_failed", "label": label, "error": str(exc)[:200]})
                    return page
            self.actions.append({"action": "apply_click", "label": label})
            self._settle()
            page = self._snapshot()
        return page

    def _goto(self, url: str) -> None:
        self.assert_reachable(url)
        try:
            response = self._tab.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
        except PlaywrightError as exc:
            raise EngineTransportError(f"Страница не открылась: {exc}") from exc
        self._last_status = response.status if response is not None else 200
        final = self._tab.url
        if final.startswith(("chrome-error:", "about:blank")) and not url.startswith("about:"):
            raise EngineTransportError(f"Страница не открылась: браузер показал ошибку ({final[:40]})")
        if self._last_status in BLOCK_STATUSES:
            self._last_status = self._await_challenge(self._last_status)
            final = self._tab.url
        if self._last_status in BLOCK_STATUSES:
            raise EngineTransportError(
                f"Сайт не пустил браузер: HTTP {self._last_status} (защита от ботов или блокировка)")
        self.assert_allowed(final)
        self._settle()

    def _await_challenge(self, status: int) -> int:
        """Страница блокировки со скриптом — возможно, проверка браузера: ждём,
        пока она сама перейдёт на сайт. Без скрипта ждать нечего."""
        try:
            if not self._tab.evaluate("document.scripts.length"):
                return status
        except PlaywrightError:
            return status
        statuses: list[int] = []

        def on_response(response: Any) -> None:
            try:
                if response.request.is_navigation_request() and response.frame == self._tab.main_frame:
                    statuses.append(response.status)
            except PlaywrightError:
                pass

        self._tab.on("response", on_response)
        try:
            waited = 0
            while waited < CHALLENGE_WAIT_MS:
                self._tab.wait_for_timeout(500)
                waited += 500
                if statuses and statuses[-1] not in BLOCK_STATUSES:
                    break
        finally:
            self._tab.remove_listener("response", on_response)
        if not statuses or statuses[-1] in BLOCK_STATUSES:
            return status
        try:
            self._tab.wait_for_load_state("domcontentloaded", timeout=self.timeout_ms)
        except PlaywrightError:
            pass
        self.actions.append({"action": "browser_check_passed", "was": status, "now": statuses[-1]})
        return statuses[-1]

    # ── Интерфейс JupiterWebEngine ─────────────────────────────────────────
    def open(self, url: str) -> PageState:
        self._goto(url)
        self._dismiss_overlays()
        return self._reveal_form(self._snapshot())

    def load_html(self, html_text: str, logical_url: str) -> PageState:
        """Готовый HTML — для тестов и разбора сохранённых страниц."""
        self.assert_allowed(logical_url)
        self._tab.set_content(html_text, wait_until="domcontentloaded")
        self._last_status = 200
        self._settle()
        page = self._snapshot()
        page.url = logical_url
        return page

    def _locator(self, control: ControlState):
        if not control.dom_ref:
            return None
        return self._tab.locator(f'[data-jt-ref="{control.dom_ref}"]').first

    def _apply_values(self, page: PageState, form: FormState) -> None:
        for index in form.control_indices:
            control = page.controls[index]
            if control.disabled or control.readonly or control.tag == "button":
                continue
            if control.type in {"submit", "image", "button", "reset", "hidden"}:
                continue
            loc = self._locator(control)
            if loc is None:
                continue
            try:
                if control.type == "file":
                    paths = control.file_paths or ([control.file_path] if control.file_path else [])
                    if paths:
                        loc.set_input_files(paths)
                elif control.type == "radio" and not control.checked:
                    # Playwright не снимает радиокнопку (set_checked(False)
                    # падает), а выбор сайта агент снимает намеренно.
                    if loc.is_checked():
                        loc.evaluate(UNCHECK_JS)
                elif control.type in {"checkbox", "radio"}:
                    if loc.is_checked() != control.checked:
                        try:
                            loc.set_checked(control.checked, force=True)
                        except PlaywrightError:
                            # Настоящий флажок спрятан за край экрана, видна
                            # нарисованная рамка (job.mts.ru, 01.10.2026) —
                            # Playwright его не кликает. Клик средствами самой
                            # страницы шлёт те же click/change, что и мышь.
                            loc.evaluate("el => el.click()")
                            if loc.is_checked() != control.checked:
                                raise
                elif control.tag == "select" and loc.get_attribute("data-jt-cs") is not None:
                    chosen = next((o.label for o in control.options if o.selected and o.value), "")
                    if chosen and not apply_custom_select(self._tab, control.dom_ref, chosen):
                        raise EngineError(
                            f"Не выбран вариант {chosen!r} в списке {control.label or control.name!r}")
                elif control.tag == "select":
                    values = control.selected_values
                    if values:
                        loc.select_option(values, force=True)
                else:
                    current = loc.input_value()
                    if control.value and current != control.value and control.tag == "input" \
                            and loc.evaluate(DIRECT_VALUE_JS, control.value) is not None:
                        continue  # календарь: значение записано напрямую
                    if control.value and current != control.value:
                        loc.fill(control.value, force=True)
                        # Маски телефона переписывают ввод — тогда печатаем по символу.
                        if loc.input_value() != control.value and control.type == "tel":
                            fill_masked(self._tab, loc, control.value)
                        loc.evaluate(AFTER_FILL_JS)
            except PlaywrightError as exc:
                # До клика «Отправить» — отклик точно не ушёл. Обычная ошибка,
                # а не обрыв после отправки: иначе агент пишет «исход
                # неизвестен» и больше не пробует (МТС, 01.10.2026).
                raise EngineError(
                    f"Не удалось заполнить поле {control.name or control.id or control.label!r}: {exc}"
                ) from exc

    def submit(
        self,
        page: PageState,
        form: FormState,
        submit_control: ControlState | None = None,
    ) -> PageState:
        if self.read_only:
            raise EngineSecurityError("Read-only Jupiter engine blocked form submission")
        self._apply_values(page, form)
        before = self._tab.url
        self.last_api_result = None
        recorder = browser_success.ResponseRecorder(self.allowed_hosts).start(self._tab)
        toasts: list[str] = []
        try:
            try:
                button = self._locator(submit_control) if submit_control is not None else None
                if button is not None:
                    try:
                        button.click(timeout=8000)
                    except PlaywrightError:
                        button.click(timeout=8000, force=True)
                    self.last_submit_mode = "browser_click"
                else:
                    # Кнопки нет — отправка формы средствами самой страницы.
                    refs = [page.controls[i].dom_ref for i in form.control_indices if page.controls[i].dom_ref]
                    if not refs:
                        raise EngineError("Нечем отправить форму: ни кнопки, ни полей")
                    self._tab.locator(f'[data-jt-ref="{refs[-1]}"]').first.press("Enter")
                    self.last_submit_mode = "browser_enter"
            except PlaywrightError as exc:
                raise EngineTransportError(f"Отправка не удалась: {exc}") from exc
            self._settle(toasts)
        finally:
            responses = recorder.stop()
        self._record_api_result(responses)
        if self._tab.url != before:
            self.assert_allowed(self._tab.url)
        result = self._snapshot()
        if toasts:
            # «Спасибо, отклик получен» во всплывашке исчезает раньше снимка —
            # дописываем к тексту, чтобы агент увидел подтверждение.
            result.text = (result.text + "\n" + "\n".join(toasts)).strip()
        return result

    def _record_api_result(self, responses: list[dict[str, Any]]) -> None:
        verdict = browser_success.classify(responses)
        if verdict["api_success"] or verdict["api_error"]:
            self.last_api_result = verdict
            self.actions.append({"action": "api_result", **verdict})

    # ── Капча: только показать человеку и ввести его ответ ─────────────────
    def captcha(self) -> CaptchaInfo | None:
        """Капча на текущей вкладке (None — нет или страница недоступна)."""
        try:
            return browser_captcha.detect(self._tab)
        except PlaywrightError:
            return None

    def captcha_png(self, info: CaptchaInfo) -> bytes:
        """PNG одной картинки капчи — для кандидата, не для распознавания."""
        return browser_captcha.capture(self._tab, info)

    def enter_captcha(self, info: CaptchaInfo, answer: str) -> bool:
        """Ввести ответ кандидата. True — капча ушла, False — осталась."""
        if self.read_only:
            # Подтверждение капчи может само отправить анкету.
            raise EngineSecurityError("Read-only Jupiter engine blocked captcha answer")
        solved = browser_captcha.enter_answer(self._tab, info, answer)
        self._settle()
        return solved

    def current_page(self) -> PageState:
        """Свежий снимок текущей вкладки — продолжить с места после капчи."""
        return self._snapshot()

    def export_cookies(self) -> list[dict[str, str]]:
        return [
            {"name": c["name"], "value": c.get("value", ""), "domain": c.get("domain", ""),
             "path": c.get("path", "/")}
            for c in self._context.cookies()
        ]

    def import_cookies(self, items: list[dict[str, str]]) -> None:
        cookies = []
        for item in items or []:
            name = str(item.get("name") or "")
            domain = str(item.get("domain") or "")
            if not name or not domain:
                continue
            cookies.append({"name": name, "value": str(item.get("value") or ""),
                            "domain": domain, "path": str(item.get("path") or "/")})
        if cookies:
            self._context.add_cookies(cookies)

    def semantic_snapshot(self) -> dict:
        if not self.page:
            return {"script_history": []}
        snapshot = self.page.snapshot()
        snapshot["script_history"] = []
        snapshot["browser_actions"] = list(self.actions)
        return snapshot

    def screenshot(self, path: str) -> None:
        """Снимок экрана — только для отладки: человеку капчу даёт captcha_png()."""
        self._tab.screenshot(path=path, full_page=False)

    def close(self) -> None:
        for name in ("_context", "_browser"):
            obj = getattr(self, name, None)
            if obj is not None:
                try:
                    obj.close()
                except Exception:
                    pass
        pw = getattr(self, "_pw", None)
        if pw is not None:
            try:
                pw.stop()
            except Exception:
                pass

    def __enter__(self) -> "JupiterBrowserEngine":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
