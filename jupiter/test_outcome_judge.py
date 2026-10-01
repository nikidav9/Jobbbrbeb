"""Исход отправки без явного подтверждения: сайт подсветил поля или модель
прочитала страницу (решение владельца 01.10.2026)."""
from __future__ import annotations

import json
import unittest

from agent import CandidateProfile, JupiterAgent, Reason
from browser_planner import judge_outcome
from engine import PageState
from submission import ReceiptStore


def page(text: str, title: str = "Вакансия") -> PageState:
    return PageState(url="https://career.example.ru/vacancy/1", status=200, headers={}, html="",
                     title=title, text=text, controls=[], forms=[], has_script=False)


class FakeLLM:
    def __init__(self, answer):
        self.answer = answer
        self.prompts: list[str] = []

    def complete_json(self, system, user, schema=""):
        self.prompts.append(user)
        return self.answer


class FakeEngine:
    read_only = False
    last_submit_feedback = None


class JudgeOutcome(unittest.TestCase):
    def test_accepted_only_with_quote_from_the_page(self):
        llm = FakeLLM({"verdict": "accepted", "quote": "Спасибо! Ваш отклик отправлен", "fields": []})
        got = judge_outcome(llm, {"title": "", "text": "Спасибо!  Ваш отклик отправлен. Мы свяжемся"})
        self.assertEqual(got["verdict"], "accepted")
        invented = FakeLLM({"verdict": "accepted", "quote": "Отклик принят", "fields": []})
        self.assertIsNone(judge_outcome(invented, {"text": "Заполните обязательные поля"}))

    def test_candidate_values_never_reach_the_model(self):
        llm = FakeLLM({"verdict": "unknown", "quote": "", "fields": []})
        judge_outcome(llm, {"title": "Иванов", "text": "Иванов Пётр, ivanov@mail.ru, +7 999 123-45-67",
                            "errors": ["Номер +7 999 123-45-67 уже есть"]},
                      ["Иванов", "ivanov@mail.ru", "+7 999 123-45-67"])
        wire = llm.prompts[0]
        for bad in ("Иванов", "ivanov@mail.ru", "999 123"):
            self.assertNotIn(bad, wire)

    def test_fields_must_exist_on_the_page(self):
        llm = FakeLLM({"verdict": "needs_fix", "quote": "", "fields": ["Телефон", "Паспорт"]})
        got = judge_outcome(llm, {"text": "Поле Телефон заполнено неверно"})
        self.assertEqual(got, {"verdict": "needs_fix", "quote": "", "fields": ["Телефон"]})


class ApplyClick(unittest.TestCase):
    def test_section_link_is_not_an_apply_button(self):
        from browser_planner import suggest_apply_click
        outline = {"clickables": [{"jt": "p0", "text": "Вакансии", "role": "a"},
                                  {"jt": "p1", "text": "Откликнуться", "role": "button"}]}
        self.assertIsNone(suggest_apply_click(FakeLLM({"label": "p0"}), outline))
        self.assertEqual(suggest_apply_click(FakeLLM({"label": "p1"}), outline), "p1")


class NoClimbingUp(unittest.TestCase):
    """Со страницы вакансии не уходить в её раздел (29 сайтов, 01.10.2026)."""

    def test_ancestor_section_is_skipped_but_apply_link_kept(self):
        from engine import ControlState  # noqa: F401 — PageState без полей
        agent = JupiterAgent({"binom.systems"}, engine=FakeEngine(), receipts=ReceiptStore(None))
        agent.engine.allowed_hosts = {"binom.systems"}
        agent._root_url = "https://binom.systems/vakansii/analitik-1s/"
        html_links = [("https://binom.systems/vakansii/", "Все вакансии"),
                      ("https://binom.systems/vakansii/?apply=analitik-1s", "Откликнуться")]
        agent._extract_links = lambda page: html_links
        agent._spa_links = lambda page: []
        agent._navigation_score = lambda url, text: 10 if "vakansii" in url else 0
        best = agent._best_navigation(page("x"), set())
        self.assertEqual(best[0], "https://binom.systems/vakansii/?apply=analitik-1s")
        agent._extract_links = lambda page: html_links[:1]
        self.assertIsNone(agent._best_navigation(page("x"), set()))


class AgentVerdict(unittest.TestCase):
    def agent(self, judge=None):
        return JupiterAgent({"career.example.ru"}, engine=FakeEngine(), receipts=ReceiptStore(None),
                            outcome_judge=judge)

    def test_site_marked_fields_mean_not_sent_without_model(self):
        agent = self.agent()
        agent.engine.last_submit_feedback = {"invalid": [{"label": "Телефон", "type": "tel", "message": ""}],
                                             "errors": []}
        verdict = agent._site_verdict(page("Анкета"), CandidateProfile(values={}))
        trajectory: list[dict] = []
        result = agent._apply_verdict(verdict, None, page("Анкета"), [], trajectory)
        self.assertEqual((result.status, result.reason_code), ("action_required", Reason.SITE_NEEDS_FIX))
        self.assertIn("«Телефон»", result.reason)

    def test_model_success_records_receipt_and_secrets_passed(self):
        seen = {}

        def judge(summary, secrets):
            seen["secrets"] = secrets
            return {"verdict": "accepted", "quote": "Отклик отправлен", "fields": []}
        agent = self.agent(judge)
        verdict = agent._site_verdict(page("Отклик отправлен"),
                                      CandidateProfile(values={"email": "a@b.ru", "consent": True}))
        self.assertEqual(seen["secrets"], ["a@b.ru"])
        result = agent._apply_verdict(verdict, None, page("Отклик отправлен"), [], [])
        self.assertEqual(result.status, "submitted")

    def test_unknown_keeps_old_behaviour(self):
        agent = self.agent(lambda s, x: {"verdict": "unknown", "quote": "", "fields": []})
        verdict = agent._site_verdict(page("Что-то"), CandidateProfile(values={}))
        self.assertIsNone(agent._apply_verdict(verdict, None, page("Что-то"), [], []))
        self.assertIsNone(self.agent()._site_verdict(page("x"), CandidateProfile(values={})))

    def test_judge_crash_is_ignored(self):
        def boom(summary, secrets):
            raise RuntimeError("сеть")
        self.assertIsNone(self.agent(boom)._site_verdict(page("x"), CandidateProfile(values={})))


if __name__ == "__main__":
    unittest.main()
