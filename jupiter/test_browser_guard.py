#!/usr/bin/env python3
"""Защита браузерного движка на синтетических страницах, без внешней сети.

Имена good.test / evil.test / other.test пиннятся на 127.0.0.1 тем же
механизмом, что и в бою (--host-resolver-rules). Нужен Playwright и Chromium
(JUPITER_CHROMIUM); без них браузерные тесты пропускаются.
"""
from __future__ import annotations

import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import browser_guard as bg

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)

PAGES = {
    "/": "<title>home</title><p>home</p>",
    "/landing": "<title>landing</title><p>landing</p>",
    "/popup_evil": "<button id=b onclick=\"window.open('http://evil.test:%(port)s/')\">x</button>",
    "/popup_good": "<button id=b onclick=\"window.open('http://good.test:%(port)s/landing')\">x</button>",
    "/blank_evil": "<a id=a target=_blank href='http://evil.test:%(port)s/'>x</a>",
    "/dialogs": "<script>alert('a'); window.r = confirm('c'); window.p = prompt('p');"
                "window.onbeforeunload = () => 'stay?';</script><p>ok</p>",
    "/perms": "<p>perms</p>",
    "/upload": "<input type=file id=f><button id=b onclick=\"document.getElementById('f').click()\">go</button>",
    "/download": "<a id=a href='/file.bin'>dl</a>",
}


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/file.bin":
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", "attachment; filename=x.bin")
            self.end_headers()
            self.wfile.write(b"secret")
            return
        if path == "/setcookie":
            self.send_response(200)
            self.send_header("Set-Cookie", "sid=candidate1; Path=/")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        body = (PAGES.get(path, "nope") % {"port": self.server.server_port}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)


class ArgsTest(unittest.TestCase):
    def test_pins_become_host_resolver_rules(self):
        args = bg.chromium_args_for_pins({"hh.ru": "1.2.3.4"})
        self.assertIn("--host-resolver-rules=MAP hh.ru 1.2.3.4", args)
        self.assertIn("--force-webrtc-ip-handling-policy=disable_non_proxied_udp", args)

    def test_strict_denies_everything_else_after_pins(self):
        rules = [a for a in bg.chromium_args_for_pins({"a.ru": "1.2.3.4"}, strict=True)
                 if a.startswith("--host-resolver-rules")][0]
        self.assertEqual(rules, "--host-resolver-rules=MAP a.ru 1.2.3.4, MAP * ~NOTFOUND")

    def test_pin_to_internal_address_refused(self):
        with self.assertRaises(bg.GuardError):
            bg.chromium_args_for_pins({"a.ru": "169.254.169.254"})
        bg.chromium_args_for_pins({"a.test": "127.0.0.1"}, allow_private=True)

    def test_rule_injection_refused(self):
        with self.assertRaises(bg.GuardError):
            bg.chromium_args_for_pins({"a.ru, MAP * 10.0.0.1": "1.2.3.4"})

    def test_upload_paths_only_resume(self):
        with tempfile.TemporaryDirectory() as tmp:
            resume = Path(tmp, "cv.pdf")
            resume.write_bytes(b"%PDF")
            link = Path(tmp, "link.pdf")
            link.symlink_to("/etc/passwd")
            self.assertEqual(bg.check_upload_paths([resume], [resume]), [str(resume.resolve())])
            with self.assertRaises(bg.GuardError):
                bg.check_upload_paths(["/etc/passwd"], [resume])
            with self.assertRaises(bg.GuardError):
                bg.check_upload_paths([link], [resume])


@unittest.skipUnless(sync_playwright and CHROMIUM, "нужен Playwright и Chromium")
class BrowserGuardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.port = cls.server.server_port
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.resume = str(Path(cls.tmp.name, "cv.pdf"))
        Path(cls.resume).write_bytes(b"%PDF-1.4 resume")
        cls.pw = sync_playwright().start()
        pins = {"good.test": "127.0.0.1", "evil.test": "127.0.0.1"}
        args = bg.chromium_args_for_pins(pins, strict=True, allow_private=True)
        cls.browser = cls.pw.chromium.launch(executable_path=CHROMIUM, args=args)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.tmp.cleanup()

    def setUp(self):
        self.ctx = self.browser.new_context(**bg.CONTEXT_SAFE_OPTIONS)
        self.page = self.ctx.new_page()
        self.allowed = {"good.test"}
        self.journal = bg.install_guards(self.ctx, self.page, self.allowed, [self.resume])

    def tearDown(self):
        self.ctx.close()

    def url(self, path, host="good.test"):
        return f"http://{host}:{self.port}{path}"

    def decisions(self):
        return [e.get("decision") for e in self.journal if e["action"] == "guard_popup"]

    def test_pinned_name_loads_and_unpinned_name_does_not_resolve(self):
        self.page.goto(self.url("/"))
        self.assertEqual(self.page.title(), "home")
        with self.assertRaises(Exception):
            self.page.goto(self.url("/", "other.test"))

    def test_popup_to_foreign_host_is_closed(self):
        self.page.goto(self.url("/popup_evil"))
        self.page.click("#b")
        self.page.wait_for_timeout(1500)
        self.assertEqual(self.decisions(), ["closed"])
        self.assertEqual(len(self.ctx.pages), 1)
        self.assertIn("/popup_evil", self.page.url)
        # запрос к чужому хосту оборван до отправки, а не просто окно закрыто
        self.assertIn("popup_host_not_allowed", [e.get("reason") for e in self.journal])

    def test_target_blank_to_foreign_host_is_closed(self):
        self.page.goto(self.url("/blank_evil"))
        self.page.click("#a")
        self.page.wait_for_timeout(1500)
        self.assertEqual(self.decisions(), ["closed"])
        self.assertEqual(len(self.ctx.pages), 1)

    def test_popup_to_allowed_host_opens_in_same_tab(self):
        self.page.goto(self.url("/popup_good"))
        self.page.click("#b")
        self.page.wait_for_url("**/landing", timeout=5000)
        self.assertEqual(self.decisions(), ["same_tab"])
        self.assertEqual(len(self.ctx.pages), 1)

    def test_dialogs_do_not_hang(self):
        self.page.goto(self.url("/dialogs"))
        self.assertEqual(self.page.evaluate("[window.r, window.p]"), [False, None])
        types = [e["type"] for e in self.journal if e["action"] == "guard_dialog"]
        self.assertEqual(types, ["alert", "confirm", "prompt"])
        self.page.goto(self.url("/"))  # beforeunload не удерживает уход
        self.assertEqual(self.page.title(), "home")

    def test_permissions_webrtc_and_service_worker_denied(self):
        self.page.goto(self.url("/perms"))
        geo = self.page.evaluate(
            "new Promise(r => navigator.geolocation.getCurrentPosition("
            "() => r('granted'), e => r('code' + e.code), {timeout: 3000}))")
        self.assertEqual(geo, "code1")
        cam = self.page.evaluate(
            "navigator.mediaDevices ? navigator.mediaDevices.getUserMedia({video: true})"
            ".then(() => 'granted', e => e.name) : 'no-api'")
        self.assertIn(cam, {"NotAllowedError", "NotFoundError", "no-api"})
        self.assertNotEqual(cam, "granted")
        self.assertEqual(self.page.evaluate("typeof RTCPeerConnection"), "undefined")
        self.assertEqual(self.page.evaluate("typeof navigator.serviceWorker"), "undefined")

    def test_file_scheme_is_blocked(self):
        try:
            self.page.goto("file:///etc/passwd")
        except Exception:
            pass
        self.page.wait_for_timeout(500)
        self.assertNotIn("root:", self.page.content())
        self.assertFalse(self.page.url.startswith("file:"))

    def test_file_chooser_gets_only_resume(self):
        self.page.goto(self.url("/upload"))
        self.page.click("#b")
        self.page.wait_for_timeout(500)
        names = self.page.evaluate("Array.from(document.getElementById('f').files).map(f => f.name)")
        self.assertEqual(names, ["cv.pdf"])
        with self.assertRaises(bg.GuardError):
            bg.check_upload_paths(["/etc/passwd"], [self.resume])

    def test_download_is_cancelled(self):
        self.page.goto(self.url("/download"))
        self.page.click("#a")
        self.page.wait_for_timeout(1000)
        self.assertEqual(len(self.ctx.pages), 1)
        self.assertEqual(self.page.title(), "")

    def test_cookies_are_not_shared_between_candidates(self):
        self.page.goto(self.url("/setcookie"))
        self.assertTrue(any(c["name"] == "sid" for c in self.ctx.cookies()))
        with bg.isolated_context(self.browser) as other:
            p = other.new_page()
            p.goto(self.url("/"))
            self.assertEqual(other.cookies(), [])
            self.assertEqual(p.evaluate("document.cookie"), "")


if __name__ == "__main__":
    unittest.main()
