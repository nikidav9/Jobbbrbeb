#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from playwright.async_api import async_playwright

from agent import CandidateProfile, JupiterAgent

ROOT = Path(__file__).resolve().parent
TEST_SITE = ROOT / "test_site.html"

UNKNOWN_SITE = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Unknown Field Test</title>
<form>
  <label>Email <input type="email" name="email" required></label>
  <label>Do you require visa sponsorship? <input name="visa_sponsorship" required></label>
  <button type="submit">Submit application</button>
</form>
"""

PROFILE = {
    "first_name": "Nikita",
    "last_name": "Davydov",
    "email": "nikita.demo@reply.jobtoo.ru",
    "phone": "+79990000000",
    "city": "Москва",
    "experience_years": "4",
    "work_format": "Hybrid",
    "cover_letter": "Мне интересна роль, потому что мой опыт соответствует задачам команды.",
    "resume_path": "resume.txt",
}

async def run_case(html: str):
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "resume.txt").write_text("Jupiter test resume\nNikita Davydov\n", encoding="utf-8")
        profile_path = tmp_path / "profile.json"
        profile_path.write_text(json.dumps(PROFILE, ensure_ascii=False), encoding="utf-8")
        profile = CandidateProfile.load(str(profile_path))

        agent = JupiterAgent({"jupiter.test"})
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                executable_path="/usr/bin/chromium",
                args=["--no-sandbox"],
            )
            page = await browser.new_page()
            await page.set_content(html)
            result = await agent.run_loaded_page(page, "https://jupiter.test/application", profile)
            await browser.close()
            return result

class JupiterE2E(unittest.TestCase):
    def test_fills_and_submits_job_form(self):
        html = TEST_SITE.read_text(encoding="utf-8")
        result = asyncio.run(run_case(html))
        self.assertEqual(result.status, "submitted", json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
        actions = [x["action"] for x in result.trajectory]
        self.assertIn("upload", actions)
        self.assertIn("click_submit", actions)
        self.assertIn("success_detected", actions)

    def test_stops_on_unknown_required_question(self):
        result = asyncio.run(run_case(UNKNOWN_SITE))
        self.assertEqual(result.status, "action_required")
        self.assertIn("visa", (result.reason or "").lower())
        self.assertNotIn("click_submit", [x["action"] for x in result.trajectory])

if __name__ == "__main__":
    unittest.main(verbosity=2)
