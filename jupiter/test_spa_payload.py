#!/usr/bin/env python3
"""Чтение состояния SPA. Без сети.

Ошибка здесь опасна в обе стороны: не найти адрес — остаться ни с чем на
живом сайте; взять что попало — увести Jupiter туда, куда он идти не должен.
"""
from __future__ import annotations

import unittest

from spa_payload import extract_payloads, url_candidates

BASE = "http://127.0.0.1/vacancy/123"


def urls(html: str, base: str = BASE) -> list[str]:
    return [url for url, _hint in url_candidates(extract_payloads(html), base)]


def hints(html: str, base: str = BASE) -> list[str]:
    return [hint for _url, hint in url_candidates(extract_payloads(html), base)]


class NextData(unittest.TestCase):
    HTML = """<div id="__next"></div>
    <script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"vacancy":{"id":"123","applyUrl":"/careers/apply/123"}}}}
    </script>"""

    def test_apply_url_is_found(self):
        self.assertIn("http://127.0.0.1/careers/apply/123", urls(self.HTML))

    def test_hint_keeps_the_key_path(self):
        # По ключу applyUrl видно намерение там, где по адресу не видно ничего.
        self.assertTrue(
            any("applyUrl" in hint for hint in hints(self.HTML)), hints(self.HTML)
        )

    def test_payload_kind_is_reported(self):
        self.assertEqual(
            [p.kind for p in extract_payloads(self.HTML)], ["next_data"]
        )


class LdJson(unittest.TestCase):
    def test_job_posting_url_is_found(self):
        html = """<script type="application/ld+json">
        {"@type":"JobPosting","title":"Кассир",
         "url":"https://127.0.0.1/vacancy/123/apply"}
        </script>"""
        self.assertIn("https://127.0.0.1/vacancy/123/apply", urls(html))


class AssignedState(unittest.TestCase):
    def test_nuxt_object_literal_is_read(self):
        html = """<script>window.__NUXT__ = {"data":{"apply":"/apply/777"}};</script>"""
        self.assertIn("http://127.0.0.1/apply/777", urls(html))

    def test_function_form_is_skipped_not_executed(self):
        # У Nuxt справа бывает функция. Исполнять её мы не будем — это ровно
        # тот произвольный JS, которого в Jupiter нет.
        html = """<script>window.__NUXT__ = (function(a){return {apply:a}})("/apply/777");</script>"""
        self.assertEqual(extract_payloads(html), [])
        self.assertEqual(urls(html), [])

    def test_braces_inside_strings_do_not_break_the_object(self):
        html = """<script>window.__INITIAL_STATE__ = {"note":"a } b {","u":"/apply/9"};</script>"""
        self.assertIn("http://127.0.0.1/apply/9", urls(html))


class Rejections(unittest.TestCase):
    def test_non_http_schemes_are_dropped(self):
        html = """<script type="application/json">
        {"a":"javascript:alert(1)","b":"mailto:hr@example.com",
         "c":"data:text/html,<h1>x</h1>","d":"tel:+79990000000"}
        </script>"""
        self.assertEqual(urls(html), [])

    def test_urls_with_credentials_are_dropped(self):
        html = """<script type="application/json">
        {"u":"https://user:pass@127.0.0.1/apply"}</script>"""
        self.assertEqual(urls(html), [])

    def test_broken_json_is_ignored_not_fatal(self):
        html = """<script id="__NEXT_DATA__" type="application/json">{ not json </script>"""
        self.assertEqual(extract_payloads(html), [])

    def test_oversized_script_is_skipped(self):
        big = '{"u":"/apply/1","pad":"' + "x" * (300 * 1024) + '"}'
        html = f'<script type="application/json">{big}</script>'
        self.assertEqual(extract_payloads(html), [])

    def test_plain_text_is_not_mistaken_for_a_url(self):
        html = """<script type="application/json">
        {"title":"Кассир в магазин","slash":"/","anchor":"#apply"}</script>"""
        self.assertEqual(urls(html), [])

    def test_hostile_base_cannot_turn_a_path_into_a_local_file(self):
        # base_url приходит из <base href> — это разметка работодателя. С
        # file:// в базе относительный путь превратился бы в путь на диске.
        # Движок такое тоже не пустит, но проверка нужна и здесь: слой,
        # который «и так закрыт соседом», однажды удаляют как лишний.
        html = """<script type="application/json">{"u":"/apply/1"}</script>"""
        self.assertEqual(urls(html, base="file:///tmp/"), [])
        self.assertEqual(urls(html, base="ftp://127.0.0.1/"), [])

    def test_route_templates_are_not_addresses(self):
        # В __NEXT_DATA__ всегда есть ключ page вида "/vacancy/[id]". По очкам
        # он обыгрывал настоящую ссылку на анкету, а вёл в 404.
        html = """<script id="__NEXT_DATA__" type="application/json">
        {"page":"/vacancy/[id]","props":{"applyUrl":"/spa-apply"},
         "alt":"/vacancy/:id","curly":"/job/{id}/apply"}
        </script>"""
        self.assertEqual(urls(html), ["http://127.0.0.1/spa-apply"])

    def test_duplicates_collapse(self):
        html = """<script type="application/json">
        {"a":"/apply/1","b":"/apply/1"}</script>"""
        self.assertEqual(urls(html), ["http://127.0.0.1/apply/1"])


class BaseResolution(unittest.TestCase):
    def test_relative_urls_resolve_against_the_given_base(self):
        html = """<script type="application/json">{"u":"apply"}</script>"""
        # Относительный без ведущего слэша за адрес не считаем: слишком легко
        # принять за него обычное слово.
        self.assertEqual(urls(html), [])

    def test_protocol_relative_url_keeps_the_page_scheme(self):
        html = """<script type="application/json">{"u":"//127.0.0.1/apply/5"}</script>"""
        self.assertEqual(urls(html), ["http://127.0.0.1/apply/5"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
