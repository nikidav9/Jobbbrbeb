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


if __name__ == "__main__":
    unittest.main()
