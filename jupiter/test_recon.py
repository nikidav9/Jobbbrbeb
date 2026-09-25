#!/usr/bin/env python3
"""Разведчик форм: классы на синтетическом сайте и ни одного POST.

Сеть не нужна: сервер на 127.0.0.1 отдаёт по странице на каждый класс.
Главная проверка — последняя: за весь обход сервер не получил ни одного
мутирующего запроса. Разведка обязана оставаться чтением.
"""
from __future__ import annotations

import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from recon import (
    NetOptions, _from_item, block_kind, endpoint_for, load_sites, recon_site,
)

PAGES = {
    "/apply": """<html><body><h1>Продавец</h1>
      <form method="post" action="/send">
        <label>ФИО <input name="fio" required></label>
        <label>Телефон <input type="tel" name="phone" required></label>
        <label><input type="checkbox" name="pd" required>
          Согласен на обработку персональных данных</label>
        <label><input type="checkbox" name="news">
          Хочу получать рекламную рассылку</label>
        <button type="submit">Откликнуться</button>
      </form></body></html>""",
    "/starred": """<html><body>
      <form method="post" action="/send">
        <label>ФИО <input name="fio" required></label>
        <label>Телефон <input type="tel" name="phone" required></label>
        <input name="tg" placeholder="Telegram*">
        <button type="submit">Откликнуться</button>
      </form></body></html>""",
    "/prefilled-neighbour": """<html><body>
      <form method="post" action="/send">
        <input name="form_id" value="42">
        <label>*Ваше имя <input name="discussion-name"></label>
      </form>
      <form method="post" action="/send">
        <input name="form_id" value="43">
        <label>ФИО <input name="fio" required></label>
        <label>Телефон <input type="tel" name="phone" required></label>
        <button type="submit">Откликнуться</button>
      </form></body></html>""",
    "/filter": """<html><body>
      <form method="get" action="/filter">
        <label>Город <select name="city"><option>Москва</option></select></label>
        <button type="submit">Найти</button>
      </form></body></html>""",
    "/b2b": """<html><body>
      <form method="post" action="/send">
        <label>Компания <input name="company" required></label>
        <label>ИНН <input name="inn" required></label>
        <label>Телефон <input type="tel" name="phone" required></label>
        <button type="submit">Отправить</button>
      </form></body></html>""",
    "/captcha": """<html><body>
      <form method="post" action="/send">
        <label>ФИО <input name="fio" required></label>
        <label>Телефон <input type="tel" name="phone" required></label>
        <div class="g-recaptcha" data-sitekey="x"></div>
        <button type="submit">Откликнуться</button>
      </form></body></html>""",
    "/hh": """<html><body><a href="https://hh.ru/vacancy/1">Откликнуться на hh.ru</a>
      </body></html>""",
    "/list": """<html><body><a href="/apply">Продавец-кассир, магазин у метро</a></body></html>""",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/forbidden":
            self.send_error(403)
            return
        if path == "/api/vacancies":
            body = json.dumps({"items": [{"slug": "prodavets-kassir"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/vacancy/prodavets-kassir":
            path = "/apply"
        html = PAGES.get(path)
        if html is None:
            self.send_error(404)
            return
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def _mutating(self):
        self.server.mutations += 1
        self.send_error(405)

    do_POST = do_PUT = do_PATCH = do_DELETE = _mutating


class ReconTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.server.mutations = 0
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.resume = str(Path(cls.tmp.name) / "resume.pdf")
        Path(cls.resume).write_bytes(b"%PDF-1.4\n%%EOF\n")

    @classmethod
    def tearDownClass(cls):
        # Проверка чтения — после всех тестов, по сумме обхода.
        mutations = cls.server.mutations
        cls.server.shutdown()
        cls.tmp.cleanup()
        assert mutations == 0, f"разведка отправила {mutations} мутирующих запросов"

    def recon(self, path: str, endpoints: list[dict] | None = None):
        return recon_site("Синтетика", self.base + path, endpoints or [], self.resume, NetOptions(timeout=5))

    def test_application_form_passes_dry_run_without_marketing_consent(self):
        result = self.recon("/apply")
        self.assertEqual(result.klass, "dry_run_ok", result.reason)
        boxes = {f["name"]: f["filled"] for f in result.form_fields if f["type"] == "checkbox"}
        self.assertEqual(boxes, {"pd": True, "news": False})

    def test_empty_field_starred_in_label_is_not_ready(self):
        # Звёздочка вместо required: браузер пропустит, сервер отклонит.
        self.assertEqual(self.recon("/starred").klass, "form_unmapped")

    def test_site_prefilled_neighbour_form_does_not_block_ready(self):
        # RedLab: сайт сам заполняет form_id в каждой форме.
        self.assertEqual(self.recon("/prefilled-neighbour").klass, "dry_run_ok")

    def test_filter_form_is_not_an_application(self):
        self.assertNotIn(self.recon("/filter").klass, {"dry_run_ok", "form_unmapped", "captcha"})

    def test_client_form_with_company_and_inn_is_not_an_application(self):
        self.assertNotIn(self.recon("/b2b").klass, {"dry_run_ok", "form_unmapped", "captcha"})

    def test_filled_form_behind_captcha_is_not_ready(self):
        self.assertEqual(self.recon("/captcha").klass, "captcha")

    def test_page_that_only_links_to_hh_is_aggregator(self):
        result = self.recon("/hh")
        self.assertEqual(result.klass, "aggregator")
        self.assertEqual(result.aggregator_links, ["hh.ru"])

    def test_forbidden_page_is_blocked_with_access_kind(self):
        result = self.recon("/forbidden")
        self.assertEqual(result.klass, "blocked")
        self.assertEqual(result.block_kind, "доступ (403)")

    def test_agent_walks_from_list_to_vacancy(self):
        self.assertEqual(self.recon("/list").klass, "dry_run_ok")

    def test_vacancy_address_comes_from_json_endpoint_with_any_field(self):
        endpoint = {
            "url": self.base + "/api/vacancies",
            "company_hint": "Синтетика",
            "map": {"list": "items", "id": "slug", "url_template": self.base + "/vacancy/{slug}"},
        }
        result = self.recon("/nowhere", [endpoint])
        self.assertEqual(result.start_url, self.base + "/vacancy/prodavets-kassir")
        self.assertEqual(result.klass, "dry_run_ok")


class ReconUnitTest(unittest.TestCase):
    def test_template_with_empty_field_gives_no_address(self):
        mapping = {"url_template": "https://x.ru/v/{slug}"}
        self.assertIsNone(_from_item({"slug": ""}, mapping))
        self.assertEqual(_from_item({"slug": "a/b c"}, mapping), "https://x.ru/v/a/b%20c")

    def test_endpoint_matches_section_name_and_host(self):
        endpoints = [
            {"url": "https://a.ru/api", "company_hint": "Самокат", "map": {}},
            {"url": "https://b.ru/api", "map": {"url_template": "https://b.ru/v/{id}"}},
        ]
        self.assertIs(endpoint_for("Самокат (бизнес)", "https://zzz.ru", endpoints), endpoints[0])
        self.assertIs(endpoint_for("Кто-то", "https://www.b.ru/list", endpoints), endpoints[1])

    def test_block_kinds(self):
        self.assertEqual(block_kind("[SSL: CERTIFICATE_VERIFY_FAILED] x"), "tls")
        self.assertEqual(block_kind("HTTP Error 404: Not Found"), "404")
        self.assertEqual(block_kind("URLError: [Errno 104] Connection reset by peer"), "доступ (reset)")

    def test_catalog_has_415_sections(self):
        self.assertEqual(len(load_sites()), 415)


if __name__ == "__main__":
    unittest.main()
