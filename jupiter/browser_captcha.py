"""Капча в браузерном движке: найти, показать человеку, ввести его ответ.

Ничего не распознаёт и не обходит. Задача модуля — только передать человеку то,
что человек может решить сам: картинку с текстом (text_image). Чекбокс,
сетка картинок и невидимая капча сюда не передаются — их модуль лишь
опознаёт, чтобы вызывающий код знал, что передавать нечего.

Работает с синхронным Playwright `Page`. Поиск идёт на главной странице и
внутри iframe известных вендоров (SmartCaptcha и др.). Найденные элементы
помечаются атрибутом data-jupiter-captcha — по нему их находят capture и
enter_answer. Снимается только область самой капчи: остальная страница
содержит персональные данные кандидата и человеку не отдаётся.
"""
from __future__ import annotations

from dataclasses import dataclass

KIND_TEXT_IMAGE = "text_image"  # картинка + поле ввода: передаётся человеку
KIND_CHECKBOX = "checkbox"      # «я не робот»: передать нечего
KIND_IMAGE_GRID = "image_grid"  # выбор картинок: передать нельзя
KIND_INVISIBLE = "invisible"    # без интерфейса: передать нечего
KIND_UNKNOWN = "unknown"        # признаки капчи есть, что это — неясно

MAX_ANSWER_LEN = 64

# Вендор по адресу iframe.
_FRAME_VENDORS = (
    ("smartcaptcha", ("smartcaptcha.yandexcloud.net", "captcha.yandex", "smartcaptcha")),
    ("recaptcha", ("google.com/recaptcha", "recaptcha.net", "gstatic.com/recaptcha")),
    ("hcaptcha", ("hcaptcha.com",)),
    ("turnstile", ("challenges.cloudflare.com",)),
)
# Вендор по разметке главной страницы.
_PAGE_VENDORS = (
    ("smartcaptcha", ".smart-captcha, [id*='smartcaptcha' i], [class*='smartcaptcha' i]"),
    ("recaptcha", ".g-recaptcha, .grecaptcha-badge"),
    ("hcaptcha", ".h-captcha"),
    ("turnstile", ".cf-turnstile"),
)

_MARK = "data-jupiter-captcha"

# Ищет в контексте (страница или iframe) «картинка + поле ввода [+ кнопка]»
# и помечает найденное. arg = доверять ли всему телу (iframe известного вендора).
_SCAN_JS = """(_root, trusted) => {
  const MARK = 'data-jupiter-captcha';
  document.querySelectorAll('[' + MARK + ']').forEach(e => e.removeAttribute(MARK));
  const vis = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const CAP = /captcha|капч|с картинки|с изображения/i;
  const attrs = el => [el.className && el.className.baseVal === undefined ? el.className : '',
    el.id, el.getAttribute('name'), el.getAttribute('src'), el.getAttribute('alt'),
    el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' ');
  const TEXT_TYPES = ['', 'text', 'tel', 'number', 'search'];
  const imgs = root => [...root.querySelectorAll('img, canvas')].filter(e => {
    if (!vis(e)) return false;
    const r = e.getBoundingClientRect();
    return r.width >= 30 && r.height >= 15;
  });
  const inputs = root => [...root.querySelectorAll('input')].filter(e =>
    vis(e) && TEXT_TYPES.includes((e.getAttribute('type') || '').toLowerCase()));
  const boxed = [...document.querySelectorAll('[class*=captcha i], [id*=captcha i]')];
  const loose = [...document.querySelectorAll('form, [role=dialog]')];
  const cands = boxed.map(e => [e, true]).concat(loose.map(e => [e, false]));
  if (trusted && document.body) cands.push([document.body, true]);
  let best = null;
  for (const [el, isBox] of cands) {
    if (!vis(el)) continue;
    const im = imgs(el), inp = inputs(el);
    if (!im.length || !inp.length) continue;
    const hay = attrs(el) + ' ' + im.map(attrs).join(' ') + ' ' + inp.map(attrs).join(' ') +
      ' ' + (el.innerText || '');
    if (!trusted && !CAP.test(hay)) continue;
    const size = el.querySelectorAll('*').length;
    if (!best || size < best.size || (size === best.size && isBox && !best.isBox))
      best = {el, im, inp, isBox, size};
  }
  if (best) {
    const img = best.im.find(e => CAP.test(attrs(e))) || best.im[0];
    const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    let inp = best.inp.find(e => CAP.test(attrs(e)));
    if (!inp) inp = best.inp.find(e => before(img, e)) || best.inp[best.inp.length - 1];
    let btn = null;
    if (best.isBox) {
      const all = [...best.el.querySelectorAll(
        "button, input[type=submit], input[type=button], [role=button]")].filter(vis);
      const good = all.filter(b => before(inp, b) || b.contains(inp) === false);
      const pref = /отправ|провер|подтверд|готов|продолж|submit|verify|check|ok/i;
      btn = good.find(b => pref.test((b.innerText || b.value || '') + ' ' + attrs(b))) || good[0] || null;
    }
    img.setAttribute(MARK, 'img');
    inp.setAttribute(MARK, 'input');
    if (btn) btn.setAttribute(MARK, 'submit');
    return {kind: 'text_image', boxed: best.isBox, submit: !!btn};
  }
  // Сетка картинок: контейнер капчи, плиток много, поля ввода нет.
  for (const el of boxed) {
    if (vis(el) && [...el.querySelectorAll('img')].filter(vis).length >= 4)
      return {kind: 'image_grid', boxed: true, submit: false};
  }
  return {kind: null, boxed: false, submit: false};
}"""


class CaptchaError(RuntimeError):
    """Капчу нельзя показать человеку или ответ нельзя ввести."""


@dataclass(frozen=True)
class CaptchaInfo:
    vendor: str                       # recaptcha | hcaptcha | turnstile | smartcaptcha | custom | unknown
    kind: str                         # KIND_*
    frame_selector: str | None = None  # CSS iframe на странице; None — сама страница
    image_selector: str | None = None
    input_selector: str | None = None
    submit_selector: str | None = None

    @property
    def transferable(self) -> bool:
        """Можно ли передать человеку: картинка + поле ввода."""
        return self.kind == KIND_TEXT_IMAGE and bool(self.image_selector and self.input_selector)


def _scope(page, info: CaptchaInfo):
    return page.frame_locator(info.frame_selector) if info.frame_selector else page


def _scan(scope, trusted: bool) -> dict | None:
    try:
        result = scope.locator("html").evaluate(_SCAN_JS, trusted)
    except Exception:
        return None  # iframe ещё не загружен или закрылся
    return result if result and result.get("kind") else None


def _text_image_info(vendor: str, frame_selector: str | None, found: dict) -> CaptchaInfo:
    sel = lambda role: f"[{_MARK}='{role}']"
    return CaptchaInfo(
        vendor=vendor,
        kind=KIND_TEXT_IMAGE,
        frame_selector=frame_selector,
        image_selector=sel("img"),
        input_selector=sel("input"),
        # Кнопка только внутри контейнера капчи: иначе это кнопка самой анкеты.
        submit_selector=sel("submit") if found.get("submit") else None,
    )


def _frames(page) -> list[tuple[str, str, str]]:
    """(css, вендор, src) для видимых iframe известных вендоров."""
    out = []
    frames = page.locator("iframe")
    for i in range(frames.count()):
        frame = frames.nth(i)
        src = (frame.get_attribute("src") or "").lower()
        vendor = next(
            (name for name, needles in _FRAME_VENDORS if any(n in src for n in needles)),
            None,
        )
        if vendor:
            out.append((f"iframe >> nth={i}", vendor, src))
    return out


def _vendor_kind(vendor: str, frames: list[tuple[str, str, str]], page) -> str:
    """Вид капчи без картинки-с-полем: по признакам вендора."""
    srcs = [src for _, v, src in frames if v == vendor]
    if vendor == "recaptcha":
        if any("/bframe" in s for s in srcs):
            return KIND_IMAGE_GRID
        if any("size=invisible" in s for s in srcs):
            return KIND_INVISIBLE
        if not srcs:  # только значок v3/invisible без окна
            return KIND_INVISIBLE
        return KIND_CHECKBOX
    if vendor == "hcaptcha":
        if any("frame=challenge" in s for s in srcs):
            return KIND_IMAGE_GRID
        if page.locator(".h-captcha[data-size='invisible']").count():
            return KIND_INVISIBLE
        return KIND_CHECKBOX
    if vendor == "smartcaptcha":
        if page.locator("[data-invisible='true'], [data-invisible='']").count():
            return KIND_INVISIBLE
        return KIND_CHECKBOX
    return KIND_CHECKBOX  # turnstile


def detect(page) -> CaptchaInfo | None:
    """Найти капчу на странице. None — признаков капчи нет.

    Приоритет: картинка с полем ввода (её можно передать человеку) — на самой
    странице или в iframe вендора; затем вендор по виду; затем «неизвестная».
    """
    frames = _frames(page)
    # 1. Картинка с текстом: в iframe SmartCaptcha (всё тело — капча) и на странице.
    for css, vendor, _src in frames:
        if vendor != "smartcaptcha":
            continue
        found = _scan(page.frame_locator(css), trusted=True)
        if found and found["kind"] == KIND_TEXT_IMAGE:
            return _text_image_info(vendor, css, found)
        if found:
            return CaptchaInfo(vendor, found["kind"], css)
    found = _scan(page, trusted=False)
    if found and found["kind"] == KIND_TEXT_IMAGE:
        page_vendor = "smartcaptcha" if page.locator(_PAGE_VENDORS[0][1]).count() else "custom"
        return _text_image_info(page_vendor, None, found)
    if found:  # image_grid на странице
        return CaptchaInfo("custom", found["kind"])
    # 2. Вендоры без картинки-с-полем.
    vendors = [v for _, v, _ in frames]
    for name, css in _PAGE_VENDORS:
        if name not in vendors and page.locator(css).count():
            vendors.append(name)
    if vendors:
        vendor = vendors[0]
        frame_css = next((c for c, v, _ in frames if v == vendor), None)
        return CaptchaInfo(vendor, _vendor_kind(vendor, frames, page), frame_css)
    if page.locator("[class*='captcha' i], [id*='captcha' i]").count():
        return CaptchaInfo("unknown", KIND_UNKNOWN)
    return None


def capture(page, info: CaptchaInfo) -> bytes:
    """PNG только картинки капчи (без остальной страницы, где есть ПДн)."""
    if not info.transferable:
        raise CaptchaError(f"Капчу вида {info.kind} нельзя передать человеку")
    image = _scope(page, info).locator(info.image_selector)
    image.wait_for(state="visible")
    for _ in range(15):  # дождаться, пока картинка реально загрузится
        ready = image.evaluate(
            "el => el.tagName !== 'IMG' || (el.complete && el.naturalWidth > 0)"
        )
        if ready:
            break
        page.wait_for_timeout(200)
    return image.screenshot(type="png")


def enter_answer(page, info: CaptchaInfo, text: str, *, wait_ms: int = 3000) -> bool:
    """Ввести ответ человека и нажать подтверждение капчи.

    True — капча ушла (поле и картинка исчезли или страница перешла дальше).
    False — капча осталась: ответ неверный и картинка обновилась, либо ничего
    не произошло. Enter не нажимается: без кнопки внутри капчи он отправил бы
    анкету, поэтому без submit_selector — CaptchaError.
    """
    if not info.transferable:
        raise CaptchaError(f"Капчу вида {info.kind} нельзя решить вводом текста")
    answer = (text or "").strip()
    if not answer or len(answer) > MAX_ANSWER_LEN or "\n" in answer or "\r" in answer:
        raise CaptchaError("Ответ на капчу пуст или не похож на текст с картинки")
    if not info.submit_selector:
        raise CaptchaError("У капчи не найдена собственная кнопка подтверждения")
    scope = _scope(page, info)
    field = scope.locator(info.input_selector)
    field.fill(answer)
    scope.locator(info.submit_selector).click()
    steps = max(1, wait_ms // 200)
    for _ in range(steps):
        page.wait_for_timeout(200)
        try:
            if not field.is_visible():
                return True
        except Exception:
            return True  # страница или фрейм сменились — капча ушла
    return False
