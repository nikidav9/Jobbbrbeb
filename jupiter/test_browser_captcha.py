#!/usr/bin/env python3
"""Капча в браузере: детект, вырезка картинки, ввод ответа человека — без сети.

Страницы синтетические; iframe вендоров подменяются через page.route.
Нужен Playwright и Chromium (JUPITER_CHROMIUM); без них тесты пропускаются.
"""
from __future__ import annotations

import os
import struct
import unittest
from pathlib import Path

import browser_captcha as bc

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)

SVG = (
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' "
    "height='60'><rect width='200' height='60' fill='%23ddd'/>"
    "<text x='20' y='40' font-size='30'>x7k2q</text></svg>"
)

# Блок «картинка + поле + кнопка» как у SmartCaptcha; верный ответ — x7k2q.
CAPTCHA_BOX = f"""
<div class="AdvancedCaptcha" id="box">
  <div>Введите текст с картинки</div>
  <img id="pic" style="display:block" src="{SVG}">
  <input type="text" id="ans" placeholder="Текст">
  <button type="button" id="ok">Отправить</button>
</div>
<script>
document.getElementById('ok').onclick = () => {{
  if (document.getElementById('ans').value === 'x7k2q') document.getElementById('box').remove();
  else document.getElementById('ans').value = '';
}};
</script>
"""

PERSONAL_FORM = """
<h1>Анкета</h1>
<p id="pd">Иван Петров, +7 900 000-00-00, ivan@example.com</p>
<div style="height:600px">заполнение</div>
"""


def size_of(png: bytes) -> tuple[int, int]:
    return struct.unpack(">II", png[16:24])


@unittest.skipUnless(sync_playwright and CHROMIUM, "нужен Playwright и Chromium")
class CaptchaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=CHROMIUM)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={"width": 1000, "height": 900})
        self.frames: dict[str, str] = {}
        for host in ("frames.test", "www.google.com", "hcaptcha.com", "smartcaptcha.yandexcloud.net"):
            self.page.route(f"https://{host}/**", self._frame)

    def tearDown(self):
        self.page.close()

    def _frame(self, route, request):
        route.fulfill(
            status=200,
            content_type="text/html; charset=utf-8",
            body=self.frames.get(request.url.split("/", 3)[3].split("?")[0], "<p>стаб</p>"),
        )

    def show(self, html: str):
        self.page.route("https://site.test/", lambda r: r.fulfill(
            status=200, content_type="text/html; charset=utf-8",
            body=f"<!doctype html><meta charset=utf-8>{html}"))
        self.page.goto("https://site.test/")

    def test_no_captcha(self):
        self.show(PERSONAL_FORM)
        self.assertIsNone(bc.detect(self.page))

    def test_text_image_on_page(self):
        self.show(PERSONAL_FORM + CAPTCHA_BOX)
        info = bc.detect(self.page)
        self.assertEqual(info.kind, bc.KIND_TEXT_IMAGE)
        self.assertTrue(info.transferable)
        self.assertIsNone(info.frame_selector)
        self.assertIsNotNone(info.submit_selector)

    def test_capture_only_captcha_area(self):
        self.show(PERSONAL_FORM + CAPTCHA_BOX)
        info = bc.detect(self.page)
        png = bc.capture(self.page, info)
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(size_of(png)[0], 200)
        self.assertLess(size_of(png)[1], 70)  # не вся страница 1000x900

    def test_enter_wrong_then_right_answer(self):
        self.show(PERSONAL_FORM + CAPTCHA_BOX)
        info = bc.detect(self.page)
        self.assertFalse(bc.enter_answer(self.page, info, "nope", wait_ms=600))
        self.assertTrue(bc.enter_answer(self.page, info, "x7k2q"))

    def test_empty_answer_rejected(self):
        self.show(CAPTCHA_BOX)
        info = bc.detect(self.page)
        with self.assertRaises(bc.CaptchaError):
            bc.enter_answer(self.page, info, "  ")

    def test_smartcaptcha_in_iframe(self):
        self.frames["challenge"] = (
            "<!doctype html><meta charset=utf-8><body>" + CAPTCHA_BOX.replace(
                'class="AdvancedCaptcha" ', ""))
        self.show(PERSONAL_FORM +
                  '<iframe src="https://smartcaptcha.yandexcloud.net/challenge" '
                  'width="300" height="200"></iframe>')
        self.page.wait_for_selector("iframe")
        self.page.frame_locator("iframe").locator("#pic").wait_for()
        info = bc.detect(self.page)
        self.assertEqual((info.vendor, info.kind), ("smartcaptcha", bc.KIND_TEXT_IMAGE))
        self.assertLess(size_of(bc.capture(self.page, info))[1], 70)
        self.assertTrue(bc.enter_answer(self.page, info, "x7k2q"))

    def test_recaptcha_checkbox_not_transferable(self):
        self.show(PERSONAL_FORM +
                  '<iframe src="https://www.google.com/recaptcha/api2/anchor?size=normal"></iframe>')
        info = bc.detect(self.page)
        self.assertEqual((info.vendor, info.kind), ("recaptcha", bc.KIND_CHECKBOX))
        self.assertFalse(info.transferable)
        with self.assertRaises(bc.CaptchaError):
            bc.capture(self.page, info)
        with self.assertRaises(bc.CaptchaError):
            bc.enter_answer(self.page, info, "abc")

    def test_recaptcha_invisible_and_grid(self):
        self.show('<iframe src="https://www.google.com/recaptcha/api2/anchor?size=invisible"></iframe>')
        self.assertEqual(bc.detect(self.page).kind, bc.KIND_INVISIBLE)
        self.show('<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>'
                  '<iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe>')
        self.assertEqual(bc.detect(self.page).kind, bc.KIND_IMAGE_GRID)

    def test_hcaptcha_and_grid_on_page(self):
        self.show('<iframe src="https://hcaptcha.com/x?frame=challenge"></iframe>')
        self.assertEqual(bc.detect(self.page).kind, bc.KIND_IMAGE_GRID)
        self.show('<div class="h-captcha" data-sitekey="k"></div>')
        self.assertEqual(bc.detect(self.page).vendor, "hcaptcha")
        tiles = "".join(f'<img src="{SVG}" width="80" height="60">' for _ in range(9))
        self.show(f'<div class="captcha-grid">Выберите светофоры{tiles}</div>')
        info = bc.detect(self.page)
        self.assertEqual(info.kind, bc.KIND_IMAGE_GRID)
        self.assertFalse(info.transferable)

    def test_unrelated_image_and_input_is_not_captcha(self):
        self.show(f'<form><img src="{SVG}"><input type="text" name="fio"></form>')
        self.assertIsNone(bc.detect(self.page))

    def test_no_own_button_means_no_enter(self):
        self.show(f'<form><img src="{SVG}" alt="captcha"><input name="captcha_code">'
                  '<button>Отправить отклик</button></form>')
        info = bc.detect(self.page)
        self.assertEqual(info.kind, bc.KIND_TEXT_IMAGE)
        self.assertIsNone(info.submit_selector)  # эта кнопка — кнопка анкеты
        with self.assertRaises(bc.CaptchaError):
            bc.enter_answer(self.page, info, "abc")

    def test_refresh_clicks_reload_control_inside_captcha_only(self):
        box = CAPTCHA_BOX.replace(
            '<button type="button" id="ok">',
            '<button type="button" id="rl" class="captcha-refresh" title="Обновить картинку" '
            'onclick="window.reloaded=(window.reloaded||0)+1">&#8635;</button>'
            '<button type="button" id="ok">')
        self.show(PERSONAL_FORM + box + '<button id="outside" class="refresh" '
                  'onclick="window.outside=true">Обновить страницу</button>')
        info = bc.detect(self.page)
        self.assertIsNotNone(info.reload_selector)
        self.assertTrue(bc.refresh(self.page, info, wait_ms=100))
        self.assertEqual(self.page.evaluate("() => window.reloaded"), 1)
        self.assertFalse(self.page.evaluate("() => !!window.outside"))

    def test_refresh_without_reload_control_does_nothing(self):
        self.show(PERSONAL_FORM + CAPTCHA_BOX)
        info = bc.detect(self.page)
        self.assertIsNone(info.reload_selector)
        self.assertFalse(bc.refresh(self.page, info))

    # ── Нажатия на снимок: галочка и сетка картинок ──────────────────────────

    ANCHOR = (
        "<!doctype html><meta charset=utf-8><body style='margin:0'>"
        "<div id=cb style='width:304px;height:78px;background:#eee' "
        "onclick=\"parent.postMessage('%s','*')\">Я не робот</div>"
    )
    PARENT_LISTENER = (
        "<textarea name='g-recaptcha-response' style='display:none'></textarea>"
        "<script>window.onmessage = e => {"
        " if (e.data === 'solved') document.querySelector('textarea').value = 'x'.repeat(40);"
        " if (e.data === 'open') document.getElementById('grid').style.visibility = 'visible'; };"
        "</script>"
    )

    def recaptcha(self, on_click: str, grid: bool = False):
        self.frames["recaptcha/api2/anchor"] = self.ANCHOR % on_click
        self.frames["recaptcha/api2/bframe"] = (
            "<!doctype html><meta charset=utf-8><body style='margin:0'>"
            "<div style='width:400px;height:500px;background:#ccd'>плитки</div>")
        html = PERSONAL_FORM + self.PARENT_LISTENER + (
            '<iframe src="https://www.google.com/recaptcha/api2/anchor" width="304" height="78" '
            'style="border:0"></iframe>')
        if grid:
            html += ('<iframe id="grid" src="https://www.google.com/recaptcha/api2/bframe" '
                     'width="400" height="500" style="border:0;visibility:hidden"></iframe>')
        self.show(html)
        self.page.wait_for_selector("iframe")

    def test_tap_checkbox_solves_and_snapshot_is_only_the_frame(self):
        self.recaptcha("solved")
        info = bc.detect(self.page)
        self.assertTrue(info.tappable)
        self.assertFalse(info.transferable)
        png = bc.capture_tap(self.page, info)
        self.assertEqual(size_of(png), (304, 78))  # не вся страница 1000x900
        self.assertEqual(bc.tap(self.page, info, [(0.5, 0.5)]), "solved")

    def test_tap_that_does_nothing_is_failed(self):
        self.recaptcha("nothing")
        info = bc.detect(self.page)
        self.assertEqual(bc.tap(self.page, info, [(0.5, 0.5)], wait_ms=600), "failed")

    def test_tap_opening_the_challenge_asks_again_and_targets_the_grid(self):
        self.recaptcha("open", grid=True)
        info = bc.detect(self.page)
        self.assertTrue(info.tappable)
        self.assertEqual(bc.tap(self.page, info, [(0.5, 0.5)]), "again")
        self.assertEqual(size_of(bc.capture_tap(self.page, info)), (400, 500))

    def test_covered_frame_is_not_clicked(self):
        self.recaptcha("solved")
        self.page.evaluate("""() => { const d = document.createElement('div');
          d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.1)';
          d.onclick = () => { window.hit = true; }; document.body.appendChild(d); }""")
        info = bc.detect(self.page)
        with self.assertRaises(bc.CaptchaError):
            bc.tap(self.page, info, [(0.5, 0.5)])
        self.assertFalse(self.page.evaluate("() => !!window.hit"))

    def test_invisible_captcha_is_not_tappable(self):
        self.show('<iframe src="https://www.google.com/recaptcha/api2/anchor?size=invisible"></iframe>')
        info = bc.detect(self.page)
        self.assertEqual(info.kind, bc.KIND_INVISIBLE)
        self.assertFalse(info.tappable)
        with self.assertRaises(bc.CaptchaError):
            bc.capture_tap(self.page, info)
        with self.assertRaises(bc.CaptchaError):
            bc.tap(self.page, info, [(0.5, 0.5)])

    def test_tap_without_visible_frame_raises(self):
        self.show('<iframe src="https://www.google.com/recaptcha/api2/anchor" '
                  'style="display:none"></iframe>')
        info = bc.CaptchaInfo("recaptcha", bc.KIND_CHECKBOX)
        with self.assertRaises(bc.CaptchaError):
            bc.tap(self.page, info, [(0.5, 0.5)])


class ParseTapsTest(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(bc.parse_taps("0.1,0.5;0.9,0.25"), [(0.1, 0.5), (0.9, 0.25)])
        self.assertEqual(bc.parse_taps("0,1"), [(0.0, 1.0)])

    def test_rejects_outside_and_garbage(self):
        for bad in ("", "слово", "0.5", "1.2,0.1", "-0.1,0.1", "0.5,0.5;", "a,b",
                    ";".join(["0.5,0.5"] * 13)):
            with self.assertRaises(bc.CaptchaError, msg=bad):
                bc.parse_taps(bad)

    def test_limit_is_twelve(self):
        self.assertEqual(len(bc.parse_taps(";".join(["0.5,0.5"] * 12))), 12)


if __name__ == "__main__":
    unittest.main()
