#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

import yandex_gpt
from yandex_gpt import BUDGET, MAX_PROMPT_CHARS, YandexGPT, YandexGPTResponseError, YandexGPTTransportError, redact


class _H(BaseHTTPRequestHandler):
    replies: list = []
    seen: list = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).seen.append((self.path, self.headers.get("Authorization"), body))
        code, text = type(self).replies.pop(0)
        out = json.dumps({"result": {"alternatives": [{"message": {"role": "assistant", "text": text}}]}})
        self.send_response(code)
        self.end_headers()
        self.wfile.write(out.encode())

    def log_message(self, *a):
        pass


class YandexGPTTest(unittest.TestCase):
    def setUp(self):
        _H.replies, _H.seen = [], []
        BUDGET.reset()
        self.addCleanup(BUDGET.reset)
        self.srv = HTTPServer(("127.0.0.1", 0), _H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)
        self.gpt = YandexGPT("KEY", "folder1", base_url=f"http://127.0.0.1:{self.srv.server_port}",
                             secrets=["Пётр Сидоров"], retry_pause=0)

    def test_success(self):
        _H.replies = [(200, '{"a": 1}')]
        self.assertEqual(self.gpt.complete_json("s", "u", '{"a": int}'), {"a": 1})
        path, auth, body = _H.seen[0]
        self.assertEqual(auth, "Api-Key KEY")
        self.assertEqual(body["modelUri"], "gpt://folder1/yandexgpt-lite/latest")
        self.assertFalse(body["completionOptions"]["stream"])
        self.assertEqual(body["completionOptions"]["temperature"], 0)

    def test_garbage_then_retry(self):
        _H.replies = [(200, "не json"), (200, '```json\n{"ok": true}\n```')]
        self.assertEqual(self.gpt.complete_json("s", "u"), {"ok": True})
        self.assertEqual(len(_H.seen), 2)

    def test_garbage_twice_raises(self):
        _H.replies = [(200, "x"), (200, "y")]
        with self.assertRaises(YandexGPTResponseError):
            self.gpt.complete_json("s", "u")

    def test_http_error_retried_once(self):
        _H.replies = [(500, ""), (503, "")]
        with self.assertRaises(YandexGPTTransportError):
            self.gpt.complete_json("s", "u")
        self.assertEqual(len(_H.seen), 2)

    def test_429_then_success_with_pause(self):
        _H.replies = [(429, ""), (200, '{"ok": 1}')]
        self.gpt.retry_pause = 0.2
        with mock.patch("yandex_gpt.time.sleep") as sleep:
            self.assertEqual(self.gpt.complete_json("s", "u"), {"ok": 1})
        sleep.assert_called_once_with(0.2)
        self.assertEqual(len(_H.seen), 2)

    def test_4xx_not_retried(self):
        _H.replies = [(400, "")]
        with self.assertRaises(YandexGPTTransportError):
            self.gpt.complete_json("s", "u")
        self.assertEqual(len(_H.seen), 1)

    def test_default_timeout_10s(self):
        seen = {}

        def fake_urlopen(req, timeout):
            seen["timeout"] = timeout
            raise TimeoutError()
        with mock.patch("yandex_gpt.urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(YandexGPTTransportError):
                self.gpt.complete_json("s", "u")
        self.assertEqual(seen["timeout"], 10)

    def test_budget_per_process(self):
        other = YandexGPT("KEY", "folder1", base_url=self.gpt.base_url, retry_pause=0)
        _H.replies = [(200, "{}"), (200, "{}")]
        with mock.patch.dict(os.environ, {"YANDEX_GPT_MAX_CALLS_PER_HOUR": "2"}):
            self.assertEqual(self.gpt.complete_json("s", "u"), {})
            self.assertEqual(other.complete_json("s", "u"), {})  # бюджет общий на процесс
            self.assertEqual(self.gpt.complete_json("s", "u"), {})
        self.assertEqual(len(_H.seen), 2)  # третий запрос не ушёл

    def test_budget_window_is_an_hour(self):
        _H.replies = [(200, '{"a": 1}'), (200, '{"a": 2}')]
        with mock.patch.dict(os.environ, {"YANDEX_GPT_MAX_CALLS_PER_HOUR": "1"}), \
                mock.patch("yandex_gpt.time.monotonic", return_value=1000.0):
            self.assertEqual(self.gpt.complete_json("s", "u"), {"a": 1})
            self.assertEqual(self.gpt.complete_json("s", "u"), {})
        with mock.patch.dict(os.environ, {"YANDEX_GPT_MAX_CALLS_PER_HOUR": "1"}), \
                mock.patch("yandex_gpt.time.monotonic", return_value=1000.0 + 3600):
            self.assertEqual(self.gpt.complete_json("s", "u"), {"a": 2})

    def test_budget_default_200(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(BUDGET.limit(), 200)
        with mock.patch.dict(os.environ, {"YANDEX_GPT_MAX_CALLS_PER_HOUR": "мусор"}):
            self.assertEqual(BUDGET.limit(), 200)

    def test_log_has_no_prompt_or_answer(self):
        _H.replies = [(200, '{"answer": "ОТВЕТ-МОДЕЛИ"}')]
        with self.assertLogs("jupiter.yandex_gpt", level="INFO") as logs:
            self.gpt.complete_json("СИСТЕМА-ТЕКСТ", "ЗАПРОС-ТЕКСТ")
        joined = "\n".join(logs.output)
        self.assertIn("вызов", joined)
        for bad in ("СИСТЕМА", "ЗАПРОС", "ОТВЕТ", "KEY"):
            self.assertNotIn(bad, joined)

    def test_redact(self):
        r = redact("Звони +7 (999) 123-45-67 или a.b@mail.ru, Иванов Иван Иванович; Пётр Сидоров",
                   ["Пётр Сидоров"])
        for bad in ("999", "mail.ru", "Иванов", "Сидоров"):
            self.assertNotIn(bad, r)

    def test_redact_coverage(self):
        cases = {
            "Иван Петров, +7 999 123-45-67": ("Иван", "Петров", "999"),
            "ivan@mail.ru": ("ivan", "mail.ru"),
            "Ivan Petrov": ("Ivan", "Petrov"),
            "Петров И. И. и И.И. Сидоров": ("Петров", "Сидоров"),
            "ИНН 770708389312, паспорт 4509 123456": ("770708389312", "123456"),
            "см. https://hh.ru/resume/x?uid=42&t=abc#top": ("uid=42", "abc", "resume"),
        }
        for text, bad in cases.items():
            r = redact(text)
            for b in bad:
                self.assertNotIn(b, r, (text, r))

    def test_redact_keeps_form_labels(self):
        for label in ("Фамилия Имя Отчество", "Номер Телефона", "First Name", "Cover Letter",
                      "Как вас звать", "Код 12345", "https://hh.ru/vacancy"):
            self.assertEqual(redact(label), label)

    def test_redact_applied_before_send_and_truncated(self):
        _H.replies = [(200, "{}")]
        self.gpt.complete_json("s", "тел 89991234567 " + "я" * 20000)
        user = _H.seen[0][2]["messages"][1]["text"]
        self.assertNotIn("89991234567", user)
        self.assertLessEqual(len(user), MAX_PROMPT_CHARS)

    def test_from_env(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(YandexGPT.from_env())
        with mock.patch.dict(os.environ, {"YANDEX_GPT_API_KEY": "k"}, clear=True):
            self.assertIsNone(YandexGPT.from_env())
        with mock.patch.dict(os.environ, {"YANDEX_GPT_API_KEY": "k", "YANDEX_GPT_FOLDER_ID": "f"}, clear=True):
            self.assertIsNotNone(YandexGPT.from_env())


if __name__ == "__main__":
    unittest.main()
