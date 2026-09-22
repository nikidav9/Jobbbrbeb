#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from engine import (
    ControlState,
    EngineError,
    EngineSecurityError,
    JupiterWebEngine,
    PageState,
)


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

CAPTCHA_MARKERS = (
    "g-recaptcha",
    "recaptcha",
    "hcaptcha",
    "cf-turnstile",
    "captcha",
)

ALIASES = {
    "first_name": ("first name", "given name", "имя"),
    "last_name": ("last name", "surname", "family name", "фамилия"),
    "full_name": ("full name", "your name", "фио", "полное имя"),
    "email": ("email", "e-mail", "электронная почта", "почта"),
    "phone": ("phone", "mobile", "телефон", "номер телефона"),
    "city": ("city", "location", "город", "местоположение"),
    "linkedin": ("linkedin",),
    "experience_years": (
        "years of experience",
        "experience years",
        "лет опыта",
        "стаж",
        "опыт работы",
    ),
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
            resume = str((Path(path).parent / resume).resolve())

        if not data.get("full_name"):
            full_name = " ".join(
                str(data.get(k) or "").strip() for k in ("first_name", "last_name")
            ).strip()
            if full_name:
                data["full_name"] = full_name

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
    def __init__(
        self,
        allowed_hosts: set[str],
        max_steps: int = 30,
        *,
        engine: JupiterWebEngine | None = None,
    ):
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        self.max_steps = max_steps
        self.engine = engine or JupiterWebEngine(self.allowed_hosts)

    @staticmethod
    def descriptor(control: ControlState) -> str:
        return " ".join(
            str(value)
            for value in (
                control.label,
                control.aria,
                control.placeholder,
                control.name,
                control.id,
                control.text,
            )
            if value
        ).strip()

    @staticmethod
    def is_submit(control: ControlState) -> bool:
        if control.type not in {"submit", "image"}:
            return False
        descriptor = normalize(JupiterAgent.descriptor(control))
        return control.type in {"submit", "image"} or any(
            marker in descriptor for marker in SUBMIT_MARKERS
        )

    @staticmethod
    def control_is_empty(control: ControlState) -> bool:
        if control.type == "file":
            return not bool(control.file_path)
        if control.type in {"checkbox", "radio"}:
            return not control.checked
        return not str(control.value or "").strip()

    def fill_control(
        self,
        control: ControlState,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
    ) -> bool:
        if control.type in {"hidden", "submit", "image", "button", "reset"}:
            return False

        descriptor = self.descriptor(control)

        if control.type == "file":
            if profile.resume_path and Path(profile.resume_path).is_file():
                control.file_path = profile.resume_path
                trajectory.append({
                    "action": "upload",
                    "field": descriptor,
                    "source": "resume",
                    "filename": Path(profile.resume_path).name,
                })
                return True
            return False

        key = choose_key(descriptor, profile)
        if not key:
            return False

        value = profile.values.get(key)
        if value is None or value == "":
            return False

        if control.tag == "select":
            wanted = normalize(str(value))
            match = next(
                (
                    option
                    for option in control.options
                    if wanted in {normalize(option.label), normalize(option.value)}
                ),
                None,
            )
            if match is None:
                match = next(
                    (
                        option
                        for option in control.options
                        if wanted in normalize(option.label)
                        or normalize(option.label) in wanted
                    ),
                    None,
                )
            if match is None:
                return False
            control.value = match.value
            for option in control.options:
                option.selected = option is match
            trajectory.append({
                "action": "select",
                "field": descriptor,
                "key": key,
                "value": match.label,
            })
            return True

        if control.type in {"checkbox", "radio"}:
            if bool(value):
                control.checked = True
                trajectory.append({
                    "action": "check",
                    "field": descriptor,
                    "key": key,
                })
                return True
            return False

        control.value = str(value)
        trajectory.append({
            "action": "fill",
            "field": descriptor,
            "key": key,
            "value": str(value),
        })
        return True

    @staticmethod
    def detect_success(page: PageState) -> bool:
        text = normalize(page.text)
        return any(marker in text for marker in SUCCESS_MARKERS)

    @staticmethod
    def detect_captcha(page: PageState) -> bool:
        raw = page.html.lower()
        return any(marker in raw for marker in CAPTCHA_MARKERS)

    def _required_missing(self, page: PageState) -> list[str]:
        missing: list[str] = []
        for control in page.controls:
            if (
                not control.required
                or control.disabled
                or control.type == "hidden"
                or self.is_submit(control)
            ):
                continue
            if self.control_is_empty(control):
                missing.append(self.descriptor(control) or control.name or f"control:{control.index}")
        return missing

    @staticmethod
    def _same_page(before: PageState, after: PageState) -> bool:
        return (
            before.url == after.url
            and normalize(before.text)[:2000] == normalize(after.text)[:2000]
        )

    def _run_from_page(
        self,
        page: PageState,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
    ) -> AgentResult:
        submitted_once = False

        for _ in range(self.max_steps):
            if self.detect_captcha(page):
                reason = "CAPTCHA detected; Jupiter does not bypass human verification"
                trajectory.append({"action": "action_required", "reason": reason})
                return AgentResult("action_required", reason, trajectory)

            if submitted_once and self.detect_success(page):
                trajectory.append({
                    "action": "success_detected",
                    "url": page.url,
                    "status": page.status,
                })
                return AgentResult("submitted", trajectory=trajectory)

            for control in page.controls:
                if control.disabled or self.is_submit(control):
                    continue
                if not self.control_is_empty(control):
                    continue
                self.fill_control(control, profile, trajectory)

            missing = self._required_missing(page)
            if missing:
                reason = "Missing candidate data for required field(s): " + "; ".join(missing)
                trajectory.append({"action": "action_required", "reason": reason})
                return AgentResult("action_required", reason, trajectory)

            submit = next(
                (
                    control
                    for control in page.controls
                    if self.is_submit(control)
                    and not control.disabled
                    and control.form_index is not None
                ),
                None,
            )

            if submit is None:
                if page.has_script:
                    reason = (
                        "Page requires JavaScript interaction that Jupiter Web Engine v1 "
                        "does not execute yet"
                    )
                    trajectory.append({"action": "action_required", "reason": reason})
                    return AgentResult("action_required", reason, trajectory)
                reason = "No explicit HTML form submit control found"
                trajectory.append({"action": "failed", "reason": reason})
                return AgentResult("failed", reason, trajectory)

            form = page.forms[submit.form_index]
            action = form.action.strip().lower()
            if action.startswith("javascript:"):
                reason = "Form submission depends on page JavaScript"
                trajectory.append({"action": "action_required", "reason": reason})
                return AgentResult("action_required", reason, trajectory)

            trajectory.append({
                "action": "click_submit",
                "field": self.descriptor(submit),
                "method": form.method.upper(),
                "action_url": form.action or page.url,
            })

            before = page
            try:
                page = self.engine.submit(before, form, submit)
            except EngineSecurityError as exc:
                reason = f"Navigation blocked by Jupiter policy: {exc}"
                trajectory.append({"action": "action_required", "reason": reason})
                return AgentResult("action_required", reason, trajectory)
            except EngineError as exc:
                reason = f"Jupiter Web Engine failed to submit form: {exc}"
                trajectory.append({"action": "failed", "reason": reason})
                return AgentResult("failed", reason, trajectory)

            submitted_once = True
            submit_mode = getattr(self.engine, "last_submit_mode", "http")
            trajectory.append({
                "action": "script_submit" if submit_mode == "script" else "http_submit",
                "url": page.url,
                "status": page.status,
            })

            if self.detect_success(page):
                trajectory.append({
                    "action": "success_detected",
                    "url": page.url,
                    "status": page.status,
                })
                return AgentResult("submitted", trajectory=trajectory)

            if self._same_page(before, page):
                reason = "Submit returned the same page without explicit success confirmation"
                trajectory.append({"action": "action_required", "reason": reason})
                return AgentResult("action_required", reason, trajectory)

        reason = "Max Jupiter steps exceeded"
        trajectory.append({"action": "failed", "reason": reason})
        return AgentResult("failed", reason, trajectory)

    def run(self, url: str, profile: CandidateProfile) -> AgentResult:
        try:
            page = self.engine.open(url)
        except EngineSecurityError as exc:
            reason = f"Navigation blocked by Jupiter policy: {exc}"
            return AgentResult(
                "action_required",
                reason,
                [{"action": "action_required", "reason": reason}],
            )
        except EngineError as exc:
            reason = f"Jupiter Web Engine failed to open page: {exc}"
            return AgentResult(
                "failed",
                reason,
                [{"action": "failed", "reason": reason}],
            )

        trajectory = [{
            "action": "open",
            "url": page.url,
            "status": page.status,
            "engine": "jupiter-web-engine",
        }]
        return self._run_from_page(page, profile, trajectory)

    def run_loaded_html(
        self,
        html_text: str,
        logical_url: str,
        profile: CandidateProfile,
    ) -> AgentResult:
        try:
            page = self.engine.load_html(html_text, logical_url)
        except EngineSecurityError as exc:
            reason = f"Navigation blocked by Jupiter policy: {exc}"
            return AgentResult(
                "action_required",
                reason,
                [{"action": "action_required", "reason": reason}],
            )

        trajectory = [{
            "action": "open",
            "url": page.url,
            "status": page.status,
            "engine": "jupiter-web-engine",
            "source": "inline-test",
        }]
        return self._run_from_page(page, profile, trajectory)


def main() -> int:
    parser = argparse.ArgumentParser(description="Jupiter native HTTP/HTML application agent")
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument(
        "--allow-host",
        action="append",
        default=["127.0.0.1", "localhost"],
    )
    parser.add_argument("--max-steps", type=int, default=30)
    args = parser.parse_args()

    profile = CandidateProfile.load(args.profile)
    agent = JupiterAgent(set(args.allow_host), args.max_steps)
    result = agent.run(args.url, profile)
    print(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
    return 0 if result.status in {"submitted", "action_required"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
