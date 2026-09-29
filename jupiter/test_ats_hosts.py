#!/usr/bin/env python3
"""Таблица ATS и extra_allowed_hosts — без сети."""
from __future__ import annotations

import unittest

from ats_hosts import ats_for_url, extra_allowed_hosts


class AtsHostsTest(unittest.TestCase):
    def test_known_ats_matches_subdomain_and_url(self):
        info = ats_for_url("https://acme.potok.io/vacancy/1")
        self.assertEqual(info.name, "Potok")
        self.assertTrue(info.can_apply)
        self.assertEqual(ats_for_url("app.huntflow.io").name, "Huntflow")

    def test_lookalike_is_not_matched(self):
        self.assertIsNone(ats_for_url("https://evilpotok.io/"))
        self.assertIsNone(ats_for_url("https://potok.io.evil.com/"))
        self.assertIsNone(ats_for_url("https://example.com/"))

    def test_hh_recognized_but_not_appliable(self):
        self.assertFalse(ats_for_url("https://hh.ru/vacancy/1").can_apply)
        self.assertFalse(ats_for_url("https://img.hhcdn.ru/x.js").can_apply)

    def test_extra_hosts_only_known_appliable(self):
        got = extra_allowed_hosts(
            "https://company.ru/jobs",
            ["acme.huntflow.io", "hh.ru", "mc.yandex.ru", "google-analytics.com", "forms.yandex.ru"],
        )
        self.assertEqual(got, {"acme.huntflow.io", "forms.yandex.ru"})

    def test_vacancy_host_itself_is_ats(self):
        self.assertEqual(extra_allowed_hosts("https://x.talantix.ru/v/1", []), {"x.talantix.ru"})
        self.assertEqual(extra_allowed_hosts("https://hh.ru/vacancy/1", None), set())


if __name__ == "__main__":
    unittest.main()
