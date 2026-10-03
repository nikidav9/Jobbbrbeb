#!/usr/bin/env python3
"""Заслон от секретов (scripts/secret-scan.py): находит настоящие виды, не шумит на публичном."""
import base64
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("secret_scan", ROOT / "scripts/secret-scan.py")
ss = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ss)


def jwt(role: str) -> str:
    b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return ".".join([b64({"alg": "HS256", "typ": "JWT"}), b64({"role": role, "iss": "supabase"}), "x" * 43])


# Образцы собираются на лету: в самом файле нет ни одного похожего на секрет литерала,
# иначе заслон срабатывал бы на собственный тест.
TG = "123456789" + ":" + "A" * 35
AWS = "AKIA" + "B" * 16
GH = "ghp_" + "c" * 36
PEM = "-----BEGIN " + "RSA PRIVATE KEY-----"


class SecretScan(unittest.TestCase):
    def kinds(self, line):
        return ss.scan_line(line)

    def test_telegram_bot_token(self):
        self.assertEqual(self.kinds(f"define('TG_BOT_TOKEN', '{TG}');"), ["токен телеграм-бота"])

    def test_other_credentials(self):
        self.assertTrue(self.kinds(f"key = {AWS}"))
        self.assertTrue(self.kinds(f"token: {GH}"))
        self.assertTrue(self.kinds(PEM))

    def test_supabase_keys_by_role(self):
        self.assertEqual(self.kinds(f"const k = '{jwt('anon')}';"), [])  # публичный ключ приложения
        self.assertEqual(self.kinds(f"const k = '{jwt('service_role')}';"), ["ключ Supabase с ролью service_role"])
        self.assertEqual(self.kinds("eyJ" + "a" * 20 + ".garbage.garbage"), [])  # не разбирается — не шумим

    def test_ordinary_code_is_clean(self):
        for line in (
            "const t = 'Ошибка 12:30 в 8:45';",
            "version: 2026:10:03:12345678901234567890123456789012345678",
            "https://t.me/JobToo_bot/app?startapp=profile",
            "api_key = os.environ['TG_BOT_TOKEN']",
            "11:45:30,123456789012345",
        ):
            self.assertEqual(self.kinds(line), [], line)

    def test_allow_mark_and_skipped_paths(self):
        self.assertEqual(self.kinds(f"x = '{TG}'  # secret-scan:allow"), [])
        self.assertTrue(ss.skipped(".agents/skills/a/SKILL.md"))
        self.assertTrue(ss.skipped("package-lock.json"))
        self.assertFalse(ss.skipped("php-proxy/db.php"))

    def test_current_tree_is_clean(self):
        # Всё, что лежит в репозитории сейчас, заслон пропускает: иначе первый же
        # PR упёрся бы в чужое старое.
        lines = ss.all_lines()
        hits = [(p, n, k) for p, n, t in lines if not ss.skipped(p) for k in ss.scan_line(t)]
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
