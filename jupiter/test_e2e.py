#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from agent import CandidateProfile, JupiterAgent


APPLICATION_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Native Engine Test</title>
<h1>Backend Developer</h1>
<form action="/submit" method="post" enctype="multipart/form-data">
  <label>First name <input name="first_name" required></label>
  <label>Фамилия <input name="surname" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <label>Город <input name="city" required></label>
  <label>Сколько лет опыта? <input name="experience_years" required></label>
  <label>Формат работы
    <select name="work_format" required>
      <option value="">Выберите</option>
      <option value="Office">Office</option>
      <option value="Hybrid">Hybrid</option>
      <option value="Remote">Remote</option>
    </select>
  </label>
  <label>Why are you interested in this role?
    <textarea name="motivation" required></textarea>
  </label>
  <label>Resume <input type="file" name="resume" required></label>
  <button type="submit">Submit application</button>
</form>
"""

UNKNOWN_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Unknown Field Test</title>
<form action="/submit" method="post">
  <label>Email <input type="email" name="email" required></label>
  <label>Do you require visa sponsorship? <input name="visa_sponsorship" required></label>
  <button type="submit">Submit application</button>
</form>
"""

JS_ONLY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>JS Careers</title>
<div id="root"></div>
<script>window.renderApplicationForm()</script>
"""


JS_RENDERED_FORM_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Script Render Test</title>
<div id="root"></div>
<script>
document.getElementById('root').innerHTML = `<form id="js-form" action="/submit-js" method="post">
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Submit application</button>
</form>`;
</script>
"""

JS_INTERCEPT_SUBMIT_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Script Submit Test</title>
<form id="application-form">
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Submit application</button>
</form>
<div id="success" hidden><h1>Application received</h1><p>Jupiter script success.</p></div>
<script>
const form = document.getElementById('application-form');
form.addEventListener('submit', function(e) {
  e.preventDefault();
  document.getElementById('application-form').hidden = true;
  document.getElementById('success').hidden = false;
});
</script>
"""

PROFILE = {
    "first_name": "Nikita",
    "last_name": "Davydov",
    "email": "nikita.demo@reply.jobtoo.ru",
    "phone": "+79990000000",
    "city": "Москва",
    "experience_years": "4",
    "work_format": "Hybrid",
    "cover_letter": "Мне интересна роль, потому что мой опыт соответствует задачам команды.",
    "resume_path": "resume.txt",
}


class CareersHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _html(self, body: str, status: int = 200, headers: dict[str, str] | None = None):
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/application":
            return self._html(APPLICATION_HTML, headers={"Set-Cookie": "jt_e2e=1; Path=/"})
        if self.path == "/unknown":
            return self._html(UNKNOWN_HTML)
        if self.path == "/js-only":
            return self._html(JS_ONLY_HTML)
        if self.path == "/js-rendered":
            return self._html(JS_RENDERED_FORM_HTML)
        if self.path == "/js-intercept":
            return self._html(JS_INTERCEPT_SUBMIT_HTML)
        if self.path == "/redirect-external":
            self.send_response(302)
            self.send_header("Location", "http://example.com/application")
            self.end_headers()
            return
        self._html("<h1>Not found</h1>", 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)

        if self.path == "/submit-js":
            self.server.state["js_post_count"] += 1
            self.server.state["last_js_body"] = body
            if b"email=" not in body:
                return self._html("<h1>Bad JS application payload</h1>", 400)
            return self._html("<h1>Application received</h1><p>JS-rendered form submitted.</p>")

        if self.path != "/submit":
            return self._html("<h1>Not found</h1>", 404)

        self.server.state["post_count"] += 1
        self.server.state["last_body"] = body
        self.server.state["last_content_type"] = self.headers.get("Content-Type", "")
        self.server.state["last_cookie"] = self.headers.get("Cookie", "")

        if "jt_e2e=1" not in self.server.state["last_cookie"]:
            return self._html("<h1>Cookie missing</h1>", 400)

        required = [
            b'name="first_name"',
            b'name="surname"',
            b'name="email"',
            b'name="phone"',
            b'name="city"',
            b'name="experience_years"',
            b'name="work_format"',
            b'name="motivation"',
            b'name="resume"',
            b"Jupiter test resume",
        ]
        if not all(marker in body for marker in required):
            return self._html("<h1>Bad application payload</h1>", 400)

        return self._html("<h1>Application received</h1><p>Thank you for applying.</p>")


class JupiterNativeE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), CareersHandler)
        cls.server.state = {
            "post_count": 0,
            "last_body": b"",
            "last_content_type": "",
            "last_cookie": "",
            "js_post_count": 0,
            "last_js_body": b"",
        }
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def profile(self, tmp: Path) -> CandidateProfile:
        (tmp / "resume.txt").write_text(
            "Jupiter test resume\nNikita Davydov\n",
            encoding="utf-8",
        )
        profile_path = tmp / "profile.json"
        profile_path.write_text(
            json.dumps(PROFILE, ensure_ascii=False),
            encoding="utf-8",
        )
        return CandidateProfile.load(str(profile_path))

    def run_path(self, path: str):
        with tempfile.TemporaryDirectory() as tmp_dir:
            profile = self.profile(Path(tmp_dir))
            agent = JupiterAgent({"127.0.0.1"})
            result = agent.run(
                f"http://127.0.0.1:{self.port}{path}",
                profile,
            )
            return result, agent

    def test_native_engine_fills_uploads_cookies_and_submits(self):
        result, agent = self.run_path("/application")
        self.assertEqual(
            result.status,
            "submitted",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        actions = [item["action"] for item in result.trajectory]
        self.assertIn("upload", actions)
        self.assertIn("click_submit", actions)
        self.assertIn("http_submit", actions)
        self.assertIn("success_detected", actions)
        self.assertIn("multipart/form-data", self.server.state["last_content_type"])
        self.assertIn("jt_e2e=1", self.server.state["last_cookie"])
        self.assertIn(b"Nikita", self.server.state["last_body"])
        self.assertEqual(agent.engine.page.status, 200)

    def test_unknown_required_field_stops_before_submit(self):
        before = self.server.state["post_count"]
        result, _agent = self.run_path("/unknown")
        self.assertEqual(result.status, "action_required")
        self.assertIn("visa", (result.reason or "").lower())
        self.assertEqual(self.server.state["post_count"], before)
        self.assertNotIn("click_submit", [x["action"] for x in result.trajectory])

    def test_script_runtime_renders_form_then_native_engine_submits(self):
        before = self.server.state["js_post_count"]
        result, agent = self.run_path("/js-rendered")
        self.assertEqual(
            result.status,
            "submitted",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        self.assertEqual(self.server.state["js_post_count"], before + 1)
        self.assertIn(b"email=", self.server.state["last_js_body"])
        snapshot = agent.engine.semantic_snapshot()
        self.assertTrue(
            any(
                item.get("kind") == "dom_mutation"
                for item in snapshot.get("script_diagnostics", [])
            ),
            snapshot,
        )
        self.assertIn("success_detected", [x["action"] for x in result.trajectory])

    def test_script_runtime_handles_prevent_default_submit(self):
        before = self.server.state["js_post_count"]
        result, agent = self.run_path("/js-intercept")
        self.assertEqual(
            result.status,
            "submitted",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        self.assertEqual(self.server.state["js_post_count"], before)
        self.assertIn("Application received", agent.engine.page.text)
        diagnostics = agent.engine.semantic_snapshot().get("script_diagnostics", [])
        self.assertTrue(
            any(item.get("detail") == "preventDefault" for item in diagnostics),
            diagnostics,
        )

    def test_js_only_page_is_explicitly_handed_off(self):
        result, _agent = self.run_path("/js-only")
        self.assertEqual(result.status, "action_required")
        self.assertIn("javascript", (result.reason or "").lower())

    def test_redirect_cannot_escape_allow_list(self):
        result, _agent = self.run_path("/redirect-external")
        self.assertEqual(result.status, "action_required")
        self.assertIn("blocked", (result.reason or "").lower())
        self.assertIn("example.com", result.reason or "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
