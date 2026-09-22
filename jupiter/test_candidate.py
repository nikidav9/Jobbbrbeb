#!/usr/bin/env python3
"""Согласия, факты и то, что нельзя подразумевать. Без сети."""
from __future__ import annotations

import unittest

from candidate import (
    FieldClass, classify_key, consent_kinds, decide_consent, provenance_for,
)


class Classification(unittest.TestCase):
    def test_legal_questions_are_not_ordinary_facts(self):
        for key in ("citizenship", "work_authorization", "driving_license"):
            self.assertEqual(classify_key(key), FieldClass.LEGAL, key)

    def test_preferences_and_generated_text_are_separate(self):
        self.assertEqual(classify_key("desired_salary"), FieldClass.PREFERENCE)
        self.assertEqual(classify_key("cover_letter"), FieldClass.GENERATED)

    def test_plain_contact_data_is_a_fact(self):
        self.assertEqual(classify_key("email"), FieldClass.FACT)

    def test_provenance_names_the_source(self):
        self.assertEqual(
            provenance_for("email", {"email": "a@b.ru"})["source"], "PROFILE"
        )
        self.assertEqual(
            provenance_for("cover_letter", {})["source"], "GENERATED"
        )


class ConsentRecognition(unittest.TestCase):
    def kinds(self, text):
        return [kind.key for kind in consent_kinds(text)]

    def test_personal_data_consent_is_recognised(self):
        self.assertEqual(
            self.kinds("Согласен на обработку персональных данных"),
            ["personal_data_consent"],
        )

    def test_marketing_is_not_personal_data(self):
        self.assertEqual(
            self.kinds("Хочу получать рекламные рассылки"),
            ["marketing_consent"],
        )

    def test_talent_pool_is_its_own_thing(self):
        self.assertEqual(
            self.kinds("Согласен на включение в кадровый резерв"),
            ["talent_pool_consent"],
        )

    def test_ordinary_checkbox_is_not_a_consent(self):
        self.assertEqual(self.kinds("Готов к командировкам"), [])

    def test_mixed_checkbox_reports_both_kinds(self):
        kinds = self.kinds(
            "Согласен на обработку персональных данных и на получение "
            "рекламных рассылок"
        )
        self.assertIn("personal_data_consent", kinds)
        self.assertIn("marketing_consent", kinds)


class ConsentDecisions(unittest.TestCase):
    PD = "Согласен на обработку персональных данных"
    MARKETING = "Согласен получать рекламные предложения"
    POOL = "Включите меня в кадровый резерв"
    MIXED = "Согласен на обработку персональных данных и на рекламные рассылки"

    def test_required_consent_is_ticked_when_the_candidate_gave_it(self):
        decision = decide_consent(self.PD, {"personal_data_consent": True})
        self.assertEqual(decision.action, "check")

    def test_legacy_single_consent_flag_still_works(self):
        # У старых профилей одно поле consent на всё. Ломать их нельзя.
        self.assertEqual(decide_consent(self.PD, {"consent": True}).action, "check")

    def test_required_consent_without_a_record_asks_the_human(self):
        self.assertEqual(decide_consent(self.PD, {}).action, "ask")

    def test_marketing_is_never_ticked_by_default(self):
        # Даже если человек согласился на обработку данных.
        self.assertEqual(
            decide_consent(self.MARKETING, {"consent": True}).action, "skip"
        )
        self.assertEqual(decide_consent(self.MARKETING, {}).action, "skip")

    def test_talent_pool_is_never_ticked_by_default(self):
        self.assertEqual(decide_consent(self.POOL, {"consent": True}).action, "skip")

    def test_optional_consent_is_ticked_only_when_granted_by_its_own_key(self):
        self.assertEqual(
            decide_consent(self.MARKETING, {"marketing_consent": True}).action,
            "check",
        )

    def test_mixed_checkbox_is_always_a_question_for_the_human(self):
        # Одна галочка на обязательное и необязательное согласие — это выбор
        # человека, а не наш. Даже когда он дал оба по отдельности.
        for values in (
            {},
            {"consent": True},
            {"personal_data_consent": True, "marketing_consent": True},
        ):
            self.assertEqual(decide_consent(self.MIXED, values).action, "ask", values)

    def test_ordinary_checkbox_is_left_to_the_usual_field_mapping(self):
        self.assertEqual(decide_consent("Готов к командировкам", {}).action, "skip")
        self.assertEqual(decide_consent("Готов к командировкам", {}).kinds, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
