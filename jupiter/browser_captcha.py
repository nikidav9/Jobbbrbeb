"""Капча в браузерном движке: найти, показать человеку, ввести его ответ.

Ничего не распознаёт и не обходит. Задача модуля — только передать человеку то,
что человек может решить сам: картинку с текстом (text_image) — человек вводит
слово, а галочку «я не робот» и сетку картинок (checkbox, image_grid) — человек
нажимает на снимок рамки капчи (tap, 03.10.2026), сервер повторяет его нажатия
в своём браузере. Невидимая капча интерфейса не имеет — передавать нечего.

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
MAX_TAPS = 12

# Вендоры, чьи рамки (iframe) можно показать человеку и нажать на снимке.
TAP_VENDORS = ("recaptcha", "hcaptcha", "turnstile", "smartcaptcha")
# Адрес окна с заданием (сетка картинок) — оно открывается поверх страницы.
_CHALLENGE_NEEDLES = ("/bframe", "frame=challenge")

# Поля, куда вендор кладёт готовый ответ-токен, когда капча пройдена.
_TOKEN_JS = """() => [...document.querySelectorAll(
  'textarea[name=g-recaptcha-response], textarea[name=h-captcha-response], ' +
  'input[name=h-captcha-response], input[name=cf-turnstile-response], input[name=smart-token]'
)].some(e => (e.value || '').length > 20)"""

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
    // «Обновить картинку»: кнопка или значок рядом, только внутри самой капчи.
    let reload = null;
    if (best.isBox) {
      const RELOAD = /refresh|reload|обнов|другую|сменить|заново/i;
      reload = [...best.el.querySelectorAll("button, a, [role=button], span, i, svg, div")]
        .filter(e => vis(e) && e !== btn && !e.contains(inp) && !e.contains(img) && !inp.contains(e)
          && (!btn || !btn.contains(e)) && e.querySelectorAll('input').length === 0
          && RELOAD.test(attrs(e) + ' ' + (e.getAttribute('title') || '') + ' ' +
                         (e.getAttribute('aria-label') || '') +
                         ((e.innerText || '').length < 30 ? ' ' + e.innerText : '')))
        .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0] || null;
    }
    img.setAttribute(MARK, 'img');
    inp.setAttribute(MARK, 'input');
    if (btn) btn.setAttribute(MARK, 'submit');
    if (reload) reload.setAttribute(MARK, 'reload');
    return {kind: 'text_image', boxed: best.isBox, submit: !!btn, reload: !!reload};
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
    reload_selector: str | None = None  # «обновить картинку» внутри капчи, если есть

    @property
    def transferable(self) -> bool:
        """Можно ли передать человеку: картинка + поле ввода."""
        return self.kind == KIND_TEXT_IMAGE and bool(self.image_selector and self.input_selector)

    @property
    def tappable(self) -> bool:
        """Можно ли передать человеку снимком для нажатий: галочка или сетка
        картинок рамки известного вендора."""
        return self.kind in (KIND_CHECKBOX, KIND_IMAGE_GRID) and self.vendor in TAP_VENDORS


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
        reload_selector=sel("reload") if found.get("reload") else None,
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


# ── Нажатия на снимок (галочка «я не робот», сетка картинок) ────────────────


def parse_taps(answer: str) -> list[tuple[float, float]]:
    """«0.31,0.52;0.7,0.2» → [(0.31, 0.52), (0.7, 0.2)]. Точки — доли снимка 0..1.

    Не по форме — CaptchaError: на сайт нажатия идут только от человека и
    только внутри рамки капчи.
    """
    points = []
    for part in (answer or "").strip().split(";"):
        try:
            x_text, y_text = part.split(",")
            x, y = float(x_text), float(y_text)
        except ValueError:
            raise CaptchaError("Нажатия не похожи на точки снимка") from None
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            raise CaptchaError("Нажатие вне снимка капчи")
        points.append((x, y))
    if not points or len(points) > MAX_TAPS:
        raise CaptchaError(f"Нужно от 1 до {MAX_TAPS} нажатий")
    return points


def tap_frame(page) -> tuple[str, bool] | None:
    """Видимая рамка капчи известного вендора: (css, это ли окно с заданием).

    Окно с заданием (сетка картинок) важнее: пока оно открыто, галочка под ним
    ничего не решает. Среди прочих берётся самая большая видимая рамка.
    """
    best = None  # (приоритет, площадь, css, окно)
    for css, _vendor, src in _frames(page):
        try:
            loc = page.locator(css)
            if not loc.is_visible():
                continue
            box = loc.bounding_box()
        except Exception:
            continue
        if not box or box["width"] < 20 or box["height"] < 20:
            continue
        challenge = any(n in src for n in _CHALLENGE_NEEDLES)
        key = (1 if challenge else 0, box["width"] * box["height"])
        if best is None or key > best[0]:
            best = (key, css, challenge)
    return (best[1], best[2]) if best else None


def capture_tap(page, info: CaptchaInfo) -> bytes:
    """PNG только рамки капчи (без остальной страницы, где есть ПДн)."""
    if not info.tappable:
        raise CaptchaError(f"Капчу вида {info.kind} нельзя показать для нажатий")
    found = tap_frame(page)
    if not found:
        raise CaptchaError("Рамка капчи не видна")
    loc = page.locator(found[0])
    loc.scroll_into_view_if_needed()
    return loc.screenshot(type="png")


def _solved(page) -> bool:
    try:
        return bool(page.evaluate(_TOKEN_JS))
    except Exception:
        return False


def tap(page, info: CaptchaInfo, points: list[tuple[float, float]], *, wait_ms: int = 4000) -> str:
    """Повторить нажатия человека внутри рамки капчи.

    'solved' — вендор выдал токен или рамка закрылась; 'again' — открылось
    (или обновилось) задание, нужен новый снимок; 'failed' — ничего не изменилось.
    """
    if not info.tappable:
        raise CaptchaError(f"Капчу вида {info.kind} нельзя решить нажатиями")
    if not points or len(points) > MAX_TAPS:
        raise CaptchaError(f"Нужно от 1 до {MAX_TAPS} нажатий")
    found = tap_frame(page)
    if not found:
        raise CaptchaError("Рамка капчи не видна")
    loc = page.locator(found[0])
    loc.scroll_into_view_if_needed()
    box = loc.bounding_box()
    if not box:
        raise CaptchaError("Рамка капчи не видна")
    for fx, fy in points:
        x, y = box["x"] + fx * box["width"], box["y"] + fy * box["height"]
        # Нажатие человека — только внутри рамки капчи: если поверх неё лежит
        # другой элемент (баннер, кнопка анкеты), клик ушёл бы мимо.
        top = page.evaluate(
            "([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName : ''; }",
            [min(x, box["x"] + box["width"] - 1), min(y, box["y"] + box["height"] - 1)])
        if top != "IFRAME":
            raise CaptchaError("Рамка капчи перекрыта другим элементом")
        page.mouse.click(x, y)
        page.wait_for_timeout(350)
    for _ in range(max(1, wait_ms // 250)):
        page.wait_for_timeout(250)
        if _solved(page):
            return "solved"
        now = tap_frame(page)
        if now is None:
            return "solved"  # рамка закрылась: капча пройдена или страница ушла дальше
        if now[1]:
            return "again"   # открыто окно с заданием
    return "failed"


def refresh(page, info: CaptchaInfo, *, wait_ms: int = 1500) -> bool:
    """Попросить у сайта новую капчу: нажать «обновить картинку» внутри капчи.

    True — кнопка нажата; False — её нет (картинка могла смениться сама, а для
    нажатий человек сам жмёт значок обновления на снимке). Ничего за пределами
    капчи не нажимается и ответ не вводится.
    """
    if not info.reload_selector:
        return False
    try:
        _scope(page, info).locator(info.reload_selector).first.click(timeout=3000)
    except Exception:
        return False
    page.wait_for_timeout(wait_ms)
    return True
