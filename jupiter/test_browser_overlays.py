#!/usr/bin/env python3
"""dismiss_overlays на синтетических баннерах: выбирается только безопасный вариант.

Нужен Playwright и Chromium (JUPITER_CHROMIUM); без них тесты пропускаются.
"""
from __future__ import annotations

import os
import unittest
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

from browser_overlays import dismiss_overlays

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)
RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")

# Каждая кнопка пишет в window.clicked свой id, баннер по клику скрывается.
PAGE = """<!doctype html><meta charset="utf-8">
<h1>Вакансия</h1><button id="apply">Откликнуться</button>
<script>
window.clicked = [];
document.addEventListener('click', e => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  window.clicked.push(b.dataset.id);
  const box = b.closest('.ov'); if (box) box.style.display = 'none';
});
</script>
%s"""

ALL_AND_NECESSARY = """<div class="ov" style="position:fixed;bottom:0;left:0;right:0;background:#eee;padding:20px;z-index:999">
  Мы используем файлы cookie для аналитики и рекламы.
  <button data-id="accept_all">Принять все</button>
  <button data-id="settings">Настроить</button>
  <button data-id="necessary">Только необходимые</button>
  <label><input type="checkbox" id="mk"> Маркетинг</label></div>"""

ONLY_UNDERSTOOD = """<div class="ov" style="position:fixed;bottom:0;left:0;right:0;background:#eee;padding:20px">
  Сайт использует cookie. <button data-id="understood">Понятно</button></div>"""

ONLY_ACCEPT_ALL = """<div class="ov" style="position:fixed;bottom:0;left:0;right:0;background:#eee;padding:20px">
  Мы используем cookie. <button data-id="accept_all">Принять все</button></div>"""

ACCEPT_AND_SETTINGS = """<div class="ov" style="position:fixed;bottom:0;left:0;right:0;background:#eee;padding:20px">
  Мы используем cookie. <button data-id="accept">Принять</button>
  <button data-id="settings">Настроить</button></div>"""

ONLY_ACCEPT = """<div class="ov" style="position:fixed;bottom:0;left:0;right:0;background:#eee;padding:20px">
  Этот сайт использует cookie. <button data-id="accept">Принять</button></div>"""

SUBSCRIBE_MODAL = """<div class="ov" role="dialog" style="position:fixed;top:100px;left:300px;width:500px;background:#fff;padding:20px;z-index:1000">
  <button data-id="x" aria-label="Закрыть" style="float:right">×</button>
  <h3>Подпишитесь на рассылку и получите скидку</h3>
  <input type="email" placeholder="Email">
  <label><input type="checkbox" id="agree"> Согласен на рассылку</label>
  <button data-id="subscribe">Подписаться</button></div>"""

APPLY_MODAL = """<div class="ov" role="dialog" style="position:fixed;top:50px;left:300px;width:500px;background:#fff;padding:20px">
  <button data-id="x" aria-label="Закрыть">×</button>
  <h3>Отклик на вакансию</h3>
  <p>Мы отправим уведомление на почту.</p>
  <input placeholder="Имя"><input placeholder="Фамилия"><input placeholder="Email"></div>"""

CHAT = """<div class="ov jivo-chat" style="position:fixed;bottom:10px;right:10px;width:300px;background:#fff;padding:10px;z-index:999">
  Чат с консультантом <button data-id="minimize" aria-label="Свернуть чат"></button>
  <button data-id="send_msg">Отправить</button></div>"""


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class OverlaysTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=CHROMIUM,
                                             args=["--disable-dev-shm-usage", "--no-first-run"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def run_page(self, overlay: str):
        page = self.browser.new_page()
        self.addCleanup(page.close)
        page.set_content(PAGE % overlay)
        log = dismiss_overlays(page)
        return log, page.evaluate("window.clicked"), page

    def test_necessary_only_beats_accept_all(self):
        log, clicked, page = self.run_page(ALL_AND_NECESSARY)
        self.assertEqual(clicked, ["necessary"])
        self.assertEqual(log[0]["rule"], "reject")
        self.assertFalse(page.is_checked("#mk"))

    def test_understood_only_banner(self):
        log, clicked, _ = self.run_page(ONLY_UNDERSTOOD)
        self.assertEqual(clicked, ["understood"])
        self.assertEqual(log[0]["kind"], "cookie")

    def test_lone_accept_all_is_left_alone(self):
        log, clicked, _ = self.run_page(ONLY_ACCEPT_ALL)
        self.assertEqual((log, clicked), ([], []))

    def test_accept_with_settings_is_left_alone(self):
        log, clicked, _ = self.run_page(ACCEPT_AND_SETTINGS)
        self.assertEqual((log, clicked), ([], []))

    def test_lone_plain_accept_is_informational(self):
        log, clicked, _ = self.run_page(ONLY_ACCEPT)
        self.assertEqual(clicked, ["accept"])
        self.assertEqual(log[0]["rule"], "ack_sole")

    def test_subscribe_modal_closed_by_cross_only(self):
        log, clicked, page = self.run_page(SUBSCRIBE_MODAL)
        self.assertEqual(clicked, ["x"])
        self.assertEqual(log[0]["kind"], "modal")
        self.assertFalse(page.is_checked("#agree"))

    def test_apply_form_dialog_is_not_touched(self):
        log, clicked, _ = self.run_page(APPLY_MODAL)
        self.assertEqual((log, clicked), ([], []))

    def test_chat_widget_minimized_not_used(self):
        log, clicked, _ = self.run_page(CHAT)
        self.assertEqual(clicked, ["minimize"])
        self.assertEqual(log[0]["kind"], "chat")

    def test_no_overlays_no_actions(self):
        log, clicked, _ = self.run_page("")
        self.assertEqual((log, clicked), ([], []))

    def test_cookie_banner_then_modal_both_closed(self):
        log, clicked, _ = self.run_page(ONLY_UNDERSTOOD + SUBSCRIBE_MODAL)
        self.assertEqual(sorted(clicked), ["understood", "x"])
        self.assertEqual(len(log), 2)


if __name__ == "__main__":
    unittest.main()
