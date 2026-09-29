#!/usr/bin/env python3
"""Нейросеть для незнакомых полей (field_mapper) — без сети и без нейросети.

Маппер здесь фейковый: он записывает, что ему показали, и отвечает заранее
заданным. Проверяется граница: что уходит наружу (только описания полей и
имена ключей), что принимается обратно (только заполненные ключи) и чего
нейросеть не трогает никогда (согласия).
"""
from __future__ import annotations

import json
import unittest

from agent import CandidateProfile, JupiterAgent

URL = "http://127.0.0.1/careers/vacancy"

FORM = """
<form action="/apply" method="post">
  <label>Как к вам обращаться? <input name="q17" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <label><input type="checkbox" name="agree" required>
    Согласен на обработку персональных данных</label>
  <button type="submit">Откликнуться</button>
</form>
"""

PROFILE = {
    "first_name": "Анна",
    "phone": "+79990001122",
    "email": "anna@example.com",
    "citizenship": "Россия",
}


class FakeMapper:
    def __init__(self, answer=None, error: Exception | None = None):
        self.answer = answer or {}
        self.error = error
        self.calls: list[tuple[list[dict], list[str]]] = []

    def __call__(self, fields, allowed_keys):
        self.calls.append((fields, allowed_keys))
        if self.error is not None:
            raise self.error
        return self.answer


def run(mapper, html: str = FORM, values: dict | None = None):
    agent = JupiterAgent({"127.0.0.1"}, dry_run=True, field_mapper=mapper)
    profile = CandidateProfile(values=dict(values if values is not None else PROFILE))
    return agent.run_loaded_html(html, URL, profile)


def filled(result, name_part: str):
    return [
        item for item in result.trajectory
        if item.get("action") in {"fill", "select", "check"}
        and name_part in str(item.get("field"))
    ]


class FieldMapper(unittest.TestCase):
    def test_without_mapper_the_unknown_field_goes_to_the_human(self):
        result = run(None)
        self.assertEqual(result.status, "action_required")

    def test_unknown_required_field_is_mapped_to_first_name(self):
        mapper = FakeMapper({"q17": "first_name"})
        result = run(mapper, values={**PROFILE, "personal_data_consent": True})
        self.assertEqual(result.status, "ready_to_submit", result.reason)
        self.assertEqual(len(mapper.calls), 1)
        entries = [i for i in result.trajectory if i.get("action") == "llm_map"]
        self.assertEqual(entries, [{"action": "llm_map", "field": "q17", "key": "first_name"}])
        self.assertEqual(filled(result, "q17")[0]["value"], "Анна")

    def test_only_unmapped_fields_and_no_values_leave_the_agent(self):
        mapper = FakeMapper({"q17": "first_name"})
        run(mapper)
        fields, allowed = mapper.calls[0]
        self.assertEqual([f["name"] for f in fields], ["q17"])  # телефон правила узнали
        self.assertEqual(set(fields[0]), {"name", "label", "placeholder", "type", "options"})
        self.assertIn("first_name", allowed)
        # Ни одного значения кандидата — ни в полях, ни в ключах.
        dump = json.dumps(mapper.calls, ensure_ascii=False)
        for value in PROFILE.values():
            self.assertNotIn(value, dump)
        # Юридические ключи нейросети не предлагаются: ошибка там — ложь.
        self.assertNotIn("citizenship", allowed)

    def test_key_outside_allowed_keys_is_rejected(self):
        mapper = FakeMapper({"q17": "passport_number", "phone": "email"})
        result = run(mapper)
        self.assertEqual(result.status, "action_required")
        self.assertFalse([i for i in result.trajectory if i.get("action") == "llm_map"])
        self.assertFalse(filled(result, "q17"))

    def test_consent_checkbox_is_never_offered_nor_checked_by_the_mapper(self):
        mapper = FakeMapper({"q17": "first_name", "agree": "first_name"})
        result = run(mapper)
        fields, allowed = mapper.calls[0]
        self.assertNotIn("agree", [f["name"] for f in fields])
        self.assertFalse(any(k.endswith("consent") for k in allowed))
        # Согласия у кандидата нет — галочка остаётся пустой, решает человек.
        self.assertEqual(result.status, "action_required")
        self.assertFalse([
            i for i in result.trajectory
            if i.get("action") == "check" and "agree" in str(i.get("field"))
        ])

    def test_mapper_error_keeps_the_old_behaviour(self):
        before = run(None)
        after = run(FakeMapper(error=RuntimeError("нейросеть недоступна")))
        self.assertEqual(after.status, before.status)
        self.assertEqual(after.reason_code, before.reason_code)
        self.assertFalse([i for i in after.trajectory if i.get("action") == "llm_map"])

    def test_empty_answer_keeps_the_old_behaviour(self):
        before = run(None)
        after = run(FakeMapper({}))
        self.assertEqual(after.status, before.status)
        self.assertEqual(after.reason_code, before.reason_code)

    def test_mapper_is_not_called_when_rules_fill_everything(self):
        html = (
            '<form action="/apply" method="post">'
            '<label>Имя <input name="first_name" required></label>'
            '<label>Телефон <input type="tel" name="phone" required></label>'
            '<button type="submit">Откликнуться</button></form>'
        )
        mapper = FakeMapper({"first_name": "email"})
        result = run(mapper, html=html)
        self.assertEqual(result.status, "ready_to_submit", result.reason)
        self.assertEqual(mapper.calls, [])

    def test_select_is_described_by_option_texts(self):
        html = (
            '<form action="/apply" method="post">'
            '<label>Телефон <input type="tel" name="phone" required></label>'
            '<label>Откуда вы? <select name="q3" required>'
            '<option value="">—</option><option value="77">Москва</option>'
            '<option value="78">Санкт-Петербург</option></select></label>'
            '<button type="submit">Откликнуться</button></form>'
        )
        mapper = FakeMapper({"q3": "city"})
        result = run(mapper, html=html, values={**PROFILE, "city": "Москва"})
        fields, _ = mapper.calls[0]
        self.assertEqual(fields[0]["type"], "select")
        self.assertEqual(fields[0]["options"], ["—", "Москва", "Санкт-Петербург"])
        self.assertNotIn("77", json.dumps(fields))
        self.assertEqual(result.status, "ready_to_submit", result.reason)


if __name__ == "__main__":
    unittest.main()
