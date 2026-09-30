#!/usr/bin/env python3
"""Подсказчик browser_planner: фейковая нейросеть и одна страница в Chromium."""
from __future__ import annotations

import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

import browser_planner
from browser_planner import page_outline, suggest_apply_click, suggest_field_keys
from yandex_gpt import BUDGET, YandexGPT

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


def _sent_fields(llm) -> list[dict]:
    return json.loads(llm.calls[-1][1])["fields"]


class PlannerFakeTest(unittest.TestCase):
    def setUp(self):
        browser_planner._FIELD_CACHE.clear()
        self.addCleanup(browser_planner._FIELD_CACHE.clear)

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
        llm = FakeLLM({"mapping": {"f0": "first_name"}})
        self.assertEqual(suggest_field_keys(llm, OUTLINE["fields"], ["first_name", "email"]), {"7": "first_name"})
        self.assertIn("allowed_keys", llm.calls[0][1])

    def test_name_is_id_without_jt(self):
        fields = [{"name": "q_mail", "label": "Почта", "type": "email"},
                  {"name": "q_tel", "label": "Телефон", "type": "tel"}]
        llm = FakeLLM({"mapping": {"f0": "email", "f1": "phone"}})
        self.assertEqual(suggest_field_keys(llm, fields, {"email", "phone"}),
                         {"q_mail": "email", "q_tel": "phone"})

    def test_unknown_key_and_ref_dropped(self):
        llm = FakeLLM({"mapping": {"f0": "salary_secret", "f9": "email"}})
        self.assertEqual(suggest_field_keys(llm, OUTLINE["fields"], ["first_name", "email"]), {})

    def test_strict_schema_garbage_is_empty(self):
        fields = OUTLINE["fields"]
        allowed = ["first_name", "email"]
        garbage = [
            "не dict", [], {}, {"mapping": "f0"}, {"mapping": ["f0"]},
            {"mapping": {"f0": "first_name"}, "extra": 1},       # лишний ключ верхнего уровня
            {"mapping": {"f0": 5}},                               # ключ профиля не строка
            {"mapping": {"f0": "first_name", "f1": "email"}},     # пар больше, чем полей
            {"mapping": {"7": "first_name"}},                     # настоящий id вместо условного
            {"mapping": {"f0": "first_name", "fX": "email"}},     # одна выдуманная пара портит весь ответ
            {"label": "plan-1"},
        ]
        for answer in garbage:
            browser_planner._FIELD_CACHE.clear()
            self.assertEqual(suggest_field_keys(FakeLLM(answer), fields, allowed), {}, answer)

    def test_null_means_skip(self):
        llm = FakeLLM({"mapping": {"f0": None}})
        self.assertEqual(suggest_field_keys(llm, OUTLINE["fields"], ["first_name"]), {})

    def test_llm_failure_is_empty(self):
        class Broken:
            def complete_json(self, *a):
                raise RuntimeError("сеть")
        self.assertEqual(suggest_field_keys(Broken(), OUTLINE["fields"], ["first_name"]), {})

    def test_value_and_personal_data_never_sent(self):
        fields = [{
            "jt": "a1", "name": "contact", "type": "text",
            "label": "Иван Петров, +7 999 123-45-67",
            "placeholder": "ivan@mail.ru",
            "value": "СЕКРЕТ-ЗНАЧЕНИЕ", "defaultValue": "ЕЩЁ-СЕКРЕТ",
            "options": [{"label": "https://x.ru/a?token=abc", "value": "ОПЦИЯ-VALUE"}, "ИНН 770708389312"],
        }]
        llm = FakeLLM({"mapping": {}})
        suggest_field_keys(llm, fields, ["email", "phone"])
        sent = llm.calls[0][1]
        for bad in ("ivan", "mail.ru", "Иван", "Петров", "999", "123-45-67", "СЕКРЕТ",
                    "value", "defaultValue", "ОПЦИЯ", "token", "770708389312", "a1"):
            self.assertNotIn(bad, sent, bad)
        f = _sent_fields(llm)[0]
        self.assertEqual(set(f), {"id", "name", "type", "label", "placeholder", "options"})
        self.assertEqual(f["placeholder"], "[email]")

    def test_cache_by_host_and_labels(self):
        fields = [{"jt": "x", "label": "Электронная почта", "type": "email", "value": "a@b.ru"}]
        llm = FakeLLM({"mapping": {"f0": "email"}})
        self.assertEqual(suggest_field_keys(llm, fields, ["email"], host="hh.ru"), {"x": "email"})
        # та же анкета, другое значение — ответ из кэша, без вызова
        same = [dict(fields[0], value="c@d.ru")]
        self.assertEqual(suggest_field_keys(llm, same, ["email"], host="HH.ru"), {"x": "email"})
        self.assertEqual(len(llm.calls), 1)
        suggest_field_keys(llm, fields, ["email"], host="superjob.ru")
        self.assertEqual(len(llm.calls), 2)
        suggest_field_keys(llm, [dict(fields[0], label="Почта")], ["email"], host="hh.ru")
        self.assertEqual(len(llm.calls), 3)

    def test_garbage_not_cached(self):
        fields = OUTLINE["fields"]
        suggest_field_keys(FakeLLM("мусор"), fields, ["first_name"], host="a.ru")
        llm = FakeLLM({"mapping": {"f0": "first_name"}})
        self.assertEqual(suggest_field_keys(llm, fields, ["first_name"], host="a.ru"), {"7": "first_name"})


class _Fake(BaseHTTPRequestHandler):
    replies: list = []
    seen: list = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).seen.append(body)
        code, text = type(self).replies.pop(0)
        out = json.dumps({"result": {"alternatives": [{"message": {"role": "assistant", "text": text}}]}})
        self.send_response(code)
        self.end_headers()
        self.wfile.write(out.encode())

    def log_message(self, *a):
        pass


class PlannerOverHttpTest(unittest.TestCase):
    """Весь путь до фейкового YandexGPT: что реально уходит по сети."""

    def setUp(self):
        _Fake.replies, _Fake.seen = [], []
        BUDGET.reset()
        browser_planner._FIELD_CACHE.clear()
        self.addCleanup(BUDGET.reset)
        self.addCleanup(browser_planner._FIELD_CACHE.clear)
        srv = HTTPServer(("127.0.0.1", 0), _Fake)
        threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        self.llm = YandexGPT("KEY", "folder", base_url=f"http://127.0.0.1:{srv.server_port}", retry_pause=0)

    def test_wire_payload_clean_and_cached(self):
        fields = [{"jt": "a1", "name": "contact", "type": "text", "label": "Иван Петров, +7 999 123-45-67",
                   "placeholder": "ivan@mail.ru", "value": "СЕКРЕТ-ЗНАЧЕНИЕ"}]
        _Fake.replies = [(200, '{"mapping": {"f0": "phone"}}')]
        self.assertEqual(suggest_field_keys(self.llm, fields, ["phone", "email"], host="hh.ru"), {"a1": "phone"})
        self.assertEqual(suggest_field_keys(self.llm, fields, ["phone", "email"], host="hh.ru"), {"a1": "phone"})
        self.assertEqual(len(_Fake.seen), 1)
        wire = json.dumps(_Fake.seen[0], ensure_ascii=False)
        for bad in ("ivan", "mail.ru", "Иван", "Петров", "999", "СЕКРЕТ", "value"):
            self.assertNotIn(bad, wire, bad)
        self.assertEqual(_Fake.seen[0]["completionOptions"]["temperature"], 0)
        self.assertIn("yandexgpt-lite", _Fake.seen[0]["modelUri"])

    def test_garbage_from_model_is_empty(self):
        _Fake.replies = [(200, '{"mapping": {"f0": "passport"}}')]
        self.assertEqual(suggest_field_keys(self.llm, OUTLINE["fields"], ["first_name"]), {})

    def test_budget_exhausted_no_request(self):
        with mock.patch.dict(os.environ, {"YANDEX_GPT_MAX_CALLS_PER_HOUR": "0"}):
            self.assertEqual(suggest_field_keys(self.llm, OUTLINE["fields"], ["first_name"]), {})
        self.assertEqual(_Fake.seen, [])


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
