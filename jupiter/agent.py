#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from playwright.async_api import async_playwright, Page

SUCCESS_MARKERS = (
    "application received",
    "application submitted",
    "thank you for applying",
    "спасибо за отклик",
    "отклик отправлен",
    "заявка отправлена",
)

SUBMIT_MARKERS = (
    "submit application",
    "submit",
    "apply",
    "send application",
    "отправить отклик",
    "откликнуться",
    "отправить",
)

ALIASES = {
    "first_name": ("first name", "given name", "имя"),
    "last_name": ("last name", "surname", "family name", "фамилия"),
    "full_name": ("full name", "your name", "фио", "полное имя"),
    "email": ("email", "e-mail", "электронная почта", "почта"),
    "phone": ("phone", "mobile", "телефон", "номер телефона"),
    "city": ("city", "location", "город", "местоположение"),
    "linkedin": ("linkedin",),
    "experience_years": ("years of experience", "experience years", "лет опыта", "стаж", "опыт работы"),
    "desired_salary": ("salary", "compensation", "зарплата", "доход"),
    "work_format": ("work format", "working format", "формат работы", "режим работы"),
    "cover_letter": (
        "cover letter",
        "why are you interested",
        "why do you want",
        "about yourself",
        "tell us about yourself",
        "сопроводительное",
        "почему вам интересна",
        "о себе",
    ),
}

@dataclass
class CandidateProfile:
    values: dict[str, Any]
    resume_path: str | None = None

    @classmethod
    def load(cls, path: str) -> "CandidateProfile":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        resume = data.pop("resume_path", None)
        if resume:
            p = Path(path).parent / resume
            resume = str(p.resolve())
        return cls(values=data, resume_path=resume)

@dataclass
class AgentResult:
    status: str
    reason: str | None = None
    trajectory: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reason": self.reason,
            "trajectory": self.trajectory,
        }

def normalize(value: str | None) -> str:
    if not value:
        return ""
    value = value.lower().replace("_", " ").replace("-", " ")
    return re.sub(r"\s+", " ", value).strip()

def score_alias(text: str, alias: str) -> int:
    text = normalize(text)
    alias = normalize(alias)
    if text == alias:
        return 100
    if alias in text:
        return 70 + min(len(alias), 20)
    words = set(alias.split())
    overlap = len(words & set(text.split()))
    return overlap * 10

def choose_key(descriptor: str, profile: CandidateProfile) -> str | None:
    best: tuple[int, str] = (0, "")
    for key, aliases in ALIASES.items():
        if key not in profile.values:
            continue
        for alias in aliases:
            score = score_alias(descriptor, alias)
            if score > best[0]:
                best = (score, key)
    return best[1] if best[0] >= 30 else None

class JupiterAgent:
    def __init__(self, allowed_hosts: set[str], max_steps: int = 80):
        self.allowed_hosts = allowed_hosts
        self.max_steps = max_steps

    def assert_allowed(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme == "file":
            if "__file__" not in self.allowed_hosts:
                raise ValueError("file:// navigation is not allowed for this Jupiter run")
            return
        host = (parsed.hostname or "").lower()
        if host not in self.allowed_hosts:
            raise ValueError(f"Host '{host}' is not allowed for this Jupiter run")

    async def observe(self, page: Page) -> list[dict[str, Any]]:
        controls = page.locator("input, textarea, select, button")
        return await controls.evaluate_all(
            """els => els.map((el, index) => ({
                index,
                tag: el.tagName.toLowerCase(),
                type: (el.getAttribute('type') || '').toLowerCase(),
                name: el.getAttribute('name') || '',
                id: el.id || '',
                placeholder: el.getAttribute('placeholder') || '',
                aria: el.getAttribute('aria-label') || '',
                text: (el.innerText || el.value || '').trim(),
                label: el.labels ? Array.from(el.labels).map(x => x.innerText || x.textContent || '').join(' ') : '',
                required: !!el.required,
                disabled: !!el.disabled,
                value: el.value || '',
                checked: !!el.checked,
                accept: el.getAttribute('accept') || '',
                options: el.tagName === 'SELECT'
                    ? Array.from(el.options).map(o => ({label: (o.textContent || '').trim(), value: o.value}))
                    : []
            }))"""
        )

    def descriptor(self, c: dict[str, Any]) -> str:
        return " ".join(
            str(c.get(k, ""))
            for k in ("label", "aria", "placeholder", "name", "id", "text")
        ).strip()

    def is_submit(self, c: dict[str, Any]) -> bool:
        if c["tag"] != "button" and c.get("type") != "submit":
            return False
        d = normalize(self.descriptor(c))
        return c.get("type") == "submit" or any(m in d for m in SUBMIT_MARKERS)

    async def control_is_empty(self, page: Page, index: int) -> bool:
        locator = page.locator("input, textarea, select, button").nth(index)
        return await locator.evaluate(
            """el => {
                if (el.tagName === 'SELECT') return !el.value;
                if ((el.type || '').toLowerCase() === 'checkbox' || (el.type || '').toLowerCase() === 'radio') return !el.checked;
                if ((el.type || '').toLowerCase() === 'file') return !(el.files && el.files.length);
                return !String(el.value || '').trim();
            }"""
        )

    async def fill_control(
        self,
        page: Page,
        c: dict[str, Any],
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
    ) -> bool:
        locator = page.locator("input, textarea, select, button").nth(c["index"])
        descriptor = self.descriptor(c)
        ctype = c.get("type", "")

        if ctype == "file":
            if profile.resume_path and Path(profile.resume_path).exists():
                await locator.set_input_files(profile.resume_path)
                trajectory.append({"action": "upload", "field": descriptor, "source": "resume"})
                return True
            return False

        key = choose_key(descriptor, profile)
        if not key:
            return False
        value = profile.values.get(key)
        if value is None or value == "":
            return False

        if c["tag"] == "select":
            options = c.get("options") or []
            wanted = normalize(str(value))
            match = next(
                (o for o in options if wanted == normalize(o["label"]) or wanted == normalize(o["value"])),
                None,
            )
            if not match:
                match = next(
                    (o for o in options if wanted in normalize(o["label"]) or normalize(o["label"]) in wanted),
                    None,
                )
            if not match:
                return False
            await locator.select_option(value=match["value"])
            trajectory.append({"action": "select", "field": descriptor, "key": key, "value": match["label"]})
            return True

        if ctype in ("checkbox", "radio"):
            if bool(value):
                await locator.check()
                trajectory.append({"action": "check", "field": descriptor, "key": key})
                return True
            return False

        await locator.fill(str(value))
        trajectory.append({"action": "fill", "field": descriptor, "key": key, "value": str(value)})
        return True

    async def detect_success(self, page: Page) -> bool:
        body = normalize(await page.locator("body").inner_text())
        return any(marker in body for marker in SUCCESS_MARKERS)

    async def run_loaded_page(self, page: Page, logical_url: str, profile: CandidateProfile) -> AgentResult:
        self.assert_allowed(logical_url)
        trajectory: list[dict[str, Any]] = [{"action": "open", "url": logical_url}]

        for _ in range(self.max_steps):
            if await self.detect_success(page):
                trajectory.append({"action": "success_detected", "url": page.url})
                return AgentResult(status="submitted", trajectory=trajectory)

            controls = await self.observe(page)
            acted = False

            for c in controls:
                if c["disabled"] or self.is_submit(c):
                    continue
                if not await self.control_is_empty(page, c["index"]):
                    continue
                if await self.fill_control(page, c, profile, trajectory):
                    acted = True
                    break

            if acted:
                continue

            unknown_required: list[str] = []
            for c in controls:
                if not c["required"] or c["disabled"] or self.is_submit(c):
                    continue
                if await self.control_is_empty(page, c["index"]):
                    unknown_required.append(self.descriptor(c))

            if unknown_required:
                reason = "Missing candidate data for required field(s): " + "; ".join(unknown_required)
                trajectory.append({"action": "action_required", "reason": reason})
                return AgentResult(status="action_required", reason=reason, trajectory=trajectory)

            submit = next((c for c in controls if self.is_submit(c) and not c["disabled"]), None)
            if not submit:
                return AgentResult(
                    status="failed",
                    reason="No submit control found",
                    trajectory=trajectory,
                )

            locator = page.locator("input, textarea, select, button").nth(submit["index"])
            trajectory.append({"action": "click_submit", "field": self.descriptor(submit)})
            await locator.click()
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=3000)
            except Exception:
                pass
            await page.wait_for_timeout(150)

        return AgentResult(status="failed", reason="Max steps exceeded", trajectory=trajectory)

    async def run(self, page: Page, url: str, profile: CandidateProfile) -> AgentResult:
        self.assert_allowed(url)
        await page.goto(url, wait_until="domcontentloaded")
        return await self.run_loaded_page(page, url, profile)

async def _amain(args: argparse.Namespace) -> int:
    profile = CandidateProfile.load(args.profile)
    agent = JupiterAgent(set(args.allow_host), args.max_steps)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=not args.headed,
            executable_path=args.chromium,
            args=["--no-sandbox"] if args.no_sandbox else [],
        )
        page = await browser.new_page()
        result = await agent.run(page, args.url, profile)
        print(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
        await browser.close()
        return 0 if result.status in {"submitted", "action_required"} else 1

def main() -> int:
    parser = argparse.ArgumentParser(description="Jupiter deterministic browser agent")
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--allow-host", action="append", default=["127.0.0.1", "localhost"])
    parser.add_argument("--max-steps", type=int, default=80)
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--no-sandbox", action="store_true")
    args = parser.parse_args()
    return asyncio.run(_amain(args))

if __name__ == "__main__":
    raise SystemExit(main())
