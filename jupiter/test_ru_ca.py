"""Сертификат Минцифры — только для трёх банков (решение владельца 26.09.2026).

Проверяет:
- копия PEM у Юпитера совпадает с php-proxy/ru_trusted_ca.php (сборщик);
- список доменов тот же, что JT_RU_CA_HOSTS в php-proxy/safe_url.php;
- поддомены — да, похожие чужие домены — нет;
- контекст доверяет ТОЛЬКО двум сертификатам Минцифры и проверяет имя хоста;
- остальные сайты получают обычный системный контекст.
"""
import os
import re
import ssl
import sys
import unittest
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _pem_blocks(text: str) -> list[str]:
    return re.findall(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", text, re.S)


class RuCaScope(unittest.TestCase):
    def test_pem_matches_collector_copy(self):
        php = open(os.path.join(ROOT, "php-proxy", "ru_trusted_ca.php"), encoding="utf-8").read()
        pem = open(os.path.join(ROOT, "jupiter", "ru_trusted_ca.pem"), encoding="utf-8").read()
        self.assertEqual(_pem_blocks(php), _pem_blocks(pem))
        self.assertEqual(len(_pem_blocks(pem)), 2)

    def test_hosts_match_collector(self):
        safe = open(os.path.join(ROOT, "php-proxy", "safe_url.php"), encoding="utf-8").read()
        m = re.search(r"const JT_RU_CA_HOSTS = \[(.*?)\];", safe)
        self.assertIsNotNone(m)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", m.group(1))), engine.RU_CA_HOSTS)

    def test_scope(self):
        for host in ("tbank.ru", "www.tbank.ru", "job.alfabank.ru", "hr.tochka.com", "WWW.TBANK.RU"):
            self.assertTrue(engine.needs_ru_ca(host), host)
        for host in ("sber.ru", "evil-tbank.ru", "tbank.ru.evil.com", "alfabank.ru.example",
                     "nottochka.com", ""):
            self.assertFalse(engine.needs_ru_ca(host), host)

    def test_context_trusts_only_mincifry_and_checks_names(self):
        ctx = engine.ru_ca_context()
        names = sorted(dict(x["subject"][-1])["commonName"] for x in ctx.get_ca_certs())
        self.assertEqual(names, ["Russian Trusted Root CA", "Russian Trusted Sub CA"])
        self.assertTrue(ctx.check_hostname)
        self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)

    def test_handler_picks_context_by_host(self):
        handler = engine._PinnedHTTPSHandler({})
        seen = {}

        def fake_do_open(conn, req, context=None):
            seen[req.host] = context
            raise RuntimeError("stop")

        handler.do_open = fake_do_open
        for url in ("https://www.tbank.ru/career/", "https://rabota.sber.ru/"):
            with self.assertRaises(RuntimeError):
                handler.https_open(urllib.request.Request(url))
        self.assertIs(seen["www.tbank.ru"], engine.ru_ca_context())
        self.assertIsNot(seen["rabota.sber.ru"], engine.ru_ca_context())


if __name__ == "__main__":
    unittest.main(verbosity=1)
