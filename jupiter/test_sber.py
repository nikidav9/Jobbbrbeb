#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from agent import CandidateProfile, JupiterAgent, Reason
from engine import JupiterWebEngine
import sber


def page(url: str = "https://rabota.sber.ru/search/vacancy-4368921/"):
    data = {
        "props": {
            "pageProps": {
                "vacancy": {
                    "requisitionId": "req-123",
                    "publicationId": "pub-456",
                }
            }
        }
    }
    return SimpleNamespace(
        url=url,
        html='<html><script id="__NEXT_DATA__" type="application/json">'
             + json.dumps(data)
             + "</script></html>",
    )


class FakeEngine:
    def __init__(self, status=200, body=None):
        self.status = status
        self.body = {"success": True} if body is None else body
        self.calls = []

    def request_json(self, url, *, method="GET", payload=None, headers=None):
        self.calls.append((url, method, payload, headers or {}))
        return self.status, self.body


class SberAdapterTest(unittest.TestCase):
    def profile(self, resume_path: str, *, consent: bool = False):
        values = {
            "last_name": "Иванов",
            "first_name": "Иван",
            "email": "u-test@jobtoo.ru",
            "phone": "+7 (900) 123-45-67",
        }
        if consent:
            values["personal_data_consent"] = True
        return CandidateProfile(values=values, resume_path=resume_path)

    def test_extracts_sber_vacancy_ids_from_next_data(self):
        vacancy = sber.extract_vacancy(page())
        self.assertIsNotNone(vacancy)
        self.assertEqual(vacancy.requisition_id, "req-123")
        self.assertEqual(vacancy.publication_id, "pub-456")

    def test_does_not_claim_other_hosts(self):
        self.assertIsNone(sber.extract_vacancy(page("https://example.com/v/1")))

    def test_builds_same_payload_shape_as_sber_form(self):
        with tempfile.TemporaryDirectory() as td:
            resume = Path(td) / "resume.pdf"
            resume.write_bytes(b"%PDF-1.4\njobtoo\n")
            profile = self.profile(str(resume), consent=True)
            vacancy = sber.extract_vacancy(page())
            payload = sber.build_payload(page(), profile, vacancy)
            self.assertEqual(payload["platform"], "pulse")
            self.assertEqual(payload["vacancyId"], "req-123")
            self.assertEqual(payload["publicationId"], "pub-456")
            self.assertEqual(payload["lastName"], "Иванов")
            self.assertEqual(payload["firstName"], "Иван")
            self.assertEqual(payload["mail"], "u-test@jobtoo.ru")
            self.assertEqual(payload["phone"], "89001234567")
            self.assertTrue(payload["base64"].startswith("data:application/pdf;base64,"))
            self.assertEqual(payload["locationSearch"], "")

    def test_consent_is_explicit_not_implied_by_profile(self):
        with tempfile.TemporaryDirectory() as td:
            resume = Path(td) / "resume.pdf"
            resume.write_bytes(b"%PDF-1.4\n")
            self.assertFalse(sber.has_personal_data_consent(self.profile(str(resume))))
            self.assertTrue(
                sber.has_personal_data_consent(self.profile(str(resume), consent=True))
            )

    def test_submit_uses_sber_public_api_and_success_is_confirmed(self):
        engine = FakeEngine()
        outcome, message, body = sber.submit_payload(
            engine, page(), {"vacancyId": "req-123"}
        )
        self.assertEqual(outcome, "submitted")
        self.assertIsNone(message)
        self.assertEqual(body, {"success": True})
        self.assertEqual(len(engine.calls), 1)
        url, method, payload, headers = engine.calls[0]
        self.assertEqual(url, sber.SBER_APPLICATION_URL)
        self.assertEqual(method, "POST")
        self.assertEqual(payload["vacancyId"], "req-123")
        self.assertEqual(headers["Origin"], "https://rabota.sber.ru")

    def test_duplicate_message_is_not_treated_as_new_submission(self):
        engine = FakeEngine(
            status=400,
            body={"error": {"message": "Candidate has already applied for the job requisition"}},
        )
        outcome, message, _ = sber.submit_payload(engine, page(), {})
        self.assertEqual(outcome, "duplicate")
        self.assertIn("already applied", message)

    def test_agent_stops_for_explicit_sber_consent_before_post(self):
        with tempfile.TemporaryDirectory() as td:
            resume = Path(td) / "resume.pdf"
            resume.write_bytes(b"%PDF-1.4\njobtoo\n")
            agent = JupiterAgent(set(), dry_run=False)
            result = agent.run_loaded_html(
                page().html,
                page().url,
                self.profile(str(resume), consent=False),
            )
            self.assertEqual(result.status, "action_required")
            self.assertEqual(result.reason_code, Reason.CONSENT_REQUIRED)
            self.assertTrue(any(
                item.get("site_adapter") == "sber_public_api"
                for item in result.trajectory
            ))

    def test_agent_submits_sber_only_after_explicit_consent(self):
        with tempfile.TemporaryDirectory() as td:
            resume = Path(td) / "resume.pdf"
            resume.write_bytes(b"%PDF-1.4\njobtoo\n")
            engine = JupiterWebEngine(set())
            calls = []

            def fake_request_json(url, *, method="GET", payload=None, headers=None):
                calls.append((url, method, payload, headers))
                return 200, {"success": True}

            engine.request_json = fake_request_json
            agent = JupiterAgent(set(), engine=engine, dry_run=False)
            guarded = []
            agent.before_submit = lambda url, intermediate: guarded.append(
                (url, intermediate)
            )
            result = agent.run_loaded_html(
                page().html,
                page().url,
                self.profile(str(resume), consent=True),
            )
            self.assertEqual(result.status, "submitted", result.reason)
            self.assertEqual(len(guarded), 1)
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], sber.SBER_APPLICATION_URL)
            self.assertEqual(calls[0][1], "POST")


    def test_navigation_links_on_live_page_do_not_lead_away_from_vacancy(self):
        # Живая страница вакансии Сбера полна ссылок: «Вакансии», «Искать».
        # Агент уходил по ним на /search/ раньше, чем узнавал вакансию, и
        # отдавал UNSUPPORTED_SCRIPT — человек давал согласие, а заявка
        # возвращалась к той же кнопке по кругу.
        with tempfile.TemporaryDirectory() as td:
            resume = Path(td) / "resume.pdf"
            resume.write_bytes(b"%PDF-1.4\njobtoo\n")
            engine = JupiterWebEngine(set())
            calls = []

            def fake_request_json(url, *, method="GET", payload=None, headers=None):
                calls.append((url, method))
                return 200, {"success": True}

            engine.request_json = fake_request_json
            agent = JupiterAgent(set(), engine=engine, dry_run=False)
            live = page().html.replace(
                "<html>",
                '<html><a href="/search/">Вакансии</a> '
                '<a href="/search/?query=">Искать вакансии</a> '
                '<a href="/search/vacancy-1/">Откликнуться на похожую</a>',
            )
            result = agent.run_loaded_html(live, page().url, self.profile(str(resume), consent=True))
            self.assertEqual(result.status, "submitted", result.reason)
            self.assertNotIn("navigate", [item.get("action") for item in result.trajectory])
            self.assertEqual(calls, [(sber.SBER_APPLICATION_URL, "POST")])


if __name__ == "__main__":
    unittest.main(verbosity=2)
