#!/usr/bin/env python3
"""Вопросы работодателя человеку и ответы на них (NEEDS_ANSWERS, 30.09.2026)."""
from __future__ import annotations

import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from agent import CandidateProfile, JupiterAgent, Reason
from engine import JupiterWebEngine
import browser_planner
from questions import extract_questions, is_special, question_key, question_kind

FORM = """<!doctype html><meta charset="utf-8"><title>Отклик</title>
<h1>Backend-разработчик</h1>
<form method="post" action="/apply">
  <label>Имя <input name="first_name" required></label>
  <label>Email <input name="email" type="email" required></label>
  <label>Телеграм для связи <input name="tg" required></label>
  <label>Откуда вы узнали о вакансии?
    <select name="source" required>
      <option value="">Выберите</option>
      <option value="hh">hh.ru</option>
      <option value="friend">От друзей</option>
    </select></label>
  <label><input type="checkbox" name="agree" required>
    Согласен на обработку персональных данных</label>
  <button type="submit">Откликнуться</button>
</form>"""

SPECIAL_FORM = FORM.replace(
    "<label>Телеграм",
    '<label>Есть ли у вас судимость? <input name="crim" required></label><label>Телеграм',
)


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, body: str) -> None:
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(SPECIAL_FORM if self.path.startswith("/special") else FORM)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.server.posts.append(urllib.parse.parse_qs(self.rfile.read(length).decode()))
        self._send("<h1>Спасибо! Ваш отклик получен</h1>")


def parse(html: str):
    return JupiterWebEngine({"127.0.0.1"}, read_only=True).load_html(html, "http://127.0.0.1/apply")


class ExtractQuestions(unittest.TestCase):
    def setUp(self):
        self.page = parse(FORM)
        self.agent = JupiterAgent({"127.0.0.1"}, dry_run=True)

    def test_every_empty_required_field_is_a_typed_question(self):
        questions, special = extract_questions(self.page, 0, self.agent.descriptor)
        self.assertFalse(special)
        by_name = {q.name: q for q in questions}
        # Согласие — не вопрос: его галочку человек ставит на сайте.
        self.assertNotIn("agree", by_name)
        self.assertEqual(by_name["tg"].type, "text")
        self.assertEqual(by_name["tg"].kind, "fact")
        self.assertEqual(by_name["source"].type, "choice")
        self.assertEqual(by_name["source"].kind, "vacancy")
        self.assertEqual([o["label"] for o in by_name["source"].options], ["hh.ru", "От друзей"])

    def test_special_categories_are_not_asked_here(self):
        self.assertTrue(is_special("Есть ли у вас судимость?"))
        self.assertTrue(is_special("Состояние здоровья"))
        self.assertFalse(is_special("Ваш Telegram"))
        _, special = extract_questions(parse(SPECIAL_FORM), 0, self.agent.descriptor)
        self.assertTrue(special)

    def test_same_question_on_different_sites_has_one_key(self):
        self.assertEqual(question_key("Телеграм для связи*"), question_key("телеграм  для связи"))
        self.assertEqual(question_kind("Когда готовы приступить к работе?"), "fact")
        self.assertEqual(question_kind("Почему вы хотите работать у нас?"), "vacancy")


class AgentAsksAndThenUsesAnswers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.server.posts = []
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def run_agent(self, path: str, answers: dict | None = None, dry_run: bool = True):
        values = {"first_name": "Никита", "email": "n@reply.jobtoo.ru",
                  "personal_data_consent": True}
        if answers:
            values["answers"] = answers
        with tempfile.TemporaryDirectory() as tmp:
            resume = Path(tmp) / "cv.pdf"
            resume.write_bytes(b"%PDF-1.4\n%%EOF\n")
            profile = CandidateProfile(values=values, resume_path=str(resume))
            agent = JupiterAgent({"127.0.0.1"}, dry_run=dry_run)
            return agent.run(f"http://127.0.0.1:{self.port}{path}", profile)

    def test_missing_answers_become_questions_for_the_candidate(self):
        result = self.run_agent("/vacancy/1")
        self.assertEqual(result.reason_code, Reason.NEEDS_ANSWERS, result.reason)
        self.assertEqual({q["name"] for q in result.questions}, {"tg", "source"})

    def test_special_question_goes_to_the_site_not_to_the_queue(self):
        result = self.run_agent("/special/1")
        self.assertNotEqual(result.reason_code, Reason.NEEDS_ANSWERS)
        self.assertEqual(result.questions, [])

    def test_answers_are_filled_and_the_application_is_sent(self):
        answers = {
            question_key("Телеграм для связи"): "@nikita",
            question_key("Откуда вы узнали о вакансии?"): "От друзей",
        }
        self.server.posts.clear()
        result = self.run_agent("/vacancy/2", answers, dry_run=False)
        self.assertEqual(result.status, "submitted", result.reason)
        body = self.server.posts[-1]
        self.assertEqual(body["tg"], ["@nikita"])
        self.assertEqual(body["source"], ["friend"])

    def test_answer_that_is_not_among_the_site_options_is_not_forced(self):
        answers = {
            question_key("Телеграм для связи"): "@nikita",
            question_key("Откуда вы узнали о вакансии?"): "Из рекламы",
        }
        result = self.run_agent("/vacancy/3", answers)
        self.assertEqual(result.reason_code, Reason.NEEDS_ANSWERS)
        self.assertEqual([q["name"] for q in result.questions], ["source"])


class _FakeLLM:
    """Подставная нейросеть: запоминает, что ей показали, и отвечает заготовкой."""

    def __init__(self, answer):
        self.answer = answer
        self.seen = []

    def complete_json(self, system, user, schema_hint=""):
        self.seen.append(user)
        return self.answer


class YandexGPTExplainsQuestions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.server.posts = []
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        browser_planner._QUESTION_CACHE.clear()
        self.questions = [
            {"key": question_key("КОМПАНИЯ"), "text": "КОМПАНИЯ", "type": "text", "kind": "vacancy", "options": []},
        ]

    def test_unclear_label_gets_a_clear_question_and_hint(self):
        llm = _FakeLLM({"questions": {"q0": {
            "question": "В какой компании вы сейчас работаете?",
            "hint": "Название текущего работодателя. Если не работаете — так и напишите.",
            "kind": "fact"}}})
        got = browser_planner.explain_questions(llm, self.questions, {
            "host": "www.it-one.ru", "title": "Вакансии IT_One",
            "fields": ["ИМЯ", "ФАМИЛИЯ", "EMAIL", "ТЕЛЕФОН", "КОМПАНИЯ"]})
        item = got[question_key("КОМПАНИЯ")]
        self.assertEqual(item["question"], "В какой компании вы сейчас работаете?")
        self.assertEqual(item["kind"], "fact")
        self.assertIn("КОМПАНИЯ", llm.seen[0])

    def test_garbage_answer_leaves_the_question_as_is(self):
        for bad in ({}, {"questions": "нет"}, {"questions": {"q0": {"question": ""}}},
                    {"questions": {"q9": {"question": "Чужой вопрос?"}}}):
            browser_planner._QUESTION_CACHE.clear()
            self.assertEqual(browser_planner.explain_questions(_FakeLLM(bad), self.questions, {}), {})

    def test_agent_adds_display_without_touching_key_and_hides_candidate(self):
        llm = _FakeLLM({"questions": {
            "q0": {"question": "Ваш ник в Телеграме для связи?", "hint": "Например, @ivan.", "kind": "fact"},
        }})
        values = {"first_name": "Никита", "email": "n@reply.jobtoo.ru", "personal_data_consent": True}
        with tempfile.TemporaryDirectory() as tmp:
            resume = Path(tmp) / "cv.pdf"
            resume.write_bytes(b"%PDF-1.4\n%%EOF\n")
            agent = JupiterAgent({"127.0.0.1"}, dry_run=True, question_explainer=lambda qs, ctx:
                                 browser_planner.explain_questions(llm, qs, ctx))
            result = agent.run(f"http://127.0.0.1:{self.port}/vacancy/9",
                               CandidateProfile(values=values, resume_path=str(resume)))
        self.assertEqual(result.reason_code, Reason.NEEDS_ANSWERS, result.reason)
        tg = next(q for q in result.questions if q["name"] == "tg")
        self.assertEqual(tg["key"], question_key("Телеграм для связи"))
        self.assertEqual(tg["display"], "Ваш ник в Телеграме для связи?")
        # Данные кандидата нейросеть не видит.
        self.assertTrue(llm.seen)
        for secret in ("Никита", "n@reply.jobtoo.ru"):
            self.assertNotIn(secret, llm.seen[0])


if __name__ == "__main__":
    unittest.main()
