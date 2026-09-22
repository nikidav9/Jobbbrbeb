#!/usr/bin/env python3
"""Доказательства отправки и отпечаток отклика. Без сети.

Здесь проверяется то, чего дороже всего стоит ошибка: ложное «отправлено» и
повторная подача одному работодателю.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from agent import normalize
from submission import (
    ApplicationFingerprint, Receipt, ReceiptStore,
    canonical_url, collect_evidence, is_confirmed, score_evidence,
)

MARKERS = ("спасибо за отклик", "application received")


def evidence(**kwargs):
    base = dict(
        before_url="http://e.ru/apply",
        before_text="Анкета кандидата",
        after_url="http://e.ru/apply",
        after_text="Анкета кандидата",
        after_status=200,
        success_markers=MARKERS,
        form_gone=False,
        normalize=normalize,
    )
    base.update(kwargs)
    return collect_evidence(**base)


class CanonicalUrl(unittest.TestCase):
    def test_tracking_parameters_do_not_make_a_new_application(self):
        self.assertEqual(
            canonical_url("https://E.ru/vacancy/7?utm_source=mail&gclid=x"),
            canonical_url("https://e.ru/vacancy/7"),
        )

    def test_meaningful_query_is_kept_and_ordered(self):
        self.assertEqual(
            canonical_url("https://e.ru/v?b=2&a=1"),
            canonical_url("https://e.ru/v?a=1&b=2"),
        )
        self.assertIn("a=1", canonical_url("https://e.ru/v?a=1"))

    def test_fragment_and_trailing_slash_are_dropped(self):
        self.assertEqual(
            canonical_url("https://e.ru/vacancy/7/#form"),
            canonical_url("https://e.ru/vacancy/7"),
        )


class Fingerprint(unittest.TestCase):
    def build(self, **kwargs):
        base = dict(
            candidate_id="a@b.ru",
            vacancy_url="https://e.ru/vacancy/7",
            apply_url="https://e.ru/apply",
            control_names=["email", "first_name"],
            action="/send",
        )
        base.update(kwargs)
        return ApplicationFingerprint.build(**base)

    def test_same_application_through_a_campaign_link_is_the_same_key(self):
        self.assertEqual(
            self.build().key(),
            self.build(vacancy_url="https://e.ru/vacancy/7?utm_source=mail").key(),
        )

    def test_another_candidate_is_another_key(self):
        self.assertNotEqual(self.build().key(), self.build(candidate_id="c@d.ru").key())

    def test_another_vacancy_is_another_key(self):
        self.assertNotEqual(
            self.build().key(), self.build(vacancy_url="https://e.ru/vacancy/8").key()
        )

    def test_field_order_does_not_change_the_key(self):
        self.assertEqual(
            self.build().key(),
            self.build(control_names=["first_name", "email"]).key(),
        )

    def test_employer_is_taken_from_the_vacancy_host(self):
        self.assertEqual(self.build().employer, "e.ru")


class Store(unittest.TestCase):
    def test_receipt_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "receipts.json")
            ReceiptStore(path).record(Receipt(key="k1", status="submitted", apply_url="u"))
            self.assertIsNotNone(ReceiptStore(path).find("k1"))

    def test_broken_journal_does_not_break_the_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "receipts.json"
            path.write_text("{ not json", encoding="utf-8")
            store = ReceiptStore(str(path))
            self.assertIsNone(store.find("k1"))
            store.record(Receipt(key="k1", status="submitted", apply_url="u"))
            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8"))["k1"]["status"],
                "submitted",
            )


class Evidence(unittest.TestCase):
    def test_http_200_is_not_success(self):
        items = evidence(after_status=200)
        self.assertEqual([i.type for i in items], ["HTTP_RESPONSE"])
        self.assertFalse(is_confirmed(items))
        self.assertEqual(score_evidence(items), 0.0)

    def test_marker_that_was_there_before_proves_nothing(self):
        # Сайт со «спасибо за отклик» в подвале иначе подтверждал бы что угодно.
        items = evidence(
            before_text="Анкета. Спасибо за отклик — так мы отвечаем всем.",
            after_text="Анкета. Спасибо за отклик — так мы отвечаем всем.",
        )
        self.assertFalse(any(i.type == "DOM_TEXT" for i in items))
        self.assertFalse(is_confirmed(items))

    def test_marker_that_appeared_only_after_submit_confirms(self):
        items = evidence(after_text="Спасибо за отклик! Мы свяжемся с вами.")
        self.assertTrue(is_confirmed(items))

    def test_form_gone_alone_is_not_enough(self):
        items = evidence(form_gone=True, after_text="Войдите в личный кабинет")
        self.assertFalse(is_confirmed(items))

    def test_form_gone_plus_confirmation_url_is_enough(self):
        items = evidence(
            form_gone=True,
            after_url="http://e.ru/apply/thank-you",
            after_text="Готово",
        )
        self.assertTrue(is_confirmed(items))

    def test_application_id_confirms_and_is_extracted(self):
        items = evidence(after_text="Ваша заявка № A-10294 принята")
        self.assertTrue(is_confirmed(items))
        ids = [i.value for i in items if i.type == "APPLICATION_ID"]
        self.assertEqual(ids, ["A-10294"])

    def test_json_accepted_confirms(self):
        items = evidence(after_text='{"accepted": true, "id": "77"}')
        self.assertTrue(is_confirmed(items))
        self.assertIn("APPLICATION_ID", [i.type for i in items])

    def test_json_accepted_false_does_not_confirm(self):
        items = evidence(after_text='{"accepted": false}')
        self.assertFalse(is_confirmed(items))

    def test_same_url_confirmation_path_is_not_counted_twice(self):
        # Адрес не менялся — значит редиректа на подтверждение не было.
        items = evidence(
            before_url="http://e.ru/thank-you",
            after_url="http://e.ru/thank-you",
            after_text="Готово",
        )
        self.assertFalse(any(i.type == "URL" for i in items))


if __name__ == "__main__":
    unittest.main(verbosity=2)
