#!/usr/bin/env python3
"""Сайт для компьютера не грузит приложение под собой (scripts/defer-landing-bundle.py)."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("defer", ROOT / "scripts/defer-landing-bundle.py")
defer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(defer)

BUNDLE = "/_expo/static/js/web/entry-03b6cc4cee0319822754532d525d2cd9.js"
PAGE = (
    '<html><head><script>window.__JT_LANDING__=true;</script></head><body><div id="root"></div>'
    f'<script src="{BUNDLE}" defer></script></body></html>'
)


class DeferLandingBundle(unittest.TestCase):
    def test_tag_becomes_conditional_loader_at_same_place(self):
        out = defer.patch(PAGE)
        self.assertNotIn("defer></script>", out)
        self.assertIn("if(!window.__JT_LANDING__)", out)
        self.assertIn(f's.src="{BUNDLE}"', out)
        self.assertIn("document.body.appendChild(s)", out)
        # загрузчик остаётся последним в body — DOM к его запуску готов
        self.assertTrue(out.endswith("</script></body></html>"))
        self.assertLess(out.index('<div id="root">'), out.index("createElement"))

    def test_page_without_or_with_two_tags_is_left_alone(self):
        self.assertIsNone(defer.patch("<html><body>без приложения</body></html>"))
        self.assertIsNone(defer.patch(PAGE + PAGE))
        self.assertIsNone(defer.patch(PAGE.replace(" defer", "")))

    def test_main_writes_file_and_reports_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp) / "a.html"
            good.write_text(PAGE, encoding="utf-8")
            self.assertEqual(defer.main(["x", str(good)]), 0)
            self.assertIn("__JT_LANDING__)", good.read_text(encoding="utf-8"))
            bad = Path(tmp) / "b.html"
            bad.write_text("<html></html>", encoding="utf-8")
            self.assertEqual(defer.main(["x", str(bad)]), 3)
            self.assertEqual(bad.read_text(encoding="utf-8"), "<html></html>")

    def test_deploy_script_calls_it_without_failing_the_deploy(self):
        deploy = (ROOT / "infra/local-web-deploy.sh").read_text(encoding="utf-8")
        start = deploy.index('python3 "$SRC/scripts/defer-landing-bundle.py"')
        call = deploy[start:deploy.index("\n\n", start)]
        self.assertIn("||", call)  # не нашёл тег — выкладка идёт дальше
        self.assertLess(start, deploy.index('RELEASE="$WEB_RELEASES/local-$HEAD"'))

    def test_github_actions_deploy_runs_it_too(self):
        # Сайт выкладывает и deploy-regru.yml (builder "github-actions"): шаг должен
        # стоять после сборки Expo и до упаковки, и не валить выкладку.
        wf = (ROOT / ".github/workflows/deploy-regru.yml").read_text(encoding="utf-8")
        call = wf.index("python3 scripts/defer-landing-bundle.py dist/index.html")
        self.assertGreater(call, wf.index("npx expo export --platform web"))
        self.assertLess(call, wf.index("tar -czf dist.tar.gz"))
        self.assertIn("||", wf[call:wf.index("\n", call)])

    def test_real_expo_page_matches_the_pattern(self):
        # Тот же вид, что собирает Expo: проверено на сборке 03.10.2026.
        self.assertEqual(len(defer.TAG.findall(PAGE)), 1)


if __name__ == "__main__":
    unittest.main()
