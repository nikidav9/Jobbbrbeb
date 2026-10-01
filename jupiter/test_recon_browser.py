#!/usr/bin/env python3
"""Браузерная разведка на двух синтетических сайтах, без сети.

Обычная серверная анкета и SPA с кнопкой «Откликнуться»: обе должны дать
dry_run_ok, а сервер — не получить ни одного POST. Нужен Playwright и Chromium
(JUPITER_CHROMIUM); без них тесты пропускаются.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import site_compat
from recon_browser import (
    BrowserReconResult,
    Progress,
    recon_site_browser, rehearsal_markers, rehearsal_verdict, sites_to_rehearse,
    compare, order_by_previous, run_recon, select_sites, sites_needing_browser, write_atomic, _llm_trace, llm_sites,
)

try:
    from browser_engine import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)
RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")

PLAIN = """<!doctype html><meta charset="utf-8"><h1>Продавец-кассир</h1>
<form method="post" action="/send">
  <label>Имя <input name="fn" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label><input type="checkbox" name="pd" required>
    Согласен на обработку персональных данных</label>
  <button type="submit">Откликнуться</button>
</form>"""

SPA = """<!doctype html><meta charset="utf-8"><h1>Продавец-кассир</h1>
<button type="button" id="open">Откликнуться</button><div id="root"></div>
<script>
document.getElementById('open').addEventListener('click', () => {
  document.getElementById('root').innerHTML = `
    <label>Имя <input id="fn" required></label>
    <label>Телефон <input id="ph" type="tel" required></label>
    <label>Email <input id="em" type="email" required></label>
    <label><input id="agree" type="checkbox" required>
      Согласен на обработку персональных данных</label>
    <button type="button" id="send">Отправить отклик</button>`;
  document.getElementById('send').addEventListener('click',
    () => fetch('/api/apply', {method: 'POST', body: 'x'}));
});
fetch('/api/track', {method: 'POST', body: 'open'}).catch(() => {});
</script>"""

# Кнопка отклика, которую правила не знают: дойти до анкеты помогает только YandexGPT.
ODD = """<!doctype html><meta charset="utf-8"><h1>Аналитик</h1>
<a href="/login">Войти</a>
<button type="button" id="open">Стать частью команды</button><div id="root"></div>
<script>
document.getElementById('open').addEventListener('click', () => {
  document.getElementById('root').innerHTML = `<form>
    <label>Имя <input name="fn" required></label>
    <label>Телефон <input name="ph" type="tel" required></label>
    <label>Email <input name="em" type="email" required></label>
    <button type="button">Отправить</button></form>`;
});
</script>"""


class _FakeLLM:
    """Вместо YandexGPT: выбирает кнопку «Стать частью команды»."""

    def __init__(self):
        self.prompts: list[str] = []

    def complete_json(self, system, user, schema=""):
        self.prompts.append(user)
        data = json.loads(user)
        for item in data.get("clickables", []):
            if "команды" in item.get("text", ""):
                return {"label": item["jt"]}
        return {}


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        page = {"/plain": PLAIN, "/spa": SPA, "/odd": ODD}.get(self.path)
        if page is None:
            self.send_response(404)
            self.end_headers()
            return
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.server.posts.append(self.path)
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class ReconBrowserTest(unittest.TestCase):
    def test_plain_and_spa_forms_reach_dry_run_ok_without_post(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        server.posts = []
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_address[1]}"
        results = run_recon(
            [("plain", f"{base}/plain"), ("spa", f"{base}/spa")],
            timeout=15, site_deadline=90, chromium=CHROMIUM,
        )
        dump = json.dumps([r.__dict__ for r in results], ensure_ascii=False, indent=1)
        for item in results:
            self.assertEqual(item.klass, "dry_run_ok", dump)
            self.assertEqual(item.engine, "browser")
        spa = next(r for r in results if r.name == "spa")
        self.assertIn("apply_click", [a.get("action") for a in spa.browser_actions], dump)
        self.assertEqual(server.posts, [])

    def test_yandex_gpt_hint_takes_recon_to_the_form(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        server.posts = []
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_address[1]}/odd"
        llm = _FakeLLM()
        with tempfile.TemporaryDirectory() as tmp:
            resume = Path(tmp) / "r.pdf"
            resume.write_bytes(b"%PDF-1.4\n%%EOF\n")
            helped = recon_site_browser("odd", url, [], str(resume), timeout=15, chromium=CHROMIUM, llm=llm)
            alone = recon_site_browser("odd", url, [], str(resume), timeout=15, chromium=CHROMIUM)
        self.assertEqual(helped.klass, "dry_run_ok", helped.reason)
        self.assertTrue(helped.llm_used)
        self.assertIn({"action": "llm_apply_click", "label": "Стать частью команды"}, helped.llm_actions)
        self.assertNotEqual(alone.klass, "dry_run_ok")
        self.assertFalse(alone.llm_used)
        # Модель видела кнопки страницы, а не синтетического кандидата.
        self.assertNotIn("@", "".join(llm.prompts))
        self.assertEqual(server.posts, [])

    def test_rehearsal_tells_would_send_from_empty_request(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        server.posts = []
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with tempfile.TemporaryDirectory() as tmp:
            resume = Path(tmp) / "r.pdf"
            resume.write_bytes(b"%PDF-1.4\n%%EOF\n")
            plain = recon_site_browser("plain", f"{base}/plain", [], str(resume), timeout=15,
                                       chromium=CHROMIUM, rehearse=True)
            spa = recon_site_browser("spa", f"{base}/spa", [], str(resume), timeout=15,
                                     chromium=CHROMIUM, rehearse=True)
        self.assertEqual(plain.klass, "dry_run_ok")
        self.assertEqual(plain.rehearsal.get("verdict"), "would_send", plain.rehearsal)
        # Страница шлёт «x» — запрос есть, а анкеты в нём нет: так и пишем.
        self.assertEqual(spa.rehearsal.get("verdict"), "request_without_candidate", spa.rehearsal)
        self.assertEqual(server.posts, [])

    def test_deadline_turns_into_blocked_result(self):
        [item] = run_recon([("x", "http://127.0.0.1:9/")], timeout=5, site_deadline=0.01, chromium=CHROMIUM)
        self.assertEqual(item.klass, "blocked")
        self.assertEqual(item.block_kind, "таймаут")


class PureTest(unittest.TestCase):
    def test_select_sites(self):
        sites = [("A", "https://www.a.ru/x"), ("B", "https://b.ru/y"), ("C", "https://c.ru/z")]
        self.assertEqual(select_sites(sites, ["a.ru", "c.ru"], 1), [sites[0]])
        self.assertEqual(select_sites(sites, None, 2), sites[:2])

    def test_compare_reports_class_changes(self):
        old = [{"url": "u1", "klass": "spa"}, {"url": "u2", "klass": "blocked"}]
        new = [{"url": "u1", "klass": "dry_run_ok"}, {"url": "u2", "klass": "blocked"}]
        text = compare(old, new)
        self.assertIn("spa -> dry_run_ok  u1", text)
        self.assertIn("Сменили класс: 1", text)

    def test_server_mode_takes_only_sections_http_did_not_pass(self):
        http = [
            {"name": "ok", "url": "https://ok.ru/jobs", "klass": "dry_run_ok"},
            {"name": "ok2", "url": "https://www.ok.ru/other", "klass": "spa"},  # хост уже прошёл
            {"name": "spa", "url": "https://spa.ru/jobs", "klass": "spa"},
            {"name": "cap", "url": "https://cap.ru/jobs", "klass": "captcha"},
            {"name": "unm", "url": "https://unm.ru/jobs", "klass": "form_unmapped"},
            {"name": "nov", "url": "https://nov.ru/jobs", "klass": "no_vacancy"},
            {"name": "nov", "url": "https://nov.ru/jobs", "klass": "no_vacancy"},  # дубль
            {"name": "agg", "url": "https://agg.ru/jobs", "klass": "aggregator"},
            {"name": "blk", "url": "https://blk.ru/jobs", "klass": "blocked"},
            {"name": "tls", "url": "https://tls.ru/jobs", "klass": "blocked", "block_kind": "tls"},
            {"name": "403", "url": "https://waf.ru/jobs", "klass": "blocked", "block_kind": "доступ (403)"},
        ]
        self.assertEqual(
            [name for name, _ in sites_needing_browser(http)], ["spa", "cap", "unm", "nov", "403"],
        )

    def test_previous_dry_run_ok_goes_first_then_unseen(self):
        sites = [("a", "https://a.ru"), ("b", "https://b.ru"), ("c", "https://c.ru"), ("d", "https://d.ru")]
        prev = [{"url": "https://a.ru", "klass": "spa"}, {"url": "https://c.ru", "klass": "dry_run_ok"}]
        self.assertEqual([n for n, _ in order_by_previous(sites, prev)], ["c", "b", "d", "a"])

    def test_llm_goes_first_to_employers_with_vacancies_in_feed(self):
        endpoints = [{"company_hint": "Лента", "url": "https://lenta.example/api", "map": {}}]
        sites = [("Нет источника", "https://none.example/jobs"), ("Лента", "https://lenta.example/jobs"),
                 ("Ещё", "https://more.example/jobs")]
        self.assertEqual(llm_sites(sites, endpoints, 1), {"https://lenta.example/jobs"})
        self.assertEqual(len(llm_sites(sites, endpoints, 2)), 2)
        self.assertEqual(llm_sites(sites, endpoints, 0), set())

    def test_llm_trace_keeps_model_steps_without_values(self):
        engine_actions = [{"action": "apply_click", "label": "Откликнуться"},
                          {"action": "llm_apply_click", "label": "Стать частью команды"}]
        trajectory = [{"action": "fill", "field": "fn", "value": "Иван"},
                      {"action": "llm_map", "field": "q1", "key": "city", "value": "Москва"}]
        trace = _llm_trace(engine_actions, trajectory)
        self.assertEqual(trace, [{"action": "llm_apply_click", "label": "Стать частью команды"},
                                 {"action": "llm_map", "field": "q1", "key": "city"}])
        self.assertNotIn("Москва", json.dumps(trace, ensure_ascii=False))

    def test_rehearsal_takes_sites_http_already_passed(self):
        http = [{"name": "ok", "url": "https://ok.ru/jobs", "klass": "dry_run_ok"},
                {"name": "ok", "url": "https://ok.ru/jobs", "klass": "dry_run_ok"},
                {"name": "spa", "url": "https://spa.ru/jobs", "klass": "spa"}]
        self.assertEqual(sites_to_rehearse(http), [("ok", "https://ok.ru/jobs")])

    def test_rehearsal_markers_and_verdicts(self):
        marks = rehearsal_markers({"email": "recon@example.com", "last_name": "Тестов"})
        self.assertIn("recon%40example.com", marks)
        self.assertIn("\\u0422\\u0435\\u0441\\u0442\\u043e\\u0432", marks)
        self.assertEqual(rehearsal_verdict([]), "no_request")
        self.assertEqual(rehearsal_verdict([{"carries_candidate": False}]), "request_without_candidate")
        self.assertEqual(rehearsal_verdict([{"carries_candidate": False}, {"carries_candidate": True}]), "would_send")

    def test_child_from_newer_version_does_not_break_parent(self):
        import recon_browser
        from unittest import mock
        line = recon_browser.RESULT_MARK + json.dumps(
            {"name": "x", "url": "u", "start_url": "u", "klass": "dry_run_ok", "brand_new_field": 1})
        done = mock.Mock(stdout=line + "\n", stderr="", returncode=0)
        with mock.patch.object(recon_browser.subprocess, "run", return_value=done):
            item = recon_browser._run_child("x", "u", 5, 10, None)
        self.assertEqual(item.klass, "dry_run_ok")

    def test_recon_starts_from_the_vacancy_people_swipe(self):
        from recon import feed_vacancy_for, load_feed_vacancies
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "feed.json"
            path.write_text(json.dumps({"Газпром": ["https://www.gazprom.ru/careers/v/1"],
                                        "Яндекс": ["https://yandex.ru/jobs/vacancies/42"],
                                        "Чужая": ["javascript:alert(1)"]}, ensure_ascii=False), encoding="utf-8")
            feed = load_feed_vacancies(str(path))
        self.assertEqual(feed_vacancy_for("Газпром", "https://www.gazprom.ru/", feed),
                         "https://www.gazprom.ru/careers/v/1")
        # Раздел каталога «Яндекс · /jobs» — та же компания.
        self.assertEqual(feed_vacancy_for("Яндекс · /jobs", "https://yandex.ru/jobs", feed),
                         "https://yandex.ru/jobs/vacancies/42")
        # Имя не совпало — по хосту сайта.
        self.assertEqual(feed_vacancy_for("Yandex", "https://yandex.ru/jobs", feed),
                         "https://yandex.ru/jobs/vacancies/42")
        self.assertIsNone(feed_vacancy_for("Чужая", "https://other.example", feed))
        self.assertEqual(load_feed_vacancies("/nonexistent.json"), {})

    def test_time_budget_stops_new_sites(self):
        # Срок уже вышел — ни один процесс не запускается, итог пуст.
        self.assertEqual(run_recon([("x", "https://x.ru")], max_seconds=0), [])

    def test_progress_file_counts_sites_and_estimates_end(self):
        clock = [1000.0]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "progress.json"
            prog = Progress(str(out), 4, 3600, 200, now=lambda: clock[0])
            prog.write()
            self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["done"], 0)
            clock[0] += 100
            prog(BrowserReconResult(name="Альфа", url="https://a.ru", start_url="https://a.ru", klass="dry_run_ok",
                                    llm_used=True, rehearsal={"verdict": "would_send"}))
            clock[0] += 100
            prog(BrowserReconResult(name="Бета", url="https://b.ru", start_url="https://b.ru", klass="captcha"))
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual((data["state"], data["done"], data["left"], data["last"]), ("идёт", 2, 2, "Бета"))
            self.assertEqual(data["classes"], {"dry_run_ok": 1, "captcha": 1})
            self.assertEqual((data["rehearsal"], data["llm_used"]), ({"would_send": 1}, 1))
            # 200 с на два раздела — ещё два займут 200 с.
            self.assertEqual(data["eta_at"], Progress._iso(1400.0))
            self.assertEqual(data["deadline_at"], Progress._iso(1000.0 + 3600 + 200))
            prog.write("срок вышел")
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["state"], "срок вышел")
            self.assertNotIn("eta_at", data)

    def test_run_recon_reports_progress_only_for_started_sites(self):
        seen = []
        self.assertEqual(run_recon([("x", "https://x.ru")], max_seconds=0, progress=seen.append), [])
        self.assertEqual(seen, [])

    def test_write_atomic_replaces_whole_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            out.write_text("old", encoding="utf-8")
            write_atomic(str(out), [{"klass": "dry_run_ok"}])
            self.assertEqual(json.loads(out.read_text(encoding="utf-8")), [{"klass": "dry_run_ok"}])
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["r.json"])


class SiteCompatBrowserReconTest(unittest.TestCase):
    """live_ready читает и браузерный итог, с тем же сроком свежести."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.http = base / "http.json"
        self.browser = base / "browser.json"
        self.http.write_text(json.dumps([
            {"url": "https://http-ok.example/jobs", "klass": "dry_run_ok"},
            {"url": "https://spa.example/jobs", "klass": "spa"},
        ]), encoding="utf-8")
        self.browser.write_text(json.dumps([
            {"url": "https://spa.example/jobs", "start_url": "https://jobs.spa.example/v/1",
             "klass": "dry_run_ok", "engine": "browser"},
            {"url": "https://cap.example/jobs", "klass": "captcha", "engine": "browser"},
        ]), encoding="utf-8")
        old = (site_compat.RECON_FILE, site_compat.RECON_BROWSER_FILE)
        site_compat.RECON_FILE, site_compat.RECON_BROWSER_FILE = str(self.http), str(self.browser)

        def restore():
            site_compat.RECON_FILE, site_compat.RECON_BROWSER_FILE = old
        self.addCleanup(restore)

    def test_browser_dry_run_ok_opens_live_submission(self):
        self.assertTrue(site_compat.live_ready("https://spa.example/vacancy/7"))
        self.assertTrue(site_compat.live_ready("https://jobs.spa.example/v/1"))
        self.assertTrue(site_compat.live_ready("https://http-ok.example/x"))
        self.assertFalse(site_compat.live_ready("https://cap.example/jobs"))
        self.assertEqual(site_compat.live_ready_source("https://spa.example/v"), "browser")
        self.assertEqual(site_compat.live_ready_source("https://http-ok.example/v"), "http")
        self.assertEqual(site_compat.live_ready_source("https://rabota.sber.ru/search/1"), "owner")
        self.assertIsNone(site_compat.live_ready_source("https://cap.example/v"))
        # Снятие с паузы в run_worker берёт хосты обоих итогов.
        self.assertEqual(
            site_compat.recon_ok_hosts(),
            frozenset({"http-ok.example", "spa.example", "jobs.spa.example"}),
        )
        self.assertEqual(site_compat.recon_ok_hosts(str(self.http)), frozenset({"http-ok.example"}))

    def test_stale_browser_file_does_not_count(self):
        stale = self.browser.stat().st_mtime - site_compat.RECON_MAX_AGE - 60
        os.utime(self.browser, (stale, stale))
        self.assertFalse(site_compat.live_ready("https://spa.example/vacancy/7"))
        self.assertIsNone(site_compat.live_ready_source("https://spa.example/vacancy/7"))
        self.assertTrue(site_compat.live_ready("https://http-ok.example/x"))

    def test_missing_or_broken_browser_file_is_empty(self):
        self.browser.write_text("not json", encoding="utf-8")
        self.assertFalse(site_compat.live_ready("https://spa.example/vacancy/7"))
        self.browser.unlink()
        self.assertFalse(site_compat.live_ready("https://spa.example/vacancy/7"))
        self.assertTrue(site_compat.live_ready("https://http-ok.example/x"))


if __name__ == "__main__":
    unittest.main()
