#!/usr/bin/env python3
"""ResponseRecorder / classify / toast_text на локальном сервере с fetch-отправкой."""
from __future__ import annotations

import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from agent import SUCCESS_MARKERS, normalize
from browser_success import ResponseRecorder, _safe_json, classify, toast_text
from submission import (
    SubmissionEvidence, collect_evidence, find_success_phrase, is_confirmed, normalize_text,
    score_evidence,
)

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)

PAGE = """<!doctype html><meta charset="utf-8"><title>t</title>
<button id="go">Отправить</button><div id="out"></div>
<script>
document.getElementById('go').onclick = async () => {
  const r = await fetch('/api/apply/' + location.hash.slice(1), {method: 'POST',
    headers: {'content-type': 'application/json'}, body: JSON.stringify({name: 'Иван', phone: '+7999'})});
  if (location.hash === '#toast') {
    const d = document.createElement('div'); d.setAttribute('role', 'status');
    d.textContent = 'Отклик отправлен'; document.body.appendChild(d);
  }
};
</script>"""

REPLIES = {
    "ok": (200, {"ok": True, "id": 7, "name": "Иван", "phone": "+7999"}),
    "fail": (422, {"error": "Заполните телефон", "phone": "+7999"}),
    "toast": (204, None),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # тишина
        pass

    def do_GET(self):
        body = PAGE.encode()
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length") or 0))
        status, data = REPLIES[self.path.rsplit("/", 1)[-1]]
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(status)
        if data is not None:
            self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class SuccessPhraseTest(unittest.TestCase):
    """Маркеры успеха регулярками: без браузера."""

    def found(self, text, before=""):
        return find_success_phrase(normalize_text(text), normalize_text(before))

    def test_phrases_with_success_in_the_middle(self):
        for text in (
            "Заявка успешно отправлена!",
            "Спасибо! Данные успешно отправлены",  # стандартный текст Tilda
            "Ваш отклик успешно отправлен",
            "Резюме успешно отправлено",
            "Анкета отправлена",
            "Спасибо за заявку",
            "Спасибо, ваше резюме получено",
            "Вы уже откликнулись на эту вакансию",
            "Your application has been successfully submitted",
        ):
            self.assertTrue(self.found(text), text)

    def test_promises_and_negations_are_not_confirmation(self):
        for text in (
            "Ваша заявка будет отправлена после проверки",
            "Заявка не отправлена",
            "Данные не отправлены: заполните телефон",
            "Отправьте резюме",
            "Спасибо за интерес к вакансии",
        ):
            self.assertEqual(self.found(text), "", text)

    def test_phrase_present_before_is_not_new(self):
        self.assertEqual(self.found("Заявка успешно отправлена", before="Подвал: Заявка успешно отправлена"), "")

    def test_regex_phrase_is_dom_text_evidence_that_confirms(self):
        ev = collect_evidence(
            before_url="https://a.ru/v", before_text="Анкета", after_url="https://a.ru/v",
            after_text="Спасибо! Данные успешно отправлены", after_status=200,
            success_markers=SUCCESS_MARKERS, form_gone=False, normalize=normalize,
            success_patterns=True)
        self.assertTrue(is_confirmed(ev), [e.as_dict() for e in ev])

    def test_api_2xx_plus_form_gone_reaches_threshold_exactly(self):
        # 0.7 + 0.1 в плавающей точке = 0.7999999999999999: порог не брался.
        ev = [SubmissionEvidence("API_2XX", "", 0.7, "u"), SubmissionEvidence("FORM_GONE", "", 0.35, "u")]
        self.assertTrue(is_confirmed(ev))
        self.assertFalse(is_confirmed(ev[:1]))


class ApiFlagsTest(unittest.TestCase):
    """Разбор ответов сервера: только флаги, без текстов и значений."""

    def verdict(self, status, body, path="/api/apply", ctype="application/json", **extra):
        import json as _json
        item = {"method": "POST", "path": path, "status": status, "content_type": ctype,
                "submit_like": True, "body_empty": body is None,
                "json": _safe_json(_json.dumps(body, ensure_ascii=False)) if body is not None else {}}
        item.update(extra)
        return classify([item])

    def test_success_flags(self):
        for body in (
            {"result": True}, {"code": 0}, {"code": 200}, {"status": 200}, {"status": "ok"},
            {"message": "OK", "results": [{"message": "OK", "tilda": "x"}]},  # Tilda
            {"data": {"id": 5}, "status": "success", "errors": []},  # Bitrix24
            {"success": True}, {"id": 12},
            {"message": "Ваша заявка принята"},
        ):
            self.assertTrue(self.verdict(200, body)["api_success"], body)

    def test_error_flags(self):
        for status, body in (
            (200, {"result": False}), (200, {"code": 422}), (200, {"status": 400}),
            (200, {"errors": {"phone": ["неверный"]}}), (200, {"message": "Заполните телефон"}),
            (500, {"error": "boom"}), (422, {}),
        ):
            v = self.verdict(status, body)
            self.assertFalse(v["api_success"], body)
            self.assertFalse(v["api_2xx"], body)
            self.assertTrue(v["api_error"], body)

    def test_empty_2xx_on_submit_path_is_weak_evidence_only(self):
        for status in (201, 204):
            v = self.verdict(status, None, ctype="")
            self.assertTrue(v["api_2xx"])
            self.assertFalse(v["api_success"])
        # HTML-ответ 200 на POST (страница перерисована) — не доказательство.
        self.assertFalse(self.verdict(200, None, ctype="text/html", body_empty=False)["api_2xx"])
        # Путь не похож на отправку — тоже нет.
        self.assertFalse(self.verdict(204, None, path="/api/ping", ctype="", submit_like=False)["api_2xx"])

    def test_new_flags_ignored_on_non_submit_path(self):
        self.assertFalse(self.verdict(200, {"result": True}, path="/x", submit_like=False)["api_success"])

    def test_texts_and_foreign_keys_are_not_stored(self):
        flags = _safe_json('{"message": "Спасибо, Иван Петров!", "detail": "x", "phone": "+7999", "ok": true}')
        self.assertEqual(flags, {"ok": True})
        self.assertNotIn("Иван", str(_safe_json('{"message": "Заявка принята, Иван"}')))

    def test_recorder_scope_same_site_and_ats(self):
        rec = ResponseRecorder({"jobs.acme.ru"})
        self.assertEqual(rec._scope("https://jobs.acme.ru/a"), "primary")
        self.assertEqual(rec._scope("https://forms.acme.ru/a"), "related")
        self.assertEqual(rec._scope("https://forms.tildaapi.com/procces/"), "ats")
        self.assertEqual(rec._scope("https://b24-x.bitrix24.ru/bitrix/"), "ats")
        self.assertEqual(rec._scope("https://evil.example/a"), "")
        self.assertEqual(rec._scope("https://acme.ru.evil.example/a"), "")


@unittest.skipIf(sync_playwright is None or CHROMIUM is None, "нужен Playwright и Chromium")
class BrowserSuccessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.host = f"127.0.0.1:{cls.srv.server_address[1]}"
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.srv.shutdown()

    def run_case(self, name, hosts=None):
        page = self.browser.new_page()
        self.addCleanup(page.close)
        page.goto(f"http://{self.host}/#{name}")
        rec = ResponseRecorder(hosts or {self.host}).start(page)
        page.click("#go")
        page.wait_for_timeout(500)
        return page, rec.stop()

    def test_json_ok_is_success_without_pii(self):
        _, res = self.run_case("ok")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["json"], {"ok": True, "id": 7})
        verdict = classify(res)
        self.assertTrue(verdict["api_success"])
        self.assertIsNone(verdict["api_error"])
        self.assertNotIn("Иван", json.dumps(res, ensure_ascii=False))

    def test_422_is_failure(self):
        _, res = self.run_case("fail")
        verdict = classify(res)
        self.assertFalse(verdict["api_success"])
        self.assertIn("422", verdict["api_error"])
        self.assertNotIn("+7999", json.dumps(res))

    def test_toast_text_after_submit(self):
        page, res = self.run_case("toast")
        self.assertIn("Отклик отправлен", toast_text(page))
        self.assertFalse(classify(res)["api_success"])  # 204 без тела — не доказательство

    def test_foreign_host_ignored(self):
        _, res = self.run_case("ok", hosts={"example.org"})
        self.assertEqual(res, [])

    def test_classify_failure_beats_success(self):
        verdict = classify([
            {"method": "POST", "path": "/a", "status": 200, "json": {"ok": True}},
            {"method": "POST", "path": "/b", "status": 500, "json": {}},
        ])
        self.assertFalse(verdict["api_success"])
        self.assertEqual(verdict["api_error"], "HTTP 500")
        self.assertTrue(classify([{"status": 200, "json": {"success": True}}])["api_success"])
        self.assertEqual(classify([{"status": 200, "json": {"ok": False}}])["api_error"], "ok=false")


if __name__ == "__main__":
    unittest.main()
