#!/usr/bin/env python3
"""Подсказчик browser_planner: фейковая нейросеть и одна страница в Chromium."""
from __future__ import annotations

import os
import unittest
from pathlib import Path

from browser_planner import page_outline, suggest_apply_click, suggest_field_keys

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)

HTML = """<!doctype html><meta charset="utf-8">
<a href="/login">Войти</a>
<div role="button" id="go">Хочу к вам!</div>
<button style="display:none">Скрытая</button>
<label>Как вас звать <input name="q1" placeholder="Иван" value="СЕКРЕТ-ЗНАЧЕНИЕ"></label>
<input type="hidden" name="csrf" value="tok">
"""


class FakeLLM:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def complete_json(self, system: str, user: str, schema_hint: str) -> dict:
        self.calls.append((system, user, schema_hint))
        return self.answer


OUTLINE = {
    "clickables": [
        {"jt": "plan-0", "text": "Войти", "role": "a"},
        {"jt": "plan-1", "text": "Хочу к вам!", "role": "button"},
    ],
    "fields": [{"jt": "7", "label": "Как вас звать", "placeholder": "", "name": "q1", "type": "text"}],
}


class PlannerFakeTest(unittest.TestCase):
    def test_correct_click(self):
        self.assertEqual(suggest_apply_click(FakeLLM({"label": "plan-1"}), OUTLINE), "plan-1")

    def test_invented_label_dropped(self):
        self.assertIsNone(suggest_apply_click(FakeLLM({"label": "plan-99"}), OUTLINE))

    def test_login_dropped(self):
        self.assertIsNone(suggest_apply_click(FakeLLM({"label": "plan-0"}), OUTLINE))

    def test_garbage_and_failure(self):
        self.assertIsNone(suggest_apply_click(FakeLLM({"label": None}), OUTLINE))
        self.assertIsNone(suggest_apply_click(FakeLLM("не dict"), OUTLINE))

        class Broken:
            def complete_json(self, *a):
                raise RuntimeError("сеть")
        self.assertIsNone(suggest_apply_click(Broken(), OUTLINE))

    def test_field_keys_correct(self):
        llm = FakeLLM({"mapping": {"7": "first_name"}})
        self.assertEqual(suggest_field_keys(llm, OUTLINE["fields"], ["first_name", "email"]), {"7": "first_name"})
        self.assertIn("allowed_keys", llm.calls[0][1])

    def test_unknown_key_and_ref_dropped(self):
        llm = FakeLLM({"mapping": {"7": "salary_secret", "8": "email"}})
        self.assertEqual(suggest_field_keys(llm, OUTLINE["fields"], ["first_name", "email"]), {})


@unittest.skipUnless(sync_playwright and CHROMIUM, "нужен Playwright и Chromium")
class PlannerBrowserTest(unittest.TestCase):
    def test_outline_without_values(self):
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])
            try:
                page = browser.new_page()
                page.set_content(HTML)
                out = page_outline(page)
                texts = [c["text"] for c in out["clickables"]]
                self.assertEqual(texts, ["Войти", "Хочу к вам!"])
                self.assertEqual(len(out["fields"]), 1)
                field = out["fields"][0]
                self.assertEqual((field["label"], field["placeholder"], field["name"]), ("Как вас звать", "Иван", "q1"))
                self.assertNotIn("СЕКРЕТ", str(out))
                llm = FakeLLM({"label": out["clickables"][1]["jt"]})
                mark = suggest_apply_click(llm, out)
                self.assertEqual(mark, "plan-1")
                self.assertEqual(page.locator(f'[data-jt-apply="{mark}"]').inner_text(), "Хочу к вам!")
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
