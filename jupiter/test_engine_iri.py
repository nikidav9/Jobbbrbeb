#!/usr/bin/env python3
"""Адреса с кириллицей в HTTP-движке (ЮMoney, 01.10.2026): перенаправление на
путь с русскими буквами роняло запрос UnicodeEncodeError."""
from __future__ import annotations

import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from engine import JupiterWebEngine, iri_to_uri


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/start":
            self.send_response(302)
            # Сырой UTF-8 в Location — так отдают некоторые сайты.
            self.send_header("Location", "/вакансии/менеджер?город=Москва".encode("utf-8").decode("latin-1"))
            self.end_headers()
            return
        body = f"<html><body><h1>{urllib.parse.unquote(self.path)}</h1></body></html>".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class IriTest(unittest.TestCase):
    def test_iri_to_uri(self):
        self.assertEqual(iri_to_uri("https://x.ru/a%20b?q=1"), "https://x.ru/a%20b?q=1")
        self.assertEqual(iri_to_uri("https://x.ru/путь?г=М"),
                         "https://x.ru/%D0%BF%D1%83%D1%82%D1%8C?%D0%B3=%D0%9C")
        # Домен .рф не трогаем: его переводит urllib, белый список сверяется так же.
        self.assertTrue(iri_to_uri("https://работа.рф/путь").startswith("https://работа.рф/"))

    def test_cyrillic_path_opens(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        engine = JupiterWebEngine({"127.0.0.1"}, read_only=True)
        port = server.server_address[1]
        page = engine.open(f"http://127.0.0.1:{port}/вакансии/менеджер")
        self.assertIn("/вакансии/менеджер", page.text)
        page = engine.open(f"http://127.0.0.1:{port}/start")
        self.assertIn("менеджер", page.text)


if __name__ == "__main__":
    unittest.main()
