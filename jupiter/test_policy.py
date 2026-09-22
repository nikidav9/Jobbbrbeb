#!/usr/bin/env python3
"""Сетевая политика: SSRF, петля, rebinding. Без выхода наружу."""
from __future__ import annotations

import unittest

import policy as policy_module
from engine import EngineSecurityError, JupiterWebEngine
from policy import NetworkPolicy, PolicyError, is_blocked_address


class FakeDNS:
    """Подменённый резолвер: настоящий DNS в тестах недопустим."""

    def __init__(self, mapping):
        self.mapping = mapping
        self.calls = []

    def __call__(self, host):
        self.calls.append(host)
        if host not in self.mapping:
            raise PolicyError(f"Host '{host}' does not resolve")
        return list(self.mapping[host])


class BlockedRanges(unittest.TestCase):
    def test_internal_and_metadata_addresses_are_blocked(self):
        for address in (
            "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1",
            "169.254.169.254",  # метаданные облака
            "::1", "fc00::1", "0.0.0.0",
        ):
            self.assertTrue(is_blocked_address(address), address)

    def test_public_addresses_are_not_blocked(self):
        for address in ("93.184.216.34", "8.8.8.8", "2606:2800:220:1::1"):
            self.assertFalse(is_blocked_address(address), address)

    def test_a_name_is_not_an_address(self):
        self.assertFalse(is_blocked_address("example.com"))


class Resolution(unittest.TestCase):
    def setUp(self):
        self._real = NetworkPolicy.resolve

    def tearDown(self):
        NetworkPolicy.resolve = self._real

    def use(self, mapping):
        fake = FakeDNS(mapping)
        NetworkPolicy.resolve = staticmethod(fake)
        return fake

    def test_allowed_host_pointing_inside_is_refused(self):
        # Ровно так выглядит SSRF через разрешённый домен: имя из списка, а за
        # ним внутренний адрес.
        self.use({"careers.example.com": ["10.0.0.5"]})
        policy = NetworkPolicy({"careers.example.com"})
        with self.assertRaises(PolicyError) as caught:
            policy.check_url("https://careers.example.com/apply")
        self.assertIn("blocked address", str(caught.exception))

    def test_metadata_address_is_refused(self):
        self.use({"careers.example.com": ["169.254.169.254"]})
        with self.assertRaises(PolicyError):
            NetworkPolicy({"careers.example.com"}).check_url(
                "https://careers.example.com/"
            )

    def test_one_bad_answer_among_good_ones_is_enough_to_refuse(self):
        # Round-robin с одним внутренним адресом — это тот же rebinding,
        # только без второго запроса.
        self.use({"careers.example.com": ["93.184.216.34", "10.0.0.5"]})
        with self.assertRaises(PolicyError):
            NetworkPolicy({"careers.example.com"}).check_url(
                "https://careers.example.com/"
            )

    def test_public_host_passes_and_returns_its_addresses(self):
        self.use({"careers.example.com": ["93.184.216.34"]})
        addresses = NetworkPolicy({"careers.example.com"}).check_url(
            "https://careers.example.com/apply"
        )
        self.assertEqual(addresses, ["93.184.216.34"])

    def test_name_only_check_does_not_touch_dns(self):
        fake = self.use({})
        NetworkPolicy({"example.test"}).check_url(
            "https://example.test/x", resolve=False
        )
        self.assertEqual(fake.calls, [])


class Loopback(unittest.TestCase):
    def test_loopback_works_when_the_engine_was_told_to_allow_it(self):
        policy = NetworkPolicy({"127.0.0.1"}, allow_private=True)
        self.assertEqual(policy.check_url("http://127.0.0.1:8080/x"), ["127.0.0.1"])

    def test_loopback_in_the_list_is_not_enough_by_itself(self):
        # Список хостов пополняется адресом запуска. Если выводить разрешение
        # из списка, стартовый адрес http://127.0.0.1/ разрешит себя сам.
        policy = NetworkPolicy({"127.0.0.1"}, allow_private=False)
        with self.assertRaises(PolicyError):
            policy.check_url("http://127.0.0.1:8080/x")

    def test_employer_run_cannot_reach_an_internal_literal(self):
        with self.assertRaises(PolicyError):
            NetworkPolicy({"careers.example.com"}).check_url("http://10.0.0.5/x")


class EngineDefaults(unittest.TestCase):
    def test_engine_allows_private_only_when_it_was_built_with_one(self):
        self.assertTrue(JupiterWebEngine({"127.0.0.1"}).allow_private_addresses)
        self.assertFalse(
            JupiterWebEngine({"careers.example.com"}).allow_private_addresses
        )

    def test_a_start_url_cannot_grant_itself_the_permission(self):
        # Так работает агент: хост запуска попадает в список уже после
        # создания движка.
        engine = JupiterWebEngine({"careers.example.com"})
        engine.allowed_hosts.add("127.0.0.1")
        with self.assertRaises(EngineSecurityError):
            engine.assert_reachable("http://127.0.0.1:8080/x")


class UrlShape(unittest.TestCase):
    def test_non_http_schemes_are_refused(self):
        for url in ("file:///etc/passwd", "ftp://e.ru/x", "javascript:1"):
            with self.assertRaises(PolicyError):
                NetworkPolicy({"e.ru"}).check_url(url)

    def test_credentials_in_url_are_refused(self):
        with self.assertRaises(PolicyError):
            NetworkPolicy({"e.ru"}).check_url("https://user:pass@e.ru/x")


class EnginePinning(unittest.TestCase):
    def test_engine_remembers_the_checked_address(self):
        engine = JupiterWebEngine({"127.0.0.1"})
        engine.assert_reachable("http://127.0.0.1:8080/x")
        self.assertEqual(engine._pins["127.0.0.1"], "127.0.0.1")

    def test_engine_refuses_a_host_outside_the_list(self):
        engine = JupiterWebEngine({"127.0.0.1"})
        with self.assertRaises(EngineSecurityError):
            engine.assert_reachable("http://example.com/x")

    def test_engine_name_check_survives_a_non_resolving_logical_url(self):
        # Разбор готового HTML не ходит в сеть: падать из-за DNS тут нельзя.
        engine = JupiterWebEngine({"example.test"})
        engine.assert_allowed("https://example.test/vacancy")


if __name__ == "__main__":
    unittest.main(verbosity=2)
