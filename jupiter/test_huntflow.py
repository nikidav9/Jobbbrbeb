"""Адаптер Huntflow: отклик через API карьерного сайта (п.3, 01.10.2026)."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import huntflow
from agent import CandidateProfile, JupiterAgent, Reason
from engine import EngineSecurityError, EngineTransportError
from submission import ReceiptStore

URL = "https://emex.huntflow.io/vacancy/analitik-dannykh"
VALUES = {"first_name": "Пётр", "last_name": "Иванов", "phone": "8 (999) 123-45-67",
          "email": "p@example.ru", "personal_data_consent": True}


class FakeApi:
    """request_json как у JupiterWebEngine: read_only режет всё, кроме GET."""

    def __init__(self, response=(200, {}), card=(200, {"id": 26467, "is_archived": False}),
                 upload=(200, {"id": 501}), read_only=False):
        self.response, self.card, self.upload = response, card, upload
        self.read_only = read_only
        self.allowed_hosts: set[str] = set()
        self.calls: list[tuple] = []

    def request_json(self, url, *, method="GET", payload=None, headers=None, files=None):
        self.calls.append((method, url, payload, files))
        if self.read_only and method != "GET":
            raise EngineSecurityError("read-only")
        if url.endswith("/upload"):
            return self.upload
        if url.endswith("/response"):
            if isinstance(self.response, Exception):
                raise self.response
            return self.response
        return self.card

    def open(self, url):  # обычный разбор страницы — не должен понадобиться
        raise AssertionError("page flow must not run")


def agent(api, dry_run=False, receipts=None):
    return JupiterAgent(set(), engine=api, dry_run=dry_run, receipts=receipts or ReceiptStore(None))


class ParseUrl(unittest.TestCase):
    def test_only_vacancy_pages_on_huntflow_subdomains(self):
        self.assertEqual(huntflow.parse_url(URL), huntflow.HuntflowVacancy("https://emex.huntflow.io",
                                                                           "analitik-dannykh"))
        for url in ("https://emex.huntflow.io/", "http://emex.huntflow.io/vacancy/x",
                    "https://huntflow.io/vacancy/x", "https://evil.ru/vacancy/x?h=.huntflow.io",
                    "https://emex.huntflow.io/vacancy/x/apply"):
            self.assertIsNone(huntflow.parse_url(url), url)

    def test_payload_and_phone(self):
        self.assertEqual(huntflow.phone_for_api("8 (999) 123-45-67"), "+79991234567")
        self.assertEqual(huntflow.phone_for_api("9991234567"), "+79991234567")
        payload = huntflow.build_payload(CandidateProfile(values=dict(VALUES)), 7)
        self.assertEqual(payload, {"name": "Пётр", "surname": "Иванов", "phone": "+79991234567",
                                   "email": "p@example.ru", "agreement": True, "file": 7})

    def test_response_reading(self):
        self.assertEqual(huntflow.interpret_response(201, None)[0], "submitted")
        dup = {"data": [{"path": "", "message": huntflow.DUPLICATE_MESSAGE}]}
        self.assertEqual(huntflow.interpret_response(400, dup)[0], "duplicate")
        fix = {"data": [{"path": "email", "message": "invalid email"}]}
        self.assertEqual(huntflow.interpret_response(400, fix), ("needs_fix", "invalid email", ["email"]))
        self.assertEqual(huntflow.interpret_response(500, {"message": "boom"})[:2], ("rejected", "boom"))


class AgentFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.resume = Path(self.tmp.name) / "cv.pdf"
        self.resume.write_bytes(b"%PDF-1.4 test")

    def tearDown(self):
        self.tmp.cleanup()

    def profile(self, **over):
        return CandidateProfile(values={**VALUES, **over}, resume_path=str(self.resume))

    def test_live_send_uploads_resume_and_records_receipt(self):
        api = FakeApi()
        receipts = ReceiptStore(None)
        result = agent(api, receipts=receipts).run(URL, self.profile())
        self.assertEqual(result.status, "submitted")
        methods = [(m, u.rsplit("/", 1)[-1]) for m, u, _, _ in api.calls]
        self.assertEqual(methods, [("GET", "analitik-dannykh"), ("POST", "upload"), ("POST", "response")])
        self.assertEqual(api.calls[2][2]["file"], 501)
        # Повтор не уходит второй раз.
        again = agent(api, receipts=receipts).run(URL, self.profile())
        self.assertEqual((again.status, again.reason_code), ("duplicate", Reason.DUPLICATE_BLOCKED))
        self.assertEqual(len(api.calls), 4)

    def test_dry_run_never_posts(self):
        api = FakeApi(read_only=True)
        result = agent(api, dry_run=True).run(URL, self.profile())
        self.assertEqual(result.status, "ready_to_submit")
        self.assertEqual([m for m, *_ in api.calls], ["GET"])

    def test_no_consent_no_send(self):
        api = FakeApi()
        result = agent(api).run(URL, self.profile(personal_data_consent=False))
        self.assertEqual(result.reason_code, Reason.CONSENT_REQUIRED)
        self.assertEqual([m for m, *_ in api.calls], ["GET"])

    def test_missing_fields_archived_and_site_errors(self):
        r = agent(FakeApi()).run(URL, self.profile(email=""))
        self.assertEqual(r.reason_code, Reason.MISSING_PROFILE_FIELD)
        r = agent(FakeApi(card=(200, {"id": 1, "is_archived": True}))).run(URL, self.profile())
        self.assertEqual(r.reason_code, Reason.VACANCY_NOT_FOUND)
        fix = (400, {"data": [{"path": "phone", "message": "invalid phone"}]})
        r = agent(FakeApi(response=fix)).run(URL, self.profile())
        self.assertEqual((r.status, r.reason_code), ("action_required", Reason.SITE_NEEDS_FIX))
        self.assertIn("«phone»", r.reason)
        dup = (400, {"data": [{"path": "", "message": huntflow.DUPLICATE_MESSAGE}]})
        self.assertEqual(agent(FakeApi(response=dup)).run(URL, self.profile()).status, "duplicate")

    def test_lost_answer_is_unknown_not_retried(self):
        receipts = ReceiptStore(None)
        api = FakeApi(response=EngineTransportError("reset"))
        r = agent(api, receipts=receipts).run(URL, self.profile())
        self.assertEqual(r.status, "submission_unknown")
        again = agent(FakeApi(), receipts=receipts).run(URL, self.profile())
        self.assertEqual(again.status, "submission_unknown")

    def test_resume_upload_failure_still_sends_without_file(self):
        api = FakeApi(upload=(413, {"message": "too big"}))
        self.assertEqual(agent(api).run(URL, self.profile()).status, "submitted")
        self.assertNotIn("file", api.calls[-1][2])

    def test_api_unavailable_falls_back_to_page(self):
        api = FakeApi(card=(404, {"message": "Not Found"}))
        with self.assertRaisesRegex(AssertionError, "page flow"):
            agent(api).run(URL, self.profile())


if __name__ == "__main__":
    unittest.main()
