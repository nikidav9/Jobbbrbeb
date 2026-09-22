#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import urllib.parse
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
from site_compat import field_override, trusted_hosts_for


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
    "оставить заявку",
    "подать заявку",
)

CAPTCHA_MARKERS = (
    "g-recaptcha",
    "recaptcha",
    "hcaptcha",
    "cf-turnstile",
    "smartcaptcha",
    "captcha",
)

CONSENT_MARKERS = (
    "consent",
    "agree",
    "agreed",
    "personal data",
    "privacy",
    "policy",
    "соглас",
    "персональн",
    "обработк",
)

ALIASES = {
    "first_name": ("first name", "given name", "firstname", "имя"),
    "last_name": ("last name", "surname", "family name", "lastname", "фамилия"),
    "patronymic": ("patronymic", "middle name", "отчество"),
    "full_name": ("full name", "your name", "фио", "полное имя"),
    "birth_date": (
        "birth date", "birthday", "date of birth", "born", "дата рождения", "рождение"
    ),
    "email": ("email", "e-mail", "электронная почта", "почта"),
    "phone": ("phone", "mobile", "телефон", "номер телефона"),
    "city": ("city", "town", "город", "населенный пункт", "населённый пункт"),
    "location_detail": ("metro", "location detail", "метро", "район"),
    "linkedin": ("linkedin",),
    "experience_years": (
        "years of experience", "experience years", "лет опыта", "стаж", "опыт работы"
    ),
    "desired_salary": ("salary", "compensation", "зарплата", "доход"),
    "work_format": ("work format", "working format", "формат работы", "режим работы"),
    "desired_role": (
        "vacancy", "position", "role", "job", "должность", "вакансия", "позиция"
    ),
    "employment": (
        "employment", "employment type", "занятость", "тип занятости", "график"
    ),
    "citizenship": ("citizenship", "гражданство"),
    "education": ("education", "образование"),
    "resume_url": ("resume url", "cv url", "resume link", "brief link", "ссылка на резюме"),
    "has_car": ("has car", "own car", "автомобиль", "есть машина", "личный автомобиль"),
    "cover_letter": (
        "cover letter",
        "comment",
        "motivation",
        "why are you interested",
        "why do you want",
        "about yourself",
        "tell us about yourself",
        "сопроводительное",
        "комментарий",
        "почему вам интересна",
        "о себе",
    ),
    "consent": CONSENT_MARKERS,
}


@dataclass
class CandidateProfile:
    values: dict[str, Any]
    resume_path: str | None = None

    def __post_init__(self) -> None:
        if not self.values.get("full_name"):
            full_name = " ".join(
                str(self.values.get(key) or "").strip()
                for key in ("last_name", "first_name", "patronymic")
            ).strip()
            if full_name:
                self.values["full_name"] = full_name
        if not self.values.get("birth_date") and self.values.get("birthday"):
            self.values["birth_date"] = self.values["birthday"]
        if "consent" not in self.values:
            for key in ("personal_data_consent", "privacy_consent", "terms_consent"):
                if key in self.values:
                    self.values["consent"] = self.values[key]
                    break

    @classmethod
    def load(cls, path: str) -> "CandidateProfile":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        resume = data.pop("resume_path", None)
        if resume:
            resume = str((Path(path).parent / resume).resolve())
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
    value = re.sub(r"[^0-9a-zа-яё+./\[\] ]+", " ", value, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", value).strip()


def score_alias(text: str, alias: str) -> int:
    text = normalize(text)
    alias = normalize(alias)
    if not text or not alias:
        return 0
    if text == alias:
        return 100
    if alias in text:
        return 70 + min(len(alias), 20)
    words = set(alias.split())
    overlap = len(words & set(text.split()))
    return overlap * 10


def _date_for_html(value: Any) -> str:
    text = str(value or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    match = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})", text)
    if match:
        day, month, year = match.groups()
        return f"{year}-{int(month):02d}-{int(day):02d}"
    return text


def _looks_like_captcha(control: ControlState) -> bool:
    descriptor = normalize(JupiterAgent.descriptor(control))
    return any(marker in descriptor for marker in CAPTCHA_MARKERS)


def choose_key(
    control: ControlState,
    profile: CandidateProfile,
    page_url: str,
) -> str | None:
    override = field_override(page_url, control.name, control.id)
    if override:
        if override == "resume":
            return override
        if override in profile.values:
            return override

    name = normalize(control.name)
    cid = normalize(control.id)
    exact = {
        "firstname": "first_name",
        "first name": "first_name",
        "first_name": "first_name",
        "lastname": "last_name",
        "last name": "last_name",
        "last_name": "last_name",
        "patronymic": "patronymic",
        "middlename": "patronymic",
        "email": "email",
        "phone": "phone",
        "mobile": "phone",
        "city": "city",
        "town": "city",
        "birthday": "birth_date",
        "birth date": "birth_date",
        "date of birth": "birth_date",
        "citizenship": "citizenship",
        "education": "education",
        "vacancy": "desired_role",
        "position": "desired_role",
        "employment": "employment",
        "comment": "cover_letter",
        "motivation": "cover_letter",
        "resumeurl": "resume_url",
        "resume url": "resume_url",
        "cv url": "resume_url",
    }
    for raw in (control.name, control.id):
        compact = (raw or "").strip().lower()
        if compact in exact and exact[compact] in profile.values:
            return exact[compact]
        normalized = normalize(raw)
        if normalized in exact and exact[normalized] in profile.values:
            return exact[normalized]

    if control.type == "email" and "email" in profile.values:
        return "email"
    if control.type == "tel" and "phone" in profile.values:
        return "phone"
    if control.type == "date" and "birth_date" in profile.values:
        return "birth_date"
    if control.type == "url" and "resume_url" in profile.values:
        return "resume_url"

    descriptor = JupiterAgent.descriptor(control)
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
        dry_run: bool = False,
    ):
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        self.max_steps = max_steps
        self.engine = engine or JupiterWebEngine(self.allowed_hosts)
        self.dry_run = dry_run
        self._root_url = ""

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

    @staticmethod
    def _option_score(wanted: str, label: str, value: str) -> int:
        wanted_n = normalize(wanted)
        label_n = normalize(label)
        value_n = normalize(value)
        if wanted_n in {label_n, value_n}:
            return 100
        if wanted_n and (wanted_n in label_n or label_n in wanted_n):
            return 70
        if wanted_n and (wanted_n in value_n or value_n in wanted_n):
            return 60
        return 0

    def fill_control(
        self,
        page: PageState,
        control: ControlState,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
    ) -> bool:
        if control.type in {"hidden", "submit", "image", "button", "reset"}:
            return False
        if _looks_like_captcha(control):
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

        key = choose_key(control, profile, page.url)
        if not key:
            if control.tag == "select" and control.required:
                real_options = [
                    option for option in control.options
                    if normalize(option.label) not in {"", "choose", "select", "выберите"}
                    and str(option.value).strip() not in {"", "0", "-1"}
                ]
                if len(real_options) == 1:
                    match = real_options[0]
                    control.value = match.value
                    for option in control.options:
                        option.selected = option is match
                    trajectory.append({
                        "action": "select",
                        "field": descriptor,
                        "key": "single_safe_option",
                        "value": match.label,
                    })
                    return True
            return False

        if key == "resume":
            return False

        value = profile.values.get(key)
        if value is None or value == "":
            return False

        if control.tag == "select":
            wanted = str(value)
            ranked = sorted(
                control.options,
                key=lambda option: self._option_score(wanted, option.label, option.value),
                reverse=True,
            )
            match = ranked[0] if ranked and self._option_score(
                wanted, ranked[0].label, ranked[0].value
            ) > 0 else None
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

        if control.type == "checkbox":
            if bool(value):
                control.checked = True
                trajectory.append({
                    "action": "check",
                    "field": descriptor,
                    "key": key,
                })
                return True
            return False

        if control.type == "radio":
            wanted = value
            descriptor_and_value = f"{descriptor} {control.value}"
            if isinstance(wanted, bool):
                yes = any(token in normalize(descriptor_and_value) for token in ("yes", "да", "true", "1"))
                no = any(token in normalize(descriptor_and_value) for token in ("no", "нет", "false", "0"))
                should_check = yes if wanted else no
            else:
                should_check = score_alias(descriptor_and_value, str(wanted)) >= 30
            if should_check:
                for peer in page.controls:
                    if (
                        peer is not control
                        and peer.type == "radio"
                        and peer.name
                        and peer.name == control.name
                    ):
                        peer.checked = False
                control.checked = True
                trajectory.append({
                    "action": "check",
                    "field": descriptor,
                    "key": key,
                    "value": control.value,
                })
                return True
            return False

        text = _date_for_html(value) if control.type == "date" or key == "birth_date" else str(value)
        control.value = text
        trajectory.append({
            "action": "fill",
            "field": descriptor,
            "key": key,
            "value": text,
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

    def _resume_alternative_satisfied(self, page: PageState, control: ControlState) -> bool:
        descriptor = normalize(self.descriptor(control))
        if not any(marker in descriptor for marker in ("resume", "cv", "brief", "резюм")):
            return False
        if control.form_index is None:
            return False
        return any(
            peer.form_index == control.form_index
            and peer.type == "file"
            and bool(peer.file_path)
            for peer in page.controls
        )

    def _required_missing(self, page: PageState) -> list[str]:
        missing: list[str] = []
        for control in page.controls:
            if (
                not control.required
                or control.disabled
                or control.type == "hidden"
                or self.is_submit(control)
                or _looks_like_captcha(control)
            ):
                continue
            if self.control_is_empty(control) and not self._resume_alternative_satisfied(
                page, control
            ):
                missing.append(
                    self.descriptor(control) or control.name or f"control:{control.index}"
                )
        return missing

    @staticmethod
    def _same_page(before: PageState, after: PageState) -> bool:
        return (
            before.url == after.url
            and normalize(before.text)[:2000] == normalize(after.text)[:2000]
        )

    @staticmethod
    def _extract_links(page: PageState) -> list[tuple[str, str]]:
        links: list[tuple[str, str]] = []
        for match in re.finditer(
            r"""<a\b([^>]*)>([\s\S]*?)</a\s*>""",
            page.html,
            flags=re.IGNORECASE,
        ):
            attrs, inner = match.groups()
            href_match = re.search(r"""\bhref\s*=\s*["']([^"']+)["']""", attrs, re.I)
            if not href_match:
                continue
            href = href_match.group(1).strip()
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            text = re.sub(r"<[^>]+>", " ", inner)
            text = " ".join(text.split())
            links.append((urllib.parse.urljoin(page.url, href), text))
        return links

    def _navigation_score(self, url: str, text: str) -> int:
        descriptor = normalize(f"{text} {url}")
        score = 0
        if any(marker in descriptor for marker in (
            "отклик", "apply", "анкета", "questionary", "resume",
            "резюме", "оставить заявку", "подать заявку", "хочу в команду",
        )):
            score += 120
        if re.search(r"/(apply|questionary|response|resume)(?:/|$|\?)", url, re.I):
            score += 100
        if re.search(r"/vacanc(?:y|ies)/[^/?#]+", url, re.I):
            score += 70
        if re.search(r"/vacancy/[^/?#]+", url, re.I):
            score += 70
        if "vacanc" in descriptor or "ваканс" in descriptor:
            score += 30
        return score

    def _best_navigation(self, page: PageState, visited: set[str]) -> str | None:
        ranked: list[tuple[int, str]] = []
        for url, text in self._extract_links(page):
            if url in visited:
                continue
            parsed = urllib.parse.urlparse(url)
            if (parsed.hostname or "").lower() not in self.engine.allowed_hosts:
                continue
            score = self._navigation_score(url, text)
            if score > 0:
                ranked.append((score, url))
        if not ranked:
            return None
        ranked.sort(reverse=True)
        return ranked[0][1]

    def _application_form_present(self, page: PageState) -> bool:
        keys: set[str] = set()
        for control in page.controls:
            if control.disabled or control.type in {"hidden", "submit", "image", "button"}:
                continue
            if control.type == "file":
                keys.add("resume")
                continue
            key = choose_key(control, CandidateProfile(values={
                "first_name": "x",
                "last_name": "x",
                "full_name": "x",
                "email": "x",
                "phone": "x",
                "city": "x",
                "birth_date": "2000-01-01",
                "citizenship": "x",
                "education": "x",
                "desired_role": "x",
                "employment": "x",
                "cover_letter": "x",
                "resume_url": "x",
                "consent": True,
                "has_car": True,
            }), page.url)
            if key:
                keys.add(key)
        return len(keys) >= 2 or "resume" in keys

    def _expand_policy_for_start(self, url: str) -> None:
        parsed = urllib.parse.urlparse(url)
        if parsed.hostname:
            self.allowed_hosts.add(parsed.hostname.lower())
        self.allowed_hosts.update(trusted_hosts_for(url))
        self.engine.allowed_hosts.update(self.allowed_hosts)

    def _dry_run_complete(
        self,
        page: PageState,
        trajectory: list[dict[str, Any]],
        captcha: bool,
    ) -> AgentResult:
        reason = "Dry-run complete: fields filled; submit was not attempted"
        if captcha:
            reason += "; CAPTCHA/human verification remains for the user"
        trajectory.append({
            "action": "ready_to_submit",
            "url": page.url,
            "captcha": captcha,
            "submit_blocked_by_policy": True,
        })
        return AgentResult("ready_to_submit", reason, trajectory)

    def _run_from_page(
        self,
        page: PageState,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
    ) -> AgentResult:
        submitted_once = False
        visited = {page.url}

        for _ in range(self.max_steps):
            if submitted_once and self.detect_success(page):
                trajectory.append({
                    "action": "success_detected",
                    "url": page.url,
                    "status": page.status,
                })
                return AgentResult("submitted", trajectory=trajectory)

            captcha = self.detect_captcha(page)
            filled_before = len(trajectory)
            for control in page.controls:
                if control.disabled or self.is_submit(control):
                    continue
                if not self.control_is_empty(control):
                    continue
                self.fill_control(page, control, profile, trajectory)
            filled_any = len(trajectory) > filled_before

            missing = self._required_missing(page)
            has_application_form = self._application_form_present(page)

            if has_application_form or filled_any:
                if missing:
                    reason = "Missing candidate data for required field(s): " + "; ".join(missing)
                    trajectory.append({"action": "action_required", "reason": reason})
                    return AgentResult("action_required", reason, trajectory)

                if self.dry_run:
                    return self._dry_run_complete(page, trajectory, captcha)

                if captcha:
                    reason = "CAPTCHA detected; fields are prepared but Jupiter does not bypass human verification"
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
                next_url = self._best_navigation(page, visited)
                if next_url is not None:
                    trajectory.append({
                        "action": "navigate",
                        "from": page.url,
                        "url": next_url,
                    })
                    try:
                        page = self.engine.open(next_url)
                    except EngineSecurityError as exc:
                        reason = f"Navigation blocked by Jupiter policy: {exc}"
                        trajectory.append({"action": "action_required", "reason": reason})
                        return AgentResult("action_required", reason, trajectory)
                    except EngineError as exc:
                        reason = f"Jupiter Web Engine failed to navigate: {exc}"
                        trajectory.append({"action": "failed", "reason": reason})
                        return AgentResult("failed", reason, trajectory)
                    visited.add(page.url)
                    continue

                if self.dry_run and (has_application_form or filled_any):
                    return self._dry_run_complete(page, trajectory, captcha)

                if page.has_script:
                    reason = (
                        "Page requires JavaScript interaction outside the supported "
                        "Jupiter runtime"
                    )
                    trajectory.append({"action": "action_required", "reason": reason})
                    return AgentResult("action_required", reason, trajectory)
                reason = "No explicit application form or apply navigation found"
                trajectory.append({"action": "failed", "reason": reason})
                return AgentResult("failed", reason, trajectory)

            if self.dry_run:
                return self._dry_run_complete(page, trajectory, captcha)

            if captcha:
                reason = "CAPTCHA detected; fields are prepared but Jupiter does not bypass human verification"
                trajectory.append({"action": "action_required", "reason": reason})
                return AgentResult("action_required", reason, trajectory)

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
            action_name = {
                "script": "script_submit",
                "script_network": "script_network_submit",
            }.get(submit_mode, "http_submit")
            trajectory.append({
                "action": action_name,
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
        self._root_url = url
        self._expand_policy_for_start(url)
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
            "dry_run": self.dry_run,
        }]
        return self._run_from_page(page, profile, trajectory)

    def run_loaded_html(
        self,
        html_text: str,
        logical_url: str,
        profile: CandidateProfile,
    ) -> AgentResult:
        self._root_url = logical_url
        self._expand_policy_for_start(logical_url)
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
            "dry_run": self.dry_run,
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
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fill and prepare the application, but never submit it",
    )
    args = parser.parse_args()

    profile = CandidateProfile.load(args.profile)
    agent = JupiterAgent(set(args.allow_host), args.max_steps, dry_run=args.dry_run)
    result = agent.run(args.url, profile)
    print(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
    return 0 if result.status in {
        "submitted", "ready_to_submit", "action_required"
    } else 1


if __name__ == "__main__":
    raise SystemExit(main())
