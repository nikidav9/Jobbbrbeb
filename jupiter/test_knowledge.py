"""База знаний Алисы: обучение, подтверждение репетицией, доверие в боевых откликах."""
from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path

import browser_planner
from knowledge import Advisor, CountingLLM, Knowledge, field_sig

HOST = "career.example.ru"
OUTLINE = {"clickables": [
    {"jt": "plan-0", "text": "Войти", "role": "a"},
    {"jt": "plan-1", "text": "Откликнуться", "role": "button"},
]}
PHONE = {"name": "tel", "label": "Мобильный телефон", "type": "tel", "value": "+79990001122"}


class FakeLLM:
    def __init__(self, *answers):
        self.answers = list(answers)
        self.prompts: list[str] = []

    def complete_json(self, system, user, schema=""):
        self.prompts.append(user)
        return self.answers.pop(0) if self.answers else {}


def kb_with(entry: dict) -> Knowledge:
    return Knowledge({"sites": {HOST: entry}})


class KnowledgeTest(unittest.TestCase):
    def setUp(self):
        browser_planner._FIELD_CACHE.clear()
        browser_planner._QUESTION_CACHE.clear()

    def test_field_signature_has_no_values(self):
        self.assertEqual(field_sig(PHONE), "мобильный телефон||tel|tel")
        self.assertEqual(field_sig({"type": "text"}), "")

    def test_known_apply_button_is_clicked_without_model(self):
        adv = Advisor(kb_with({"apply": "откликнуться"}), HOST, llm=None)
        self.assertEqual(adv.apply(OUTLINE), "plan-1")
        self.assertTrue(adv.used)

    def test_forbidden_text_is_never_clicked_from_knowledge(self):
        adv = Advisor(kb_with({"apply": "войти"}), HOST, llm=None)
        self.assertIsNone(adv.apply(OUTLINE))

    def test_model_answer_is_learned_and_examples_reach_the_prompt(self):
        kb = Knowledge({"sites": {
            "a.ru": {"apply": "отправить резюме", "fields": {field_sig(PHONE): "phone"}},
            "b.ru": {"fields": {field_sig(PHONE): "phone"}},
        }})
        llm = FakeLLM({"label": "plan-1"}, {"mapping": {"f0": "email"}})
        adv = Advisor(kb, HOST, llm)
        self.assertEqual(adv.apply(OUTLINE), "plan-1")
        self.assertIn("отправить резюме", llm.prompts[0])
        mail = {"name": "mail", "label": "Почта для связи", "type": "text"}
        self.assertEqual(adv.fields([mail], ["phone", "email"]), {"mail": "email"})
        self.assertIn("мобильный телефон", llm.prompts[1], "пример с двух сайтов виден модели")
        self.assertEqual(adv.learned["apply"], "откликнуться")
        self.assertEqual(adv.learned["fields"], {field_sig(mail): "email"})
        self.assertFalse(adv.used)

    def test_known_fields_skip_the_model(self):
        llm = FakeLLM()
        adv = Advisor(kb_with({"fields": {field_sig(PHONE): "phone"}}), HOST, llm)
        self.assertEqual(adv.fields([PHONE], ["phone"]), {"tel": "phone"})
        self.assertEqual(llm.prompts, [])

    def test_live_trusts_only_fresh_rehearsal_confirmation(self):
        now = time.time()
        fresh = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 3600))
        stale = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 4 * 86400))
        self.assertEqual(kb_with({"apply": "откликнуться"}).site(HOST, live=True), {})
        self.assertEqual(kb_with({"apply": "x", "confirmed_at": stale}).site(HOST, live=True), {})
        self.assertEqual(kb_with({"apply": "x", "confirmed_at": fresh}).site(HOST, live=True)["apply"], "x")
        self.assertIsNone(Advisor(kb_with({"apply": "откликнуться"}), HOST, live=True).apply(OUTLINE))

    def test_rehearsal_confirms_and_failure_breaks(self):
        kb = Knowledge()
        kb.learn(HOST, {"apply": "Откликнуться"}, used=False, klass="dry_run_ok", verdict="would_send")
        self.assertTrue(kb.site(HOST, live=True))
        # Сайт изменился: знание было, до анкеты не дошли.
        kb.learn(HOST, {}, used=True, klass="no_vacancy")
        entry = kb.site(HOST)
        self.assertNotIn("apply", entry)
        self.assertNotIn("confirmed_at", entry)
        self.assertIn("broken_at", entry)
        # CAPTCHA — не вина знания.
        kb.learn(HOST, {"fields": {"a|||text": "phone"}}, used=False, klass="dry_run_ok", verdict="would_send")
        kb.learn(HOST, {}, used=True, klass="captcha")
        self.assertTrue(kb.site(HOST, live=True))

    def test_save_load_and_broken_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "kb.json")
            kb = Knowledge()
            kb.learn(HOST, {"fields": {field_sig(PHONE): "phone"}}, used=False, klass="dry_run_ok")
            kb.save(path)
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            self.assertEqual(data["summary"]["fields"], 1)
            self.assertNotIn("+79990001122", Path(path).read_text(encoding="utf-8"))
            self.assertEqual(Knowledge.load(path).site(HOST)["fields"], {field_sig(PHONE): "phone"})
            Path(path).write_text("{oops", encoding="utf-8")
            self.assertEqual(Knowledge.load(path).sites, {})

    def test_daily_ceiling(self):
        llm = CountingLLM(FakeLLM({}, {}), max_calls=1)
        llm.complete_json("s", "u")
        with self.assertRaises(RuntimeError):
            llm.complete_json("s", "u")
        self.assertEqual(llm.calls, 1)
        # Потолок — как сбой модели: подсказки нет, отклик идёт дальше.
        self.assertIsNone(Advisor(Knowledge(), HOST, llm).apply(OUTLINE))


if __name__ == "__main__":
    unittest.main()
