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
from validation import ValidationIssue, validate_form


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
    "personal data",
    "privacy",
    "privacy policy",
    "personal data policy",
    "персональн",
    "обработк персональн",
    "политик конфиденциальност",
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
    "github": ("github", "git hub"),
    "portfolio": ("portfolio", "портфолио", "personal site", "website"),
    "telegram": ("telegram", "телеграм"),
    "current_company": ("current company", "company", "текущая компания", "работодатель"),
    "current_title": ("current title", "job title", "должность сейчас", "текущая должность"),
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
    "relocation": ("relocation", "relocate", "переезд", "готовность к переезду"),
    "visa_sponsorship": (
        "visa sponsorship", "sponsorship", "визовая поддержка", "спонсорство визы"
    ),
    "work_authorization": (
        "work authorization", "right to work", "разрешение на работу", "право на работу"
    ),
    "notice_period": ("notice period", "start date", "дата выхода", "срок выхода"),
    "english_level": ("english level", "english", "уровень английского", "английский"),
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
        aliases = {
            "first_name": ("given_name", "firstName"),
            "last_name": ("surname", "family_name", "lastName"),
            "patronymic": ("middle_name", "additional_name"),
            "birth_date": ("birthday", "date_of_birth", "dob"),
            "city": ("town", "location_city"),
            "desired_role": ("position", "job_title", "vacancy"),
            "employment": ("employment_type",),
            "cover_letter": ("motivation", "comment"),
            "resume_url": ("cv_url", "resume_link"),
            "current_company": ("employer",),
            "current_title": ("current_position",),
            "work_authorization": ("right_to_work",),
            "visa_sponsorship": ("requires_sponsorship",),
        }
        for canonical, candidates in aliases.items():
            if canonical in self.values and self.values.get(canonical) not in (None, ""):
                continue
            for candidate in candidates:
                if candidate in self.values and self.values.get(candidate) not in (None, ""):
                    self.values[canonical] = self.values[candidate]
                    break

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


class Reason:
    """Коды причин остановки.

    Свободный текст в reason остаётся для человека, но решать по нему
    нельзя: он меняется от правки к правке. Аналитика совместимости и
    выбор следующей задачи должны опираться на код.
    """

    CAPTCHA_REQUIRED = "CAPTCHA_REQUIRED"
    MISSING_PROFILE_FIELD = "MISSING_PROFILE_FIELD"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    DOMAIN_BLOCKED = "DOMAIN_BLOCKED"
    UNSUPPORTED_SCRIPT = "UNSUPPORTED_SCRIPT"
    SUCCESS_NOT_CONFIRMED = "SUCCESS_NOT_CONFIRMED"
    NAVIGATION_FAILED = "NAVIGATION_FAILED"
    SUBMIT_FAILED = "SUBMIT_FAILED"
    VACANCY_NOT_FOUND = "VACANCY_NOT_FOUND"
    MAX_STEPS = "MAX_STEPS"


@dataclass
class AgentResult:
    status: str
    reason: str | None = None
    trajectory: list[dict[str, Any]] = field(default_factory=list)
    reason_code: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reason": self.reason,
            "reason_code": self.reason_code,
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
        return override if override in profile.values else None

    name = normalize(control.name)
    cid = normalize(control.id)
    autocomplete = normalize(control.autocomplete)
    autocomplete_map = {
        "given name": "first_name",
        "family name": "last_name",
        "additional name": "patronymic",
        "name": "full_name",
        "email": "email",
        "tel": "phone",
        "address level2": "city",
        "bday": "birth_date",
    }
    if autocomplete in autocomplete_map:
        key = autocomplete_map[autocomplete]
        if key in profile.values:
            return key

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
        self.dry_run = dry_run
        self.engine = engine or JupiterWebEngine(
            self.allowed_hosts,
            read_only=dry_run,
        )
        if dry_run:
            self.engine.read_only = True
        self._root_url = ""

    @staticmethod
    def descriptor(control: ControlState) -> str:
        return " ".join(
            str(value)
            for value in (
                control.label,
                control.aria,
                control.autocomplete,
                control.inputmode,
                control.title_attr,
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
        if control.readonly:
            # readonly сервер всё равно отправит — но своим значением.
            # Затирать его нельзя: там обычно то, что он сам и подставил.
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
                    if not option.disabled
                    and normalize(option.label) not in {"", "choose", "select", "выберите"}
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
                [option for option in control.options if not option.disabled],
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

    def _required_missing(
        self,
        page: PageState,
        form_index: int | None = None,
    ) -> list[str]:
        missing: list[str] = []
        radio_groups_checked = {
            control.name
            for control in page.controls
            if control.type == "radio"
            and control.name
            and control.checked
            and (form_index is None or control.form_index == form_index)
        }
        for control in page.controls:
            if form_index is not None and control.form_index != form_index:
                continue
            if (
                not control.required
                or control.disabled
                or control.type == "hidden"
                or self.is_submit(control)
                or _looks_like_captcha(control)
            ):
                continue
            if (
                control.type == "radio"
                and control.name
                and control.name in radio_groups_checked
            ):
                continue
            if self.control_is_empty(control) and not self._resume_alternative_satisfied(
                page, control
            ):
                missing.append(
                    self.descriptor(control) or control.name or f"control:{control.index}"
                )
        return missing

    # Кнопки отправки в одной форме соревнуются: «сохранить черновик» рядом с
    # «откликнуться» — обычное дело. Раньше бралась первая по порядку, и с
    # formaction это стало уже не безобидно: черновик уходит на свой адрес.
    SUBMIT_INTENT = (
        ("отклик", 40), ("подать заявку", 40), ("оставить заявку", 40),
        ("откликнуться", 40), ("отправить", 30), ("submit", 30),
        ("apply", 30), ("send", 20), ("отправить заявку", 40),
    )
    SUBMIT_AVOID = (
        ("сохранить", -40), ("черновик", -40), ("draft", -40), ("save", -40),
        ("сбросить", -60), ("reset", -60), ("отмена", -60), ("cancel", -60),
        ("назад", -60), ("back", -60), ("поиск", -30), ("search", -30),
    )

    @classmethod
    def _submit_score(cls, control: ControlState) -> int:
        text = normalize(" ".join(filter(None, [
            control.text, control.value, control.label, control.aria,
            control.title_attr, control.name, control.id,
        ])))
        score = 0
        for token, weight in cls.SUBMIT_INTENT + cls.SUBMIT_AVOID:
            if normalize(token) in text:
                score += weight
        return score

    @classmethod
    def _submit_control(
        cls,
        page: PageState,
        target_form_index: int | None,
    ) -> ControlState | None:
        candidates = [
            control
            for control in page.controls
            if cls.is_submit(control)
            and not control.disabled
            and control.form_index is not None
            and (
                target_form_index is None
                or control.form_index == target_form_index
            )
        ]
        if not candidates:
            return None
        # Порядок в разметке — последний довод: при равных намерениях
        # поведение остаётся прежним.
        return max(
            candidates,
            key=lambda control: (cls._submit_score(control), -control.index),
        )

    def _validation_issues(
        self,
        page: PageState,
        form_index: int | None,
    ) -> list[ValidationIssue]:
        """Что забракует браузер, кроме пустых обязательных полей.

        Правило required здесь намеренно отброшено: им владеет
        _required_missing, и только он знает про альтернативы вроде
        «файл резюме вместо ссылки». Два независимых ответа на один
        вопрос рано или поздно разойдутся.
        """
        if form_index is None or form_index >= len(page.forms):
            return []
        submitter = self._submit_control(page, form_index)
        return [
            issue
            for issue in validate_form(page, page.forms[form_index], submitter)
            if issue.rule != "required"
        ]

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

    def _form_score(
        self,
        page: PageState,
        form_index: int,
        profile: CandidateProfile,
    ) -> int:
        score = 0
        keys: set[str] = set()
        form = page.forms[form_index]
        descriptors: list[str] = [form.action, form.id]
        for control in page.controls:
            if control.form_index != form_index or control.disabled:
                continue
            descriptor = self.descriptor(control)
            descriptors.append(descriptor)
            if control.type == "file":
                score += 35
                keys.add("resume")
                continue
            if self.is_submit(control):
                if any(marker in normalize(descriptor) for marker in SUBMIT_MARKERS):
                    score += 30
                continue
            key = choose_key(control, profile, page.url)
            if key and key not in keys:
                keys.add(key)
                score += 20
            if control.required:
                score += 2

        context = normalize(" ".join(descriptors))
        if any(marker in context for marker in (
            "search", "поиск", "newsletter", "subscribe", "подпис",
            "login", "sign in", "войти", "авторизац",
        )):
            score -= 60
        if any(marker in context for marker in (
            "apply", "отклик", "application", "анкета", "resume", "резюм",
        )):
            score += 25
        return score

    def _target_form_index(
        self,
        page: PageState,
        profile: CandidateProfile,
    ) -> int | None:
        if not page.forms:
            return None
        scored = [
            (self._form_score(page, form.index, profile), form.index)
            for form in page.forms
        ]
        scored.sort(reverse=True)
        if not scored or scored[0][0] < 40:
            return None
        return scored[0][1]

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
            "html_validation": "passed",
            "submit_blocked_by_policy": True,
            "filled_fields": sum(
                1 for item in trajectory if item.get("action") in {"fill", "select"}
            ),
            "uploads": sum(
                1 for item in trajectory if item.get("action") == "upload"
            ),
            "checks": sum(
                1 for item in trajectory if item.get("action") == "check"
            ),
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
            target_form_index = self._target_form_index(page, profile)
            filled_before = len(trajectory)
            if target_form_index is not None:
                trajectory.append({
                    "action": "target_form",
                    "form_index": target_form_index,
                    "score": self._form_score(page, target_form_index, profile),
                })
                for control in page.controls:
                    if control.form_index != target_form_index:
                        continue
                    if control.disabled or self.is_submit(control):
                        continue
                    if not self.control_is_empty(control):
                        continue
                    self.fill_control(page, control, profile, trajectory)
            filled_any = any(
                item.get("action") in {"fill", "select", "check", "upload"}
                for item in trajectory[filled_before:]
            )

            missing = self._required_missing(page, target_form_index)
            has_application_form = target_form_index is not None

            if has_application_form or filled_any:
                if missing:
                    reason = "Missing candidate data for required field(s): " + "; ".join(missing)
                    trajectory.append({
                        "action": "action_required",
                        "reason": reason,
                        "reason_code": Reason.MISSING_PROFILE_FIELD,
                    })
                    return AgentResult(
                        "action_required", reason, trajectory,
                        Reason.MISSING_PROFILE_FIELD,
                    )

                issues = self._validation_issues(page, target_form_index)
                if issues:
                    reason = "Form fails HTML validation: " + "; ".join(
                        f"{issue.field}: {issue.message}" for issue in issues
                    )
                    trajectory.append({
                        "action": "validation_failed",
                        "reason": reason,
                        "reason_code": Reason.VALIDATION_FAILED,
                        "issues": [issue.as_dict() for issue in issues],
                    })
                    return AgentResult(
                        "action_required", reason, trajectory,
                        Reason.VALIDATION_FAILED,
                    )

                if self.dry_run:
                    return self._dry_run_complete(page, trajectory, captcha)

                if captcha:
                    reason = "CAPTCHA detected; fields are prepared but Jupiter does not bypass human verification"
                    trajectory.append({
                        "action": "action_required",
                        "reason": reason,
                        "reason_code": Reason.CAPTCHA_REQUIRED,
                    })
                    return AgentResult(
                        "action_required", reason, trajectory,
                        Reason.CAPTCHA_REQUIRED,
                    )

            submit = self._submit_control(page, target_form_index)

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
                        trajectory.append({
                            "action": "action_required",
                            "reason": reason,
                            "reason_code": Reason.DOMAIN_BLOCKED,
                        })
                        return AgentResult(
                            "action_required", reason, trajectory, Reason.DOMAIN_BLOCKED
                        )
                    except EngineError as exc:
                        reason = f"Jupiter Web Engine failed to navigate: {exc}"
                        trajectory.append({
                            "action": "failed",
                            "reason": reason,
                            "reason_code": Reason.NAVIGATION_FAILED,
                        })
                        return AgentResult(
                            "failed", reason, trajectory, Reason.NAVIGATION_FAILED
                        )
                    visited.add(page.url)
                    continue

                if self.dry_run and (has_application_form or filled_any):
                    return self._dry_run_complete(page, trajectory, captcha)

                if page.has_script:
                    reason = (
                        "Page requires JavaScript interaction outside the supported "
                        "Jupiter runtime"
                    )
                    trajectory.append({
                        "action": "action_required",
                        "reason": reason,
                        "reason_code": Reason.UNSUPPORTED_SCRIPT,
                    })
                    return AgentResult(
                        "action_required", reason, trajectory, Reason.UNSUPPORTED_SCRIPT
                    )
                reason = "No explicit application form or apply navigation found"
                trajectory.append({
                    "action": "failed",
                    "reason": reason,
                    "reason_code": Reason.VACANCY_NOT_FOUND,
                })
                return AgentResult(
                    "failed", reason, trajectory, Reason.VACANCY_NOT_FOUND
                )

            if self.dry_run:
                return self._dry_run_complete(page, trajectory, captcha)

            if captcha:
                reason = "CAPTCHA detected; fields are prepared but Jupiter does not bypass human verification"
                trajectory.append({
                    "action": "action_required",
                    "reason": reason,
                    "reason_code": Reason.CAPTCHA_REQUIRED,
                })
                return AgentResult(
                    "action_required", reason, trajectory, Reason.CAPTCHA_REQUIRED
                )

            form = page.forms[submit.form_index]
            action = form.action.strip().lower()
            if action.startswith("javascript:"):
                reason = "Form submission depends on page JavaScript"
                trajectory.append({
                    "action": "action_required",
                    "reason": reason,
                    "reason_code": Reason.UNSUPPORTED_SCRIPT,
                })
                return AgentResult(
                    "action_required", reason, trajectory, Reason.UNSUPPORTED_SCRIPT
                )

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
                trajectory.append({
                    "action": "action_required",
                    "reason": reason,
                    "reason_code": Reason.DOMAIN_BLOCKED,
                })
                return AgentResult(
                    "action_required", reason, trajectory, Reason.DOMAIN_BLOCKED
                )
            except EngineError as exc:
                reason = f"Jupiter Web Engine failed to submit form: {exc}"
                trajectory.append({
                    "action": "failed",
                    "reason": reason,
                    "reason_code": Reason.SUBMIT_FAILED,
                })
                return AgentResult(
                    "failed", reason, trajectory, Reason.SUBMIT_FAILED
                )

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
                trajectory.append({
                    "action": "action_required",
                    "reason": reason,
                    "reason_code": Reason.SUCCESS_NOT_CONFIRMED,
                })
                return AgentResult(
                    "action_required", reason, trajectory, Reason.SUCCESS_NOT_CONFIRMED
                )

        reason = "Max Jupiter steps exceeded"
        trajectory.append({
            "action": "failed",
            "reason": reason,
            "reason_code": Reason.MAX_STEPS,
        })
        return AgentResult("failed", reason, trajectory, Reason.MAX_STEPS)

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
                [{
                    "action": "action_required",
                    "reason": reason,
                    "reason_code": Reason.DOMAIN_BLOCKED,
                }],
                Reason.DOMAIN_BLOCKED,
            )
        except EngineError as exc:
            reason = f"Jupiter Web Engine failed to open page: {exc}"
            return AgentResult(
                "failed",
                reason,
                [{
                    "action": "failed",
                    "reason": reason,
                    "reason_code": Reason.NAVIGATION_FAILED,
                }],
                Reason.NAVIGATION_FAILED,
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
