#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

from yandex_gpt import MAX_PROMPT_CHARS, YandexGPT, YandexGPTResponseError, YandexGPTTransportError, redact


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
        self.srv = HTTPServer(("127.0.0.1", 0), _H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)
        self.gpt = YandexGPT("KEY", "folder1", base_url=f"http://127.0.0.1:{self.srv.server_port}",
                             secrets=["Пётр Сидоров"])

    def test_success(self):
        _H.replies = [(200, '{"a": 1}')]
        self.assertEqual(self.gpt.complete_json("s", "u", '{"a": int}'), {"a": 1})
        path, auth, body = _H.seen[0]
        self.assertEqual(auth, "Api-Key KEY")
        self.assertEqual(body["modelUri"], "gpt://folder1/yandexgpt-lite/latest")
        self.assertFalse(body["completionOptions"]["stream"])

    def test_garbage_then_retry(self):
        _H.replies = [(200, "не json"), (200, '```json\n{"ok": true}\n```')]
        self.assertEqual(self.gpt.complete_json("s", "u"), {"ok": True})
        self.assertEqual(len(_H.seen), 2)

    def test_garbage_twice_raises(self):
        _H.replies = [(200, "x"), (200, "y")]
        with self.assertRaises(YandexGPTResponseError):
            self.gpt.complete_json("s", "u")

    def test_http_error(self):
        _H.replies = [(500, "")]
        with self.assertRaises(YandexGPTTransportError):
            self.gpt.complete_json("s", "u")

    def test_redact(self):
        r = redact("Звони +7 (999) 123-45-67 или a.b@mail.ru, Иванов Иван Иванович; Пётр Сидоров",
                   ["Пётр Сидоров"])
        for bad in ("999", "mail.ru", "Иванов", "Сидоров"):
            self.assertNotIn(bad, r)

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
