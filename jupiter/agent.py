#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import urllib.parse

import alice_agent
import email_apply
import huntflow
import sber
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable

from engine import (
    ControlState,
    EngineError,
    EngineFillError,
    EngineSecurityError,
    EngineTransportError,
    JupiterWebEngine,
    PageState,
)
from site_compat import field_override, trusted_hosts_for
from questions import answer_for, extract_questions, is_special, question_text
from candidate import (
    FieldClass, classify_key, consent_kinds, decide_consent, looks_like_consent, provenance_for,
)
from handoff import (
    HandoffStore, HumanAction, HumanActionRequest, ResumeState, new_token,
)
from js_engine import JsEngine, JsEngineError, JsEngineResult
from spa_payload import extract_payloads, url_candidates
from submission import (
    ApplicationFingerprint, Receipt, ReceiptStore, SubmissionEvidence,
    collect_evidence, is_confirmed, score_evidence,
)
from validation import ValidationIssue, validate_form
import yandex_gpt


SUCCESS_MARKERS = (
    "application received",
    "application submitted",
    "thank you for applying",
    "спасибо за отклик",
    "отклик отправлен",
    "заявка отправлена",
    # Частые на SPA-сайтах подтверждения (браузерный движок, 28.09.2026).
    # Только однозначные: «ваш отклик» без глагола — это и заголовок анкеты.
    "отклик получен",
    "отклик принят",
    "заявка принята",
    "заявка получена",
    "резюме отправлено",
    "мы получили ваш отклик",
    "мы получили вашу заявку",
    # job.2gis.ru (01.10.2026): окно «Отправлено — Твой отклик уже у нас».
    # Одно «отправлено» — нет: так подписаны и кнопки, и шаги анкет.
    "отклик уже у нас",
    # twinby.ru (01.10.2026): «Спасибо! Мы все изучим и ответим тебе по почте».
    "мы все изучим и ответим",
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

# Метки для is_application_form: отличить анкету кандидата от соседних форм
# на той же странице (фильтр вакансий, подписка, форма для клиентов, форма
# «порекомендуй знакомого»).
_CONTACT_FIELD_MARKERS = ("phone", "tel", "mail", "телефон", "почт", "e-mail")
_APPLY_FORM_MARKERS = ("отклик", "откликн", "резюме", "анкет", "ваканс", "заявк", "apply", "application", "resume", " cv")
_SUBSCRIPTION_MARKERS = ("подпис", "рассылк", "новост", "subscri", "newsletter", "акци", "скидк")
# Подписка на вакансии: почта плюс выбор города и направления (job.mts.ru,
# разведка браузером 29.09.2026). Слова уже, чем у рассылки: рядом стоят
# select'ы настоящей анкеты, и «акци» из «редакции» здесь не годится.
_VACANCY_SUBSCRIPTION_MARKERS = (
    "подпис", "рассылк", "новые вакансии", "присылать вакансии", "subscri",
)
_COMPANY_FIELD_MARKERS = ("company", "organization", "organisation", "компани", "организац")
# Поле, которое бывает только у кандидата. Имя не годится: форма «свяжитесь
# с нами» для клиентов тоже спрашивает имя и компанию.
_CANDIDATE_FIELD_MARKERS = (
    "resume", "резюм", "cv", "vacanc", "ваканс", "position", "должност",
    "о себе", "portfolio", "портфолио", "cover", "сопроводит",
)
# Заказ у магазина или ресторана (Хлеб Насущный: «количество персон»,
# «вариант доставки») — не анкета ни при каких полях.
_ORDER_FORM_MARKERS = (
    "вариант доставки", "способ доставки", "адрес доставки", "время доставки",
    "количество персон", "оформить заказ", "ваш заказ",
)
# Вопрос или обращение («задайте вопрос», «тема заявки») — не анкета, если в
# форме нет ничего от кандидата: ни резюме, ни вакансии.
# Бриф и заявка клиента (Extyl, Oxygen — разведка 30.09): бюджет, тип
# проекта, тендер. Анкетой такая форма не бывает, даже с полем для файла.
_CLIENT_FORM_MARKERS = ("бюджет", "тип проекта", "тендер", "коммерческое предложение")
_QUESTION_FORM_MARKERS = (
    "задайте вопрос", "ваш вопрос", "какой вопрос", "тема заявки", "тема обращения",
    "тема сообщения",
)
_REFERRER_LABEL_MARKERS = ("рекомендател", "порекомендуй", "рекомендую друга", "friend")
_STRUCTURAL_CONTROL_TYPES = {"checkbox", "radio", "hidden", "submit", "button", "file"}

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


# Сколько раз дозаполнить или переписать поля, которые сайт подсветил после
# «Отправить» (3 — п.1 «довести цикл», 01.10.2026: пустое поле, другая запись,
# запись по подсказке Алисы).
SITE_FIX_ROUNDS = 3
# Записи, которые подсказка Алисы (browser_planner.FIX_FORMATS) выбирает для телефона.
_PHONE_FORMATS = ("phone_plus7", "phone_7", "phone_8", "phone_10", "phone_mask")


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
    # После «Отправить» сайт не принял анкету (01.10.2026): подсветил поля
    # или сообщил об ошибке — отклик точно не ушёл, это не «скорее всего, ушёл».
    SITE_NEEDS_FIX = "SITE_NEEDS_FIX"
    SITE_REJECTED = "SITE_REJECTED"
    NAVIGATION_FAILED = "NAVIGATION_FAILED"
    SUBMIT_FAILED = "SUBMIT_FAILED"
    # Сбой заполнения ДО клика «Отправить» (EngineFillError): поле не
    # заполнилось, нечем отправить. На сайт ничего не ушло — это не
    # «исход неизвестен», а обычный сбой, который можно повторить.
    FILL_FAILED = "FILL_FAILED"
    VACANCY_NOT_FOUND = "VACANCY_NOT_FOUND"
    MAX_STEPS = "MAX_STEPS"
    # Анкете нужны ответы человека — вопросы ушли в приложение (questions.py).
    NEEDS_ANSWERS = "NEEDS_ANSWERS"
    MULTI_STEP_DRY_RUN_LIMIT = "MULTI_STEP_DRY_RUN_LIMIT"
    STEP_DID_NOT_ADVANCE = "STEP_DID_NOT_ADVANCE"
    DUPLICATE_BLOCKED = "DUPLICATE_BLOCKED"
    SUBMISSION_UNKNOWN = "SUBMISSION_UNKNOWN"
    CONSENT_REQUIRED = "CONSENT_REQUIRED"
    UNKNOWN_REQUIRED_QUESTION = "UNKNOWN_REQUIRED_QUESTION"
    # Анкеты нет, а на странице — HR-почта компании: письмо шлёт сервер
    # (п.4, решение владельца 01.10.2026; jupiter/email_apply.py).
    EMAIL_APPLY = "EMAIL_APPLY"


@dataclass
class FormFlow:
    """Где мы в многошаговой анкете.

    Нужна по одной причине: «Далее» — не «Отправить». Без этого различия
    Jupiter засчитывал переход между шагами за поданный отклик, а в dry-run
    докладывал о готовности, заполнив только первый экран из трёх.
    """

    step_index: int = 0
    signatures: list[str] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)

    def enter(self, signature: str, summary: dict[str, Any]) -> bool:
        """Отметить шаг. False — такой шаг уже был, значит мы топчемся."""
        repeated = signature in self.signatures
        self.signatures.append(signature)
        self.steps.append(summary)
        self.step_index = len(self.signatures) - 1
        return not repeated


@dataclass
class AgentResult:
    status: str
    reason: str | None = None
    trajectory: list[dict[str, Any]] = field(default_factory=list)
    reason_code: str | None = None
    human_action: dict[str, Any] | None = None
    # Вопросы работодателя человеку (NEEDS_ANSWERS): questions.Question.as_dict.
    questions: list[dict[str, Any]] = field(default_factory=list)
    # Адрес для отклика письмом (EMAIL_APPLY).
    email_to: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reason": self.reason,
            "reason_code": self.reason_code,
            "human_action": self.human_action,
            "questions": self.questions,
            "email_to": self.email_to,
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


# Одно и то же значение, записанное по-разному. Только то, что встречалось на
# живых анкетах: Норникель пишет «Российская Федерация», профиль — «Россия».
_EQUIVALENT_VALUES = (
    # Короткое «рф» нарочно нет: сравнение по подстроке нашло бы его в
    # «перфоратор».
    ("россия", "российская федерация", "russia", "russian federation"),
    ("беларусь", "белоруссия", "республика беларусь", "belarus"),
)


def _is_yes(value: Any) -> bool:
    """Явное «да» из профиля: True или «да/yes/true/1» строкой."""
    if isinstance(value, bool):
        return value
    return normalize(str(value)) in {"да", "yes", "true", "1"}


def _value_variants(value: str) -> list[str]:
    wanted = normalize(value)
    for group in _EQUIVALENT_VALUES:
        if wanted in group:
            return [value, *[item for item in group if item != wanted]]
    return [value]


def _phone_for_control(phone: str, control: ControlState) -> str:
    """Тот же номер в записи, которую поле примет.

    Macroscop просит pattern="[0-9]*", а профиль хранит +7…: форма падала на
    проверке до отправки. Номер не меняется — меняется только запись: цифры,
    с восьмёркой, без кода страны, с плюсом.
    """
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 11 and digits[0] in "78":
        local = digits[1:]
    elif len(digits) == 10:
        local = digits
    else:
        return phone
    mask = f"+7 ({local[:3]}) {local[3:6]}-{local[6:8]}-{local[8:]}"
    named = dict(zip(_PHONE_FORMATS, ("+7" + local, "7" + local, "8" + local, local, mask)))
    if control.fix_format in named:
        return named[control.fix_format]
    variants = [phone, *named.values()]
    fitting = []
    for variant in variants:
        if control.maxlength is not None and len(variant) > control.maxlength:
            continue
        if control.pattern:
            try:
                if not re.fullmatch(control.pattern, variant):
                    continue
            except re.error:
                return phone
        if variant not in fitting:
            fitting.append(variant)
    if not fitting:
        return phone
    # Сайт отверг запись — на каждом круге исправления следующая подходящая.
    return fitting[control.fix_round % len(fitting)]


def _date_for_control(value: Any, control: ControlState) -> str:
    """Дата для поля: <input type=date> — только ГГГГ-ММ-ДД; текстовое поле на
    кругах исправления — ДД.ММ.ГГГГ (или как подсказала Алиса)."""
    iso = _date_for_html(value)
    if control.type == "date" or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", iso):
        return iso
    dmy = f"{iso[8:]}.{iso[5:7]}.{iso[:4]}"
    if control.fix_format == "date_dmy":
        return dmy
    if control.fix_format == "date_iso":
        return iso
    return dmy if control.fix_round % 2 else iso


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


# Поле внутри раздела анкеты: WORK[POSITION], EDUCATION[YEAR][], VACANCY[NAME].
_SECTION_FIELD_RE = re.compile(r"([a-z_]+)\[([a-z_]+)\](?:\[\d*\])*")
# Разделы биографии: прошлые места работы и учёбы. Этих фактов в профиле нет,
# а совпадение по слову давало выдумку — «должность на прошлой работе» из
# желаемой должности, «год окончания» из уровня образования.
# Сравнивается ВСЁ внешнее слово, не начало: по началу под запрет попадали
# job_application[email] (разметка Greenhouse), career_form[…], jobform[…].
_HISTORY_SECTION_RE = re.compile(
    r"(?:work|experience|job|career|employment|education|study|studie|course)s?(?:_history)?"
)
_NAME_PARTS = (("фамил",), ("имя", "имени"), ("отчеств",))


def choose_key(
    control: ControlState,
    profile: CandidateProfile,
    page_url: str,
    page: PageState | None = None,
) -> str | None:
    override = field_override(page_url, control.name, control.id)
    if override:
        if override == "resume":
            return override
        return override if override in profile.values else None

    if control.type == "file":
        # Файл — это резюме или вложение, а не телефон: id=file_input-brief-mobile
        # у Globus IT сопоставлялся с номером (разведка 30.09).
        return None

    section = _SECTION_FIELD_RE.fullmatch((control.name or "").strip().lower())
    # Почта и телефон — контакт кандидата, биографией они не бывают.
    if section and control.type not in {"email", "tel"}:
        outer, inner = section.groups()
        if _HISTORY_SECTION_RE.fullmatch(outer):
            # Уровень образования — факт профиля; остальное в разделе — нет.
            if outer.startswith("educat") and inner == "level" and "education" in profile.values:
                return "education"
            return None
        # Смысл поля — во внутреннем имени: VACANCY[NAME] — это имя, а не
        # вакансия. Внешнее слово в описании поля сбивало сопоставление.
        control = replace(control, name=inner, id="" if control.id == control.name else control.id)

    # «Фамилия и имя», «Фамилия имя отчество», «Имя, фамилия», «ФИО» — одно
    # поле на всё имя. По отдельному слову агент вписывал сюда только фамилию
    # или только отчество.
    text = normalize(" ".join((control.label, control.placeholder, control.aria, control.title_attr)))
    parts = sum(1 for markers in _NAME_PARTS if any(marker in text for marker in markers))
    if (parts >= 2 or re.search(r"\bфио\b", text)) and "full_name" in profile.values:
        return "full_name"

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
        if key == "full_name" and page is not None and any(
            other is not control and other.form_index == control.form_index
            and _is_last_name_control(other)
            for other in page.controls
        ):
            # «Имя» с autocomplete=name рядом с отдельной фамилией — только имя,
            # иначе фамилия уйдёт в анкету дважды (Селектел, 30.09).
            key = "first_name"
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
        # Поле ФИО без подписи: только внутреннее имя говорит, что это всё имя.
        "fio": "full_name",
        "fullname": "full_name",
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
        # «Форма.Поле» (ResumeForm.Fio у Контура): смысл — в последней части.
        for candidate in (compact, compact.rsplit(".", 1)[-1]):
            if candidate in exact and exact[candidate] in profile.values:
                return exact[candidate]
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
    if best[0] >= 30:
        return best[1]
    return _bare_name_key(control, profile, page)


# Служебные слова в имени поля имени: userNamePop, modal_name, 4-popup-form-name.
# Любое другое слово (company, vacancy, file…) — значит поле не про кандидата.
_NAME_NEUTRAL_TOKENS = {
    "user", "your", "form", "popup", "pop", "modal", "input", "field", "text",
    "edit", "value", "responce", "response", "candidate", "applicant", "contact",
    "person", "f", "fl", "my",
}
_LAST_NAME_TOKENS = {"surname", "lastname", "lname", "family"}


def _is_last_name_control(control: ControlState) -> bool:
    """Отдельное поле фамилии: surname, last_name (IBS), lname, family-name
    (Селектел), подпись «Фамилия»."""
    tokens = set(_name_tokens(control.name) + _name_tokens(control.id))
    return bool(
        _LAST_NAME_TOKENS & tokens
        or {"last", "name"} <= tokens
        or normalize(control.autocomplete) == "family name"
        or "фамил" in normalize(" ".join((control.label, control.placeholder)))
    )


def _name_tokens(raw: str) -> list[str]:
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", raw or "")
    return [t for t in re.split(r"[^a-z0-9]+", spaced.lower()) if t and not t.isdigit()]


def _bare_name_key(
    control: ControlState,
    profile: CandidateProfile,
    page: PageState | None,
) -> str | None:
    """Поле имени, которое узнаётся только по внутреннему имени: name, userNamePop,
    responce-fio. Срабатывает, лишь когда подпись ничего не сказала.

    Голое «name» — это всё имя, если в той же форме нет отдельной фамилии;
    иначе — только имя, чтобы фамилия не попала в анкету дважды.
    """
    if control.type in _STRUCTURAL_CONTROL_TYPES or control.tag == "select":
        return None
    for raw in (control.name, control.id):
        tokens = _name_tokens(raw)
        if not tokens:
            continue
        rest = [t for t in tokens if t not in _NAME_NEUTRAL_TOKENS]
        if rest == ["fio"] and "full_name" in profile.values:
            return "full_name"
        if rest in (["fname"], ["firstname"]) and "first_name" in profile.values:
            return "first_name"
        if rest != ["name"]:
            continue
        has_last_name = page is not None and any(
            other is not control
            and other.form_index == control.form_index
            and _is_last_name_control(other)
            for other in page.controls
        )
        key = "first_name" if has_last_name else "full_name"
        return key if key in profile.values else None
    return None


_VACANCY_PATH_RE = re.compile(r"/(?:vacanc(?:y|ies)|jobs?|career/vacanc\w*)/([^/?#]+)", re.I)


_APPLY_SLUGS = {"apply", "application", "response", "questionary", "form", "otklik", "anketa"}


def _path_key(url: str) -> str:
    """Адрес без параметров и якоря: хост и путь."""
    parsed = urllib.parse.urlparse(url or "")
    return f"{(parsed.hostname or '').lower()}{parsed.path.rstrip('/')}"


def _url_key(url: str) -> str:
    """Адрес для «уже были»: без якоря и завершающего слэша, с параметрами.
    /career и /career/ — одна страница (Хоулмонт ходил между ними до MAX_STEPS,
    02.10.2026), а /vacancies?id=33 и ?id=34 — разные."""
    parsed = urllib.parse.urlparse(url or "")
    key = f"{(parsed.hostname or '').lower()}{parsed.path.rstrip('/')}"
    return f"{key}?{parsed.query}" if parsed.query else key


def _climbs_up(url: str, root: str) -> bool:
    """Ссылка уводит со страницы вакансии в её раздел: старт глубже одного
    уровня (/vakansii/analitik-1s/), ссылка — его предок (/vakansii/) и не
    несёт хвост адреса вакансии в параметрах (/vakansii/?apply=analitik-1s —
    это отклик, его оставляем)."""
    segments = [p for p in urllib.parse.urlparse(root or "").path.split("/") if p]
    if len(segments) < 2 or not _is_ancestor_path(url, root):
        return False
    return segments[-1].lower() not in urllib.parse.unquote(urllib.parse.urlparse(url).query).lower()


def _is_ancestor_path(url: str, root: str) -> bool:
    """url — раздел, в котором лежит root (тот же хост, путь root глубже)."""
    a, b = urllib.parse.urlparse(url), urllib.parse.urlparse(root)
    if (a.hostname or "").lower().removeprefix("www.") != (b.hostname or "").lower().removeprefix("www."):
        return False
    parent = (a.path or "/").rstrip("/") + "/"
    child = (b.path or "/").rstrip("/") + "/"
    return child != parent and child.startswith(parent)


def _card_like(url: str) -> bool:
    """Последний сегмент пути — карточка вакансии: номер (3+ цифры) или
    составное имя из трёх и больше слов (sistemnyj-inzhener-nova-core).
    Город или направление (/moscow/, /saint-petersburg/) — нет."""
    segments = [p for p in urllib.parse.urlparse(url or "").path.split("/") if p]
    if not segments:
        return False
    last = urllib.parse.unquote(segments[-1]).lower()
    return bool(re.search(r"\d{3,}", last)) or len(re.findall(r"[-_]", last)) >= 2


def _is_sibling(url: str, current: str) -> bool:
    """Соседний раздел того же уровня: /vacancies/kazan/ рядом с /vacancies/moscow/."""
    a, b = urllib.parse.urlparse(url), urllib.parse.urlparse(current)
    if (a.hostname or "").lower() != (b.hostname or "").lower():
        return False
    pa = [p for p in a.path.split("/") if p]
    pb = [p for p in b.path.split("/") if p]
    return len(pa) == len(pb) >= 2 and pa[:-1] == pb[:-1] and pa[-1] != pb[-1]


def _vacancy_slug(url: str) -> str:
    """Идентификатор вакансии в адресе: /vacancies/118-marketing-lead → 118-marketing-lead."""
    match = _VACANCY_PATH_RE.search(urllib.parse.urlparse(url or "").path)
    slug = match.group(1).lower() if match else ""
    # /jobs/apply?id=1 — это отклик, а не другая вакансия.
    if slug in _APPLY_SLUGS:
        return ""
    # Раздел списка — не вакансия: /career/vacancies/it, /vacancies/all/moscow.
    # У карточки в адресе номер или составное имя (118-marketing-lead,
    # java-developer). Иначе правило «с карточки — только к своему отклику»
    # отрезало со страницы списка все настоящие вакансии (Т-Банк, 30.09).
    return slug if re.search(r"[\d_-]", slug) else ""


def is_application_form(
    page: PageState,
    form_index: int,
    *,
    require_contact: bool = True,
) -> bool:
    """Проверяет, что форма — анкета кандидата, а не соседняя форма сайта.

    Скоринг форм (`_form_score`) сравнивает очки, но не спрашивает, ту ли
    форму вообще сравнивает: разведка живых сайтов показала, что фильтр
    вакансий (чекбоксы городов + «Найти»), подписка на рассылку, cookie-
    баннер, одиночная галочка согласия и форма «порекомендуй знакомого»
    формально набирают очки не хуже анкеты — в них тоже несколько полей и
    кнопка. Заполнить такую форму данными кандидата и отправить её — значит
    подать чужую форму от имени живого человека (запись в «порекомендуй
    знакомого» у IBS, подписка чужой почтой и т.д.). Поэтому до скоринга
    форма обязана пройти этот фильтр.

    `require_contact=False` — для шага уже распознанной анкеты: контакт
    кандидата настоящие визарды часто спрашивают один раз на первом экране,
    а не на каждом шаге. Дисквалификаторы (компания/ИНН, подписка,
    рекомендатель) при этом действуют всегда — они не про отсутствие
    контакта, а про то, что форма — чужая.
    """
    if form_index >= len(page.forms):
        return False

    has_contact = False
    questions = 0  # поля-вопросы, кроме галочек и кнопок
    has_email_only = False
    has_candidate_field = False
    requires_company = False
    has_file = False
    text_fields = 0  # поля для ввода текста (не select)
    only_text_is_email = False
    is_question = False
    # Признак кандидата словами (резюме, вакансия, «о себе»), а не просто поле
    # для файла: вложение бывает и у обратной связи (Верный, 30.09).
    has_candidate_text = False
    # Какими словами форма похожа на анкету: «должность» рядом с «компанией» —
    # должность клиента, а не желаемая (Синимекс, 01.10.2026).
    candidate_words: set[str] = set()
    for control in page.controls:
        if control.form_index != form_index:
            continue

        name = (control.name or "").strip().lower()
        control_id = (control.id or "").strip().lower()

        # Форма «порекомендуй знакомого»: поля рекомендателя рядом с полями
        # кандидата — подать её значит вписать кандидата в чужую заявку.
        if "referrer" in name or "referral" in name or "referrer" in control_id or "referral" in control_id:
            return False
        if any(marker in normalize(control.label) for marker in _REFERRER_LABEL_MARKERS):
            return False

        if control.type == "file":
            has_candidate_field = True  # резюме или портфолио файлом
            has_file = True
            file_text = normalize(" ".join((control.name, control.id, control.label, control.accept)))
            if any(marker in file_text for marker in ("resume", "резюм", "cv", "портфолио", "portfolio")):
                has_candidate_text = True
        if control.type == "radio":
            questions += 1  # выбор из вариантов — вопрос анкеты, у подписки его нет
        if control.type in _STRUCTURAL_CONTROL_TYPES:
            continue

        # Подписка на рассылку — не анкета, даже если в ней ровно одно поле
        # email: у настоящей анкеты бывает такая же галочка, но не текстовое
        # поле подписки.
        if name.startswith("subscri"):
            return False

        haystack = normalize(" ".join(
            str(value) for value in (
                control.name, control.id, control.label, control.placeholder,
                control.autocomplete, control.type,
            ) if value
        ))

        if any(marker in haystack for marker in _ORDER_FORM_MARKERS + _CLIENT_FORM_MARKERS):
            return False
        if any(marker in haystack for marker in _QUESTION_FORM_MARKERS):
            is_question = True

        # Форма для клиентов (заявка от компании), а не для кандидата. ИНН —
        # признак сразу. Обязательная «компания» — только если в форме нет
        # ни одного поля кандидата (резюме, вакансия, «о себе»; проверка после
        # цикла): в IT-анкетах бывает обязательная «текущая компания».
        # Обязательность — атрибутом или звёздочкой в подписи: Digital Design
        # (01.10.2026) пишет «Компания *», не помечая поле required.
        starred = (control.label or "").rstrip().endswith("*")
        if control.required or starred:
            tokens = set(haystack.split())
            if "inn" in tokens or "инн" in tokens:
                return False
            if any(marker in haystack for marker in _COMPANY_FIELD_MARKERS):
                requires_company = True
        hits = [marker for marker in _CANDIDATE_FIELD_MARKERS
                if marker in haystack.split() or len(marker) > 3 and marker in haystack]
        if hits:
            has_candidate_field = True
            has_candidate_text = True
            candidate_words.update(hits)

        if any(marker in haystack for marker in _CONTACT_FIELD_MARKERS):
            has_contact = True
        questions += 1
        has_email_only = control.type == "email" or "mail" in haystack or "почт" in haystack
        if control.tag != "select":
            text_fields += 1
            only_text_is_email = text_fields == 1 and has_email_only

    if requires_company and not has_candidate_field:
        return False
    # Компания и только «должность/position» — форма «свяжитесь с нами»:
    # в анкете кандидата рядом было бы резюме, вакансия или «о себе».
    if requires_company and not has_file and candidate_words and candidate_words <= {"должност", "position"}:
        return False
    if is_question and not has_candidate_text:
        return False
    # Подписка на вакансии: единственное текстовое поле — почта, рядом только
    # select'ы (город, направление), ни имени, ни телефона, ни резюме. Такую
    # у МТС агент принимал за анкету — select'ы делали её «формой с
    # вопросами», и правило про одну почту ниже не срабатывало.
    if not has_file and text_fields == 1 and only_text_is_email:
        form = page.forms[form_index]
        context = normalize(" ".join(
            str(value) for control in page.controls if control.form_index == form_index
            for value in (control.label, control.text, control.value, control.name,
                          control.id, control.placeholder)
            if value
        ) + f" {form.action} {form.id} {form.name}")
        if any(marker in context for marker in _VACANCY_SUBSCRIPTION_MARKERS):
            return False
    # Подписка на рассылку под видом формы: одно поле почты и галочки, больше
    # ни одного вопроса. Разведка браузером (29.09.2026) нашла такие у
    # re-store, МТС и azimuthotels — агент заполнял их вместо анкеты.
    if require_contact and not has_candidate_field and questions == 1 and has_email_only:
        form = page.forms[form_index]
        context = normalize(" ".join(
            str(value) for control in page.controls if control.form_index == form_index
            for value in (control.label, control.text, control.value, control.name, control.id)
            if value
        ) + f" {form.action} {form.id}")
        # Одна почта — анкета, только если форма сама говорит об отклике:
        # у подписки re-store и azimuthotels слово «рассылка» стоит в тексте
        # вокруг формы, а в самой форме — только почта и галочка.
        if any(marker in context for marker in _SUBSCRIPTION_MARKERS):
            return False
        if not any(marker in context for marker in _APPLY_FORM_MARKERS):
            return False
    return has_contact if require_contact else True


class JupiterAgent:
    def __init__(
        self,
        allowed_hosts: set[str],
        max_steps: int = 30,
        *,
        engine: JupiterWebEngine | None = None,
        dry_run: bool = False,
        receipts: ReceiptStore | None = None,
        handoffs: HandoffStore | None = None,
        before_submit: Callable[[str, bool], None] | None = None,
        field_mapper: Callable[[list[dict], list[str]], dict[str, str]] | None = None,
        question_explainer: Callable[[list[dict], dict], dict[str, dict[str, str]]] | None = None,
        outcome_judge: Callable[[dict, list[str]], dict | None] | None = None,
        fix_advisor: Callable[[dict, list[str]], str | None] | None = None,
        alice: Any = None,
    ):
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        self.max_steps = max_steps
        self.dry_run = dry_run
        # Журнал поданных откликов. Без него защита от повтора действует
        # только внутри одного прогона — этого мало, повтор чаще всего
        # случается на второй попытке через день.
        self.receipts = receipts if receipts is not None else ReceiptStore()
        # Состояния возврата: без них «нужен человек» означает «начинай
        # сначала», а начинать сначала после решённой капчи бессмысленно —
        # капча была привязана к нашей прежней сессии.
        self.handoffs = handoffs if handoffs is not None else HandoffStore()
        self.before_submit = before_submit
        # Нейросеть для незнакомых обязательных полей: получает только
        # описания полей и имена заполненных ключей профиля, возвращает
        # {имя поля: ключ}. Значения кандидата и полей ей не показываются,
        # согласия и галочки она не трогает. См. _map_unknown_fields.
        self.field_mapper = field_mapper
        # Нейросеть переписывает вопросы работодателя понятнее (01.10.2026):
        # видит подписи полей формы и заголовок страницы, не данные кандидата.
        # Ключ вопроса не меняет. См. _explain_questions.
        self.question_explainer = question_explainer
        # Исход отправки без явного подтверждения (решение владельца
        # 01.10.2026): нейросеть читает страницу после «Отправить» — значения
        # кандидата вырезаются (второй довод — что вырезать). Успех — только с
        # дословной цитатой страницы. См. _site_verdict.
        self.outcome_judge = outcome_judge
        # Как переписать поле, которое сайт отверг (п.1, 01.10.2026): модель
        # видит подпись, шаблон и сообщение сайта без значений кандидата и
        # выбирает запись из списка. См. _site_fix.
        self.fix_advisor = fix_advisor
        # Алиса-спасатель (02.10.2026, по образцу browser-use): когда свой разбор
        # застрял, нейросеть по одному действию доводит живую вкладку до места,
        # откуда основной цикл идёт сам. Объект с complete_json(system, user,
        # schema_hint). Видит устройство страницы и имена ключей профиля;
        # значения в поля подставляет код (_alice_value). Только браузерный
        # движок. См. alice_agent.py, _alice_rescue.
        self.alice = alice
        self._alice_quota: alice_agent.TaskQuota | None = None
        self._alice_points: set[tuple[str, str]] = set()
        self._alice_radios: set[str] = set()
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
        return max(
            JupiterAgent._option_score_one(variant, label, value)
            for variant in _value_variants(str(wanted))
        )

    @staticmethod
    def _option_score_one(wanted: str, label: str, value: str) -> int:
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

    def drop_preselected_optional_consent(
        self,
        control: ControlState,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
    ) -> None:
        """Снять галочку необязательного согласия, которую отметил сам сайт.

        Реклама, подписка на вакансии, кадровый резерв: человек их не давал,
        а отправка формы с отметкой сайта подписала бы его без спроса (у
        Контура рубрика вакансии в подписке отмечена заранее и уходит вместе
        с анкетой). Обязательные согласия и смешанные галочки не трогаем.
        """
        descriptor = self.descriptor(control)
        kinds = consent_kinds(descriptor)
        if not kinds or any(kind.required_by_law for kind in kinds):
            return
        decision = decide_consent(descriptor, profile.values)
        if decision.action != "skip":
            return
        control.checked = False
        trajectory.append({
            "action": "consent_unchecked",
            "field": descriptor,
            "key": "consent",
            "consent_kinds": decision.kinds,
            "consent_reason": "preselected by the site, not granted by the candidate",
            "provenance": {"field_class": FieldClass.CONSENT, "source": "SITE_DEFAULT"},
        })

    def drop_preselected_radios(
        self,
        page: PageState,
        form_index: int,
        trajectory: list[dict[str, Any]],
    ) -> None:
        """Снять выбор, который сайт сделал за человека в группе радиокнопок.

        У Полюса «Готовность к вахтовому методу» заранее стоит на «Готов» — и
        ушла бы ответом кандидата, которого он не давал. Снятую группу дальше
        заполняет профиль как обычно; не знает ответа — обязательный вопрос
        уходит человеку, необязательный не отправляется вовсе. Группу из
        одной кнопки не трогаем: выбора там нет, это фиксированное значение.
        """
        groups: dict[str, list[ControlState]] = {}
        for control in page.controls:
            if control.form_index == form_index and control.type == "radio" and control.name:
                groups.setdefault(control.name, []).append(control)
        for name, group in groups.items():
            if len(group) < 2:
                continue
            if name in self._alice_radios:
                continue  # выбор сделала Алиса по ключу профиля, а не сайт за человека
            chosen = [c for c in group if c.checked and not c.disabled and not c.readonly]
            if not chosen:
                continue
            for control in chosen:
                control.checked = False
            trajectory.append({
                "action": "radio_default_cleared",
                "field": name,
                "value": chosen[0].value,
                "provenance": {"field_class": FieldClass.FACT, "source": "SITE_DEFAULT"},
            })

    def _fill_from_answer(
        self,
        page: PageState,
        control: ControlState,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
    ) -> bool:
        """Подставить ответ, который человек дал на этот вопрос в приложении.

        Только его собственный ответ (questions.answer_for); вариант списка —
        лишь тот, что есть на сайте, иначе поле остаётся вопросом.
        """
        answers = profile.values.get("answers")
        if not isinstance(answers, dict) or not answers:
            return False
        text = question_text(control, self.descriptor)
        value = answer_for(text, answers)
        if value is None or is_special(text):
            return False
        wanted = str(value).strip()
        if control.tag == "select":
            match = next((o for o in control.options if not o.disabled and wanted and (
                wanted == str(o.value) or normalize(wanted) == normalize(o.label))), None)
            if match is None:
                return False
            control.value = match.value
            for option in control.options:
                option.selected = option is match
        elif control.type == "radio":
            group = [p for p in page.controls
                     if p.type == "radio" and p.name == control.name and p.form_index == control.form_index]
            if any(p.checked for p in group):
                return False
            match = next((p for p in group if wanted == str(p.value)
                          or normalize(wanted) == normalize(p.label or p.text)), None)
            if match is None:
                return False
            for peer in group:
                peer.checked = peer is match
        elif control.type == "checkbox":
            if looks_like_consent(text) or not _is_yes(value):
                return False
            control.checked = True
        else:
            control.value = _date_for_html(wanted) if control.type == "date" else wanted
        trajectory.append({
            "action": "check" if control.type in {"checkbox", "radio"} else "fill",
            "field": text,
            "key": "answer",
            "provenance": {"field_class": FieldClass.FACT, "source": "USER_ANSWER"},
        })
        return True

    def fill_control(
        self,
        page: PageState,
        control: ControlState,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
        key_override: str | None = None,
    ) -> bool:
        if control.type in {"hidden", "submit", "image", "button", "reset"}:
            return False
        if control.readonly:
            # readonly сервер всё равно отправит — но своим значением.
            # Затирать его нельзя: там обычно то, что он сам и подставил.
            return False
        if _looks_like_captcha(control):
            return False
        if control.css_hidden and not control.required:
            # Ловушка для ботов: невидимое человеку поле. Человек бы его не
            # заполнил — и мы не заполняем.
            trajectory.append({"action": "skip_hidden_field", "field": control.name or control.id})
            return False

        descriptor = self.descriptor(control)

        if control.type == "checkbox":
            decision = decide_consent(descriptor, profile.values)
            if decision.kinds:
                # Галочка согласия — не обычное поле. Ставим её, только если
                # человек дал именно это согласие; смешанную («данные и
                # реклама» одним чекбоксом) не ставим сами никогда.
                action = {
                    "check": "check",
                    "skip": "consent_skipped",
                    "ask": "consent_needs_user",
                }[decision.action]
                trajectory.append({
                    "action": action,
                    "field": descriptor,
                    "key": "consent",
                    "consent_kinds": decision.kinds,
                    "consent_reason": decision.reason,
                    "provenance": {
                        "field_class": FieldClass.CONSENT,
                        "source": "USER_CONFIRMATION",
                    },
                })
                if decision.action == "check":
                    control.checked = True
                    return True
                return False

        if control.type == "file":
            # Резюме — одно на анкету и в своё поле. У Контура шесть полей для
            # файлов, и Юпитер вкладывал одно и то же резюме в каждое; а в
            # анкете «Фото» над «Резюме» оно ушло бы в фото.
            if control is not self._resume_target(page, control):
                return False
            if profile.resume_path and Path(profile.resume_path).is_file():
                control.file_path = profile.resume_path
                trajectory.append({
                    "action": "upload",
                    "field": descriptor,
                    "source": "resume",
                    "filename": Path(profile.resume_path).name,
                    "provenance": {
                        "field_class": FieldClass.FACT,
                        "source": "RESUME",
                    },
                })
                return True
            return False

        key = key_override or choose_key(control, profile, page.url, page)
        if (not key or profile.values.get(key) in (None, "")) and self._fill_from_answer(
            page, control, profile, trajectory,
        ):
            return True
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
                        "provenance": {
                            "field_class": FieldClass.PREFERENCE,
                            "source": "SITE_DEFAULT",
                        },
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
                "provenance": provenance_for(key, profile.values),
            })
            return True

        if control.type == "checkbox":
            # Галочка — это «да» на факт о человеке, а не ответ строкой. Любое
            # непустое значение профиля (желаемая должность «Разработчик»)
            # раньше отмечало всё, что на неё похоже: рубрики подписки,
            # фильтры по направлениям. Отмечаем только явное «да».
            if _is_yes(value):
                control.checked = True
                trajectory.append({
                    "action": "check",
                    "field": descriptor,
                    "key": key,
                    "provenance": provenance_for(key, profile.values),
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
                should_check = any(
                    score_alias(descriptor_and_value, variant) >= 30
                    for variant in _value_variants(str(wanted))
                )
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
                    "provenance": provenance_for(key, profile.values),
                })
                return True
            return False

        text = _date_for_control(value, control) if control.type == "date" or key == "birth_date" else str(value)
        if key == "phone":
            text = _phone_for_control(text, control)
        control.value = text
        trajectory.append({
            "action": "fill",
            "field": descriptor,
            "key": key,
            "value": text,
            "provenance": provenance_for(key, profile.values),
        })
        return True

    @staticmethod
    def _evidence(
        before: PageState,
        after: PageState,
        form_gone: bool,
        api_result: dict | None = None,
    ) -> list[SubmissionEvidence]:
        """Доказательства того, что отклик приняли.

        Единственный механизм: раньше рядом жила проверка «есть ли на
        странице слово „спасибо“», и она подтверждала отправку на сайте, где
        это слово стоит в подвале всегда.

        api_result — что ответило API самой страницы на отправку (браузерный
        движок, browser_success.classify). SPA часто не меняет ни адрес, ни
        текст, и единственное подтверждение — JSON сервера.
        """
        evidence = collect_evidence(
            before_url=before.url,
            before_text=before.text,
            after_url=after.url,
            after_text=after.text,
            after_status=after.status,
            success_markers=SUCCESS_MARKERS,
            form_gone=form_gone,
            normalize=normalize,
        )
        if api_result:
            detail = "; ".join(api_result.get("evidence") or [])[:300]
            if api_result.get("api_error"):
                evidence.append(SubmissionEvidence(
                    "API_ERROR", f"{api_result['api_error']} {detail}".strip(), 0.0, after.url,
                ))
            elif api_result.get("api_success"):
                evidence.append(SubmissionEvidence("API_RESPONSE", detail, 0.85, after.url))
        return evidence

    @staticmethod
    def _candidate_id(profile: CandidateProfile) -> str:
        for key in ("candidate_id", "email", "phone", "full_name"):
            value = str(profile.values.get(key) or "").strip()
            if value:
                return value
        return "anonymous"

    def _fingerprint(
        self,
        page: PageState,
        form,
        submit: ControlState | None,
        profile: CandidateProfile,
    ) -> ApplicationFingerprint:
        names = [
            page.controls[index].name
            for index in form.control_indices
            if page.controls[index].name
        ]
        action = submit.formaction if submit and submit.formaction else form.action
        return ApplicationFingerprint.build(
            candidate_id=self._candidate_id(profile),
            vacancy_url=self._root_url or page.url,
            apply_url=page.url,
            control_names=names,
            action=page.resolve(action or page.url),
        )

    # Где капча может быть упомянута по делу. Раньше проверялся весь HTML
    # целиком, и форма с action="/captcha-submit" объявлялась капчей — то есть
    # анкета, которую человек уже прошёл, застревала навсегда.
    _CAPTCHA_ATTR_RE = re.compile(
        r"""\b(?:class|id|name|src|data-sitekey|data-captcha)\s*=\s*"""
        r"""["']([^"']*)["']""",
        re.IGNORECASE,
    )

    @classmethod
    def detect_captcha(cls, page: PageState) -> bool:
        haystacks = [normalize(page.text)]
        haystacks.extend(
            value.lower()
            for value in cls._CAPTCHA_ATTR_RE.findall(page.html or "")
        )
        for control in page.controls:
            haystacks.append(
                " ".join([control.name, control.id, control.label]).lower()
            )
        return any(
            marker in haystack
            for haystack in haystacks
            for marker in CAPTCHA_MARKERS
        )

    def _resume_target(self, page: PageState, control: ControlState) -> ControlState:
        """Файловое поле формы, куда идёт резюме: подписанное как резюме, иначе
        первое обязательное, иначе первое. Уже заполненное поле формы — цель,
        чтобы резюме не уходило второй раз."""
        peers = [
            peer for peer in page.controls
            if peer.type == "file" and peer.form_index == control.form_index
        ]
        for peer in peers:
            if peer.file_path:
                return peer
        for peer in peers:
            descriptor = normalize(self.descriptor(peer))
            if any(marker in descriptor for marker in ("resume", "cv", "brief", "резюм")):
                return peer
        for peer in peers:
            if peer.required:
                return peer
        return peers[0] if peers else control

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

    # Чего нейросеть не трогает никогда: галочки (там согласия — только по
    # правилам), файлы, пароли, скрытые поля и кнопки.
    _LLM_SKIP_TYPES = {
        "checkbox", "file", "password", "hidden", "submit", "image", "button", "reset",
    }

    def _llm_candidates(
        self,
        page: PageState,
        form_index: int,
        profile: CandidateProfile,
    ) -> dict[str, list[ControlState]]:
        """Обязательные пустые поля, которые правила не сопоставили с профилем.

        Ключ — имя поля (для радиокнопок — имя группы), значение — элементы.
        """
        found: dict[str, list[ControlState]] = {}
        checked_groups = {
            control.name for control in page.controls
            if control.form_index == form_index and control.type == "radio"
            and control.name and control.checked
        }
        for control in page.controls:
            if control.form_index != form_index or not control.name:
                continue
            if control.type in self._LLM_SKIP_TYPES or control.tag == "button":
                continue
            if control.disabled or control.readonly or _looks_like_captcha(control):
                continue
            if control.type == "radio":
                group = [
                    peer for peer in page.controls
                    if peer.form_index == form_index and peer.type == "radio"
                    and peer.name == control.name
                ]
                if control.name in checked_groups or not any(p.required for p in group):
                    continue
            elif not control.required or not self.control_is_empty(control):
                continue
            descriptor = self.descriptor(control)
            if consent_kinds(descriptor) or control.type == "checkbox" and looks_like_consent(descriptor):
                continue
            if self._resume_alternative_satisfied(page, control):
                continue
            if choose_key(control, profile, page.url, page):
                continue  # правила поле узнали — значит, не хватает данных, а не смысла
            found.setdefault(control.name, []).append(control)
        return found

    @staticmethod
    def _llm_field_description(controls: list[ControlState]) -> dict[str, Any]:
        """Описание поля для нейросети — без значений поля и кандидата."""
        first = controls[0]
        if first.type == "radio":
            return {
                "name": first.name,
                "label": "",
                "placeholder": "",
                "type": "radio",
                "options": [peer.label or peer.text for peer in controls if peer.label or peer.text],
            }
        return {
            "name": first.name,
            "label": first.label or first.aria or first.title_attr,
            "placeholder": first.placeholder,
            "type": "select" if first.tag == "select" else (
                "textarea" if first.tag == "textarea" else (first.type or "text")
            ),
            "options": [
                option.label for option in first.options
                if not option.disabled and option.label
            ] if first.tag == "select" else [],
        }

    @staticmethod
    def _llm_allowed_keys(profile: CandidateProfile) -> list[str]:
        """Ключи профиля, которые реально заполнены. Только имена, без значений."""
        return sorted(
            key for key, value in profile.values.items()
            if value is not None and value != "" and not isinstance(value, (dict, list))
            # Юридические вопросы (гражданство, судимость, права) — к
            # человеку: ошибка сопоставления там — ложное заявление от его
            # имени, а не опечатка.
            and classify_key(key) not in {FieldClass.CONSENT, FieldClass.LEGAL}
            and key not in {"candidate_id", "resume"}
        )

    def _map_unknown_fields(
        self,
        page: PageState,
        form_index: int | None,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
    ) -> bool:
        """Спросить нейросеть, каким известным ключам отвечают незнакомые поля.

        Нейросеть только сопоставляет поле с ключом, который у кандидата уже
        заполнен; значение берётся из профиля обычным путём fill_control.
        Любой сбой — как будто нейросети нет. Возвращает, заполнено ли хоть
        одно поле.
        """
        if self.field_mapper is None or form_index is None:
            return False
        unknown = self._llm_candidates(page, form_index, profile)
        allowed = self._llm_allowed_keys(profile)
        if not unknown or not allowed:
            return False
        fields = [self._llm_field_description(controls) for controls in unknown.values()]
        try:
            answer = self.field_mapper(fields, list(allowed))
        except Exception:  # noqa: BLE001 — сбой нейросети не должен ронять отклик
            return False
        if not isinstance(answer, dict):
            return False
        filled = False
        for name, key in answer.items():
            if not isinstance(name, str) or not isinstance(key, str):
                continue
            if key not in allowed or name not in unknown:
                continue
            for control in unknown[name]:
                if self.fill_control(page, control, profile, trajectory, key_override=key):
                    trajectory.insert(len(trajectory) - 1, {
                        "action": "llm_map", "field": name, "key": key,
                    })
                    filled = True
                    break
        return filled

    def _explain_questions(
        self, page: PageState, form_index: int | None, questions: list[dict],
    ) -> list[dict]:
        """Понятный текст и пояснение к вопросам — если есть нейросеть.

        Добавляет display/hint и уточняет kind; key и text (подпись сайта) не
        трогает. Любой сбой — вопросы как есть.
        """
        if self.question_explainer is None or not questions:
            return questions
        fields = []
        for control in page.controls:
            if form_index is not None and control.form_index != form_index:
                continue
            if control.type in {"hidden", "submit", "image", "button", "reset"}:
                continue
            label = str(self.descriptor(control) or "").strip()
            if label and label not in fields:
                fields.append(label)
        context = {
            "host": urllib.parse.urlparse(page.url).hostname or "",
            "title": page.title, "fields": fields,
        }
        try:
            answer = self.question_explainer(questions, context)
        except Exception:  # noqa: BLE001 — сбой нейросети не должен ронять отклик
            return questions
        if not isinstance(answer, dict):
            return questions
        for q in questions:
            extra = answer.get(q.get("key"))
            if not isinstance(extra, dict) or not extra.get("question"):
                continue
            q["display"] = str(extra["question"])[:200]
            if extra.get("hint"):
                q["hint"] = str(extra["hint"])[:400]
            if extra.get("kind") in ("fact", "vacancy"):
                q["kind"] = extra["kind"]
        return questions

    def _missing_reason_code(
        self,
        page: PageState,
        form_index: int | None,
    ) -> str:
        """Почему обязательное поле пустое — согласие, закон или просто нет данных.

        Три разных разговора с человеком. «Поставьте галочку» — одно,
        «подтвердите гражданство» — другое, «заполните профиль» — третье.
        """
        consent_pending = False
        legal_pending = False
        for control in page.controls:
            if form_index is not None and control.form_index != form_index:
                continue
            if not control.required or control.disabled:
                continue
            if not self.control_is_empty(control):
                continue
            descriptor = self.descriptor(control)
            if control.type == "checkbox" and looks_like_consent(descriptor):
                consent_pending = True
                continue
            key = choose_key(control, CandidateProfile(values={}), page.url)
            if key and classify_key(key) == FieldClass.LEGAL:
                legal_pending = True
        if consent_pending:
            return Reason.CONSENT_REQUIRED
        if legal_pending:
            return Reason.UNKNOWN_REQUIRED_QUESTION
        return Reason.MISSING_PROFILE_FIELD

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
    # «Далее» должно выигрывать у «Назад» и «Сохранить», но проигрывать
    # «Откликнуться»: если на шаге есть и то и другое, отклик главнее.
    STEP_NEXT = (
        "далее", "продолжить", "дальше", "следующий", "next", "continue",
        "вперед", "вперёд",
    )
    STEP_BACK = ("назад", "back", "вернуться", "предыдущий", "previous")
    STEP_SAVE = ("сохранить", "черновик", "draft", "save")
    # Слова, после которых шага уже не будет: это последняя кнопка анкеты.
    FINAL_SUBMIT = (
        "отклик", "откликнуться", "подать заявку", "оставить заявку",
        "отправить", "submit", "apply", "send", "готово", "завершить",
        "finish",
    )

    @classmethod
    def _button_text(cls, control: ControlState) -> str:
        return normalize(" ".join(filter(None, [
            control.text, control.value, control.label, control.aria,
            control.title_attr, control.name, control.id,
        ])))

    @classmethod
    def submit_intent(cls, control: ControlState) -> str:
        """apply / next / back / save / unknown.

        Порядок проверок важен. «Отправить заявку» и «Далее» в одной строке
        не встречаются, а вот «Сохранить и продолжить» — сплошь и рядом,
        и это всё-таки переход, а не отправка.
        """
        text = cls._button_text(control)
        if any(normalize(token) in text for token in cls.STEP_BACK):
            return "back"
        if any(normalize(token) in text for token in cls.STEP_NEXT):
            return "next"
        if any(normalize(token) in text for token in cls.FINAL_SUBMIT):
            return "apply"
        if any(normalize(token) in text for token in cls.STEP_SAVE):
            return "save"
        return "unknown"

    @classmethod
    def _submit_score(cls, control: ControlState) -> int:
        text = cls._button_text(control)
        score = 0
        for token, weight in cls.SUBMIT_INTENT + cls.SUBMIT_AVOID:
            if normalize(token) in text:
                score += weight
        if cls.submit_intent(control) == "next":
            # Ровно между «назад/сохранить» и «откликнуться».
            score += 20
        return score

    @classmethod
    def _submit_control(
        cls,
        page: PageState,
        target_form_index: int | None,
        *,
        require_contact: bool = True,
    ) -> ControlState | None:
        candidates = [
            control
            for control in page.controls
            if cls.is_submit(control)
            and not control.disabled
            and control.form_index is not None
            and (
                control.form_index == target_form_index
                if target_form_index is not None
                # Без выбранной анкеты кнопку всё ещё можно нажать — но
                # только у формы, которая сама похожа на анкету. Иначе
                # страница без анкеты, но с подпиской/фильтром вакансий,
                # подсунет их кнопку вместо честного «анкета не найдена».
                # require_contact — тот же признак «уже внутри анкеты», что
                # и в _target_form_index: контакт не требуем повторно.
                else is_application_form(
                    page, control.form_index, require_contact=require_contact
                )
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
            links.append((page.resolve(href), text))
        return links

    @staticmethod
    def _spa_links(page: PageState) -> list[tuple[str, str]]:
        """Адреса из состояния SPA — второй источник ссылок, не замена первому.

        На React/Next-странице <a href> на анкету может не быть вовсе: его
        дорисовывает браузер. Но сам адрес обычно уже лежит в __NEXT_DATA__ или
        в ld+json. Права это не расширяет: кандидат проходит ту же проверку
        хоста, что и обычная ссылка.
        """
        payloads = extract_payloads(page.html)
        if not payloads:
            return []
        return url_candidates(payloads, page.base_url or page.url)

    @staticmethod
    def _spa_payload_kinds(page: PageState) -> list[str]:
        seen: list[str] = []
        for payload in extract_payloads(page.html):
            label = payload.as_diagnostic()["kind"]
            if label not in seen:
                seen.append(label)
        return seen

    def _js_engine_navigation(
        self,
        page: PageState,
        visited: set[str],
    ) -> tuple[str, str] | None:
        """QuickJS: выполнить скрипты страницы, найти fetch/XHR-вызовы."""
        try:
            js = JsEngine()
            result = js.execute_page(page.html, page.url)
        except (JsEngineError, Exception):
            return None
        if not result.intercepted:
            return None
        ranked: list[tuple[int, str]] = []
        for req in result.intercepted:
            url = req.url
            if not url or url in visited:
                continue
            parsed = urllib.parse.urlparse(url)
            host = (parsed.hostname or "").lower()
            if host and host not in self.engine.allowed_hosts:
                continue
            score = self._navigation_score(url, req.method)
            if score <= 0:
                low = url.lower()
                if any(k in low for k in (
                    "/api/", "/v1/", "/v2/", "/graphql",
                    "application", "vacanc", "resume", "apply",
                )):
                    score = max(score, 10)
            if score > 0:
                ranked.append((score, url))
        if not ranked:
            return None
        ranked.sort(reverse=True)
        return ranked[0][1], "js_engine"

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

    def _best_navigation(
        self,
        page: PageState,
        visited: set[str],
    ) -> tuple[str, str] | None:
        """Лучший следующий адрес и откуда он взят."""
        ranked: list[tuple[int, int, str, str]] = []
        sources: list[tuple[list[tuple[str, str]], str, int]] = [
            (self._extract_links(page), "link", 1),
            # Состояние SPA — запасной источник: при равном счёте обычная
            # ссылка вперёд. Она видна человеку, а значит проверяема.
            (self._spa_links(page), "spa_state", 0),
        ]
        own_vacancy = _vacancy_slug(self._root_url)
        # Со списка дошли до карточки — дальше она и есть вакансия: соседние
        # карточки не перебираем (СИБУР ходил по ним до MAX_STEPS, 02.10.2026).
        card_root = self._root_url
        if not own_vacancy and _card_like(page.url):
            own_vacancy = _vacancy_slug(page.url)
            card_root = page.url
        # Один путь с разными параметрами — не больше двух заходов: второй
        # бывает вакансией (/vacancies?id=33), дальше это перебор фильтров
        # (?direction=…), и разведка упиралась в MAX_STEPS вместо «нужен
        # браузер» (Т-Банк IT, 30.09).
        path_visits: dict[str, int] = {}
        seen_keys = {_url_key(seen) for seen in visited}
        for seen in seen_keys:
            key = _path_key("//" + seen)
            path_visits[key] = path_visits.get(key, 0) + 1
        for candidates, origin, priority in sources:
            for url, text in candidates:
                if (url in visited or _url_key(url) in seen_keys or _url_key(url) == _url_key(page.url)
                        or path_visits.get(_path_key(url), 0) >= 2):
                    continue
                # С карточки вакансии — только к отклику на неё же. Соседняя
                # вакансия в «похожих» набирает те же очки, и агент заполнял
                # анкету на чужую позицию (mish.design, infotecs; 29.09.2026).
                slug = _vacancy_slug(url)
                if own_vacancy and slug and slug != own_vacancy:
                    continue
                # И не «на уровень выше»: со страницы вакансии ссылка на её же
                # раздел (/vakansii/ с /vakansii/analitik-1s/) уводила в общий
                # список, где анкеты нет — 29 сайтов «не нашёл анкету» (01.10.2026).
                if _climbs_up(url, self._root_url) or _climbs_up(url, card_root):
                    continue
                parsed = urllib.parse.urlparse(url)
                if (parsed.hostname or "").lower() not in self.engine.allowed_hosts:
                    continue
                score = self._navigation_score(url, text)
                if score > 0:
                    # Со списка — в карточку, а не по соседним фильтрам: СИБУР
                    # перебирал города (/vacancies/moscow/ → /kazan/ → …) до
                    # MAX_STEPS (разбор 220 «анкета не найдена», 02.10.2026).
                    if _card_like(url):
                        score += 40
                    elif _is_sibling(url, page.url):
                        score -= 40
                    ranked.append((score, priority, url, origin))
        if not ranked:
            return None
        ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
        return ranked[0][2], ranked[0][3]

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
            key = choose_key(control, profile, page.url, page)
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
        *,
        require_contact: bool = True,
    ) -> int | None:
        if not page.forms:
            return None
        # Форма, не похожая на анкету кандидата (фильтр вакансий, подписка,
        # форма для клиентов, «порекомендуй знакомого»), из сравнения очков
        # исключается ДО скоринга — иначе она может набрать больше баллов,
        # чем настоящая анкета, и агент заполнит и отправит чужую форму.
        # require_contact=False — шаг уже распознанной анкеты (in_flow):
        # контакт кандидата настоящие визарды спрашивают один раз на первом
        # экране, а не на каждом шаге. Дисквалификаторы действуют всегда.
        scored = [
            (self._form_score(page, form.index, profile), form.index)
            for form in page.forms
            if is_application_form(page, form.index, require_contact=require_contact)
        ]
        scored.sort(reverse=True)
        if not scored or scored[0][0] < 40:
            return None
        return scored[0][1]

    def _expand_policy_for_start(self, url: str) -> None:
        parsed = urllib.parse.urlparse(url)
        if parsed.hostname:
            host = parsed.hostname.lower()
            # melonfashion.ru → www.melonfashion.ru — тот же сайт: разведка 29.09
            # резала этот редирект как чужой домен у Familia, Винлаба, ПИК и др.
            bare = host.removeprefix("www.")
            self.allowed_hosts.update({host, bare, "www." + bare})
        self.allowed_hosts.update(trusted_hosts_for(url))
        self.engine.allowed_hosts.update(self.allowed_hosts)

    @staticmethod
    def _step_signature(page: PageState, form_index: int | None) -> str:
        """Отпечаток шага: адрес, адрес отправки и набор полей.

        По нему видно, что «Далее» вернуло тот же экран. Ни текст страницы, ни
        её адрес для этого не годятся: текст меняется сообщением об ошибке, а
        адрес — самим POST, и топтание на месте выглядит движением. Шаг узнаётся
        по тому, куда форма отправляется и из каких полей состоит.
        """
        if form_index is None or form_index >= len(page.forms):
            return f"{page.url}|no-form"
        form = page.forms[form_index]
        names = sorted(
            page.controls[index].name
            for index in form.control_indices
            if page.controls[index].name
        )
        return f"{page.resolve(form.action or page.url)}|{','.join(names)}"

    def _dry_run_complete(
        self,
        page: PageState,
        trajectory: list[dict[str, Any]],
        captcha: bool,
        flow: "FormFlow | None" = None,
        next_button: ControlState | None = None,
    ) -> AgentResult:
        if next_button is not None:
            # Честный ответ вместо удобного. Дальше по анкете можно пройти
            # только настоящим POST, а dry-run его запрещает на уровне
            # движка. Сказать «готово к отправке», заполнив первый экран из
            # трёх, — это ровно тот ложный успех, ради которого весь dry-run
            # и затевался.
            reason = (
                "Step filled and valid, but the form continues: "
                f"button {self.descriptor(next_button) or next_button.text!r} "
                "moves to the next step, and dry-run must not send anything"
            )
            if captcha:
                reason += "; CAPTCHA/human verification also remains"
            trajectory.append({
                "action": "step_ready",
                "url": page.url,
                "captcha": captcha,
                "html_validation": "passed",
                "step_index": flow.step_index if flow else 0,
                "next_button": self.descriptor(next_button) or next_button.text,
                "submit_blocked_by_policy": True,
            })
            return AgentResult(
                "step_ready", reason, trajectory, Reason.MULTI_STEP_DRY_RUN_LIMIT
            )

        filled = sum(1 for item in trajectory if item.get("action") in {"fill", "select", "upload"})
        if filled == 0:
            # Форма нашлась, а вписать в неё нечего — это не анкета (Tilda
            # раскладывает поля по отдельным формам, job.ginza.ru 29.09.2026).
            # «Готово к отправке» здесь было бы ложным успехом.
            reason = "Form found, but no candidate field was filled"
            trajectory.append({
                "action": "failed", "reason": reason,
                "reason_code": Reason.VACANCY_NOT_FOUND,
            })
            return AgentResult("failed", reason, trajectory, Reason.VACANCY_NOT_FOUND)

        reason = "Dry-run complete: fields filled; submit was not attempted"
        if captcha:
            reason += "; CAPTCHA/human verification remains for the user"
        trajectory.append({
            "action": "ready_to_submit",
            "url": page.url,
            "captcha": captcha,
            "html_validation": "passed",
            "step_index": flow.step_index if flow else 0,
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

    def _handoff(
        self,
        page: PageState,
        trajectory: list[dict[str, Any]],
        *,
        action_type: str,
        prompt: str,
        reason_code: str,
        field_name: str | None = None,
    ) -> AgentResult:
        """Остановиться так, чтобы можно было вернуться."""
        token = new_token()
        request = HumanActionRequest(
            type=action_type,
            prompt=prompt,
            page_url=page.url,
            resume_token=token,
            field=field_name,
        )
        self.handoffs.save(ResumeState(
            token=token,
            page_url=page.url,
            allowed_hosts=sorted(self.engine.allowed_hosts),
            dry_run=self.dry_run,
            cookies=self.engine.export_cookies(),
            request=request.as_dict(),
        ))
        trajectory.append({
            "action": "action_required",
            "reason": prompt,
            "reason_code": reason_code,
            "human_action": request.as_dict(),
        })
        return AgentResult(
            "action_required", prompt, trajectory, reason_code, request.as_dict()
        )

    def resume(self, token: str, profile: CandidateProfile) -> AgentResult:
        """Продолжить с того шага, на котором остановились.

        Человек сделал свою часть — решил капчу, ввёл код, вошёл. Сессия при
        этом наша, поэтому возвращаемся со своими куками на тот же адрес.
        """
        state = self.handoffs.load(token)
        if state is None:
            reason = "Resume token is unknown or expired"
            return AgentResult(
                "failed", reason,
                [{"action": "failed", "reason": reason}],
                Reason.NAVIGATION_FAILED,
            )

        self.allowed_hosts.update(state.allowed_hosts)
        self.engine.allowed_hosts.update(state.allowed_hosts)
        self.engine.import_cookies(state.cookies)
        self._root_url = state.page_url
        try:
            page = self.engine.open(state.page_url)
        except EngineError as exc:
            reason = f"Jupiter Web Engine failed to resume: {exc}"
            return AgentResult(
                "failed", reason,
                [{"action": "failed", "reason": reason}],
                Reason.NAVIGATION_FAILED,
            )

        trajectory = [{
            "action": "resume",
            "url": page.url,
            "status": page.status,
            "token": token,
            "waited_for": (state.request or {}).get("type"),
        }]
        result = self._run_from_page(page, profile, trajectory)
        if result.status in {"submitted", "ready_to_submit"}:
            # Задача доведена — состояние возврата больше не нужно, а куки
            # работодателя незачем хранить дольше нужного.
            self.handoffs.drop(token)
        return result

    def _record_receipt(
        self,
        fingerprint: ApplicationFingerprint,
        status: str,
        apply_url: str,
        evidence: list[SubmissionEvidence],
    ) -> Receipt:
        external_id = next(
            (item.value for item in evidence if item.type == "APPLICATION_ID"),
            None,
        )
        receipt = Receipt(
            key=fingerprint.key(),
            status=status,
            apply_url=apply_url,
            evidence=[item.as_dict() for item in evidence],
            external_application_id=external_id,
        )
        self.receipts.record(receipt)
        return receipt

    def _already_submitted(
        self,
        known: Receipt,
        fingerprint: ApplicationFingerprint,
        trajectory: list[dict[str, Any]],
    ) -> AgentResult:
        """Этот отклик уже подавали. Второй раз — не подаём."""
        if known.status == "submitted":
            reason = (
                "This application was already submitted "
                f"(receipt {known.key[:12]}); Jupiter does not send it twice"
            )
            code = Reason.DUPLICATE_BLOCKED
            status = "duplicate"
        else:
            # Прошлый раз ответа не было. Повторять POST вслепую нельзя —
            # именно так и рождается второй отклик у работодателя.
            reason = (
                "A previous attempt left the outcome unknown; "
                "verification is required before any retry"
            )
            code = Reason.SUBMISSION_UNKNOWN
            status = "submission_unknown"
        trajectory.append({
            "action": status,
            "reason": reason,
            "reason_code": code,
            "fingerprint": fingerprint.as_dict(),
            "receipt": known.as_dict(),
        })
        return AgentResult(status, reason, trajectory, code)

    def _site_verdict(self, page: PageState, profile: CandidateProfile) -> dict | None:
        """Что сайт сказал после «Отправить», когда явного подтверждения нет.

        Сначала сам сайт: поля этой формы, помеченные неверными (браузерный
        движок, last_submit_feedback), — отклик точно не ушёл. Иначе — нейросеть
        по странице, без значений кандидата. None — сказать нечего.
        """
        feedback = getattr(self.engine, "last_submit_feedback", None) or {}
        invalid = [f for f in (feedback.get("invalid") or []) if isinstance(f, dict)]
        if invalid:
            labels = [str(f.get("label") or f.get("type") or "поле")[:80] for f in invalid][:10]
            return {"verdict": "needs_fix", "fields": labels, "quote": "", "source": "site",
                    "refs": [str(f["ref"]) for f in invalid if f.get("ref")],
                    "messages": {str(f["ref"]): str(f.get("message") or "")[:120]
                                 for f in invalid if f.get("ref")}}
        if self.outcome_judge is None:
            return None
        secrets = self._secrets(profile)
        try:
            got = self.outcome_judge({
                "title": page.title, "text": page.text,
                "errors": feedback.get("errors") or [], "invalid": invalid,
            }, secrets)
        except Exception:  # noqa: BLE001 — сбой нейросети не должен ронять отклик
            return None
        return dict(got, source="llm") if isinstance(got, dict) else None

    @staticmethod
    def _secrets(profile: CandidateProfile) -> list[str]:
        """Значения кандидата — их вырезают из всего, что видит нейросеть."""
        return [str(v) for v in profile.values.values()
                if isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip()]

    @staticmethod
    def _alice_can_try(question: Any) -> bool:
        """Может ли ответ на вопрос лежать в профиле, пусть агент этого и не видит.

        «Факт» (контакт, пол, стаж) — да. Поле без подписи движок зовёт jt-N, а у
        радио-группы подписью служит первый вариант («Да»): настоящий вопрос
        (соседний текст, legend) видит только Алиса. Прочие — вопросы под вакансию."""
        text = str(question.text).strip()
        if question.kind == "fact" or re.fullmatch(r"jt-\d+", text):
            return True
        return any(
            isinstance(option, dict) and normalize(text) == normalize(str(option.get("label", "")))
            for option in question.options
        )

    def _alice_value(self, profile: CandidateProfile, key: str, fmt: str | None = None) -> str | None:
        """Значение ключа для Алисы. Единственное место, где оно выходит из профиля
        в страницу: модель называет ключ и запись, значения не видит."""
        value = profile.values.get(key)
        if value is None or value == "" or isinstance(value, (dict, list)) or key in {"resume", "candidate_id"}:
            return None
        if isinstance(value, bool):
            return "Да" if value else "Нет"
        text = str(value)
        probe = ControlState(index=0, form_index=None, tag="input", fix_format=fmt or "")
        if fmt in _PHONE_FORMATS:
            return _phone_for_control(text, probe)
        if fmt in ("date_dmy", "date_iso"):
            return _date_for_control(value, probe)
        if key == "birth_date":
            return _date_for_html(value)
        return text

    def _alice_flush(self, page: PageState, form_index: int | None) -> None:
        """Перенести значения агента из модели в живую страницу.

        До submit() они лежат только в PageState, а Алиса смотрит на живой DOM:
        без этого все поля для неё «пусто», и шести шагов не хватит их заново
        заполнить. Тот же _apply_values, что и перед «Отправить», — без клика."""
        apply = getattr(self.engine, "_apply_values", None)
        if apply is None or form_index is None or form_index >= len(page.forms):
            return
        try:
            apply(page, page.forms[form_index])
        except EngineError:
            pass  # не перенеслось — Алиса увидит поле пустым и заполнит сама

    def _alice_rescue(
        self,
        page: PageState,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
        code: str,
        *,
        form_index: int | None = None,
        notes: list[str] | tuple[str, ...] = (),
    ) -> PageState | None:
        """Спасательный заход Алисы (alice_agent.rescue). Вернула страницу — основной
        цикл делает `continue` и заново проверяет поля, капчу, отпечаток, отправляет
        и проверяет успех сам; None — прежний return с прежним кодом.

        Только браузерный движок (у HTTP-движка нет вкладки). Не больше 2 заходов на
        задачу и одного — на точку (код + отпечаток шага). В траектории — действие,
        номер элемента и ключ, значений нет."""
        tab = getattr(self.engine, "_tab", None)
        if self.alice is None or tab is None:
            return None
        if self._alice_quota is None:
            self._alice_quota = alice_agent.TaskQuota(yandex_gpt.BUDGET)
        quota = self._alice_quota
        point = (code, self._step_signature(page, form_index))
        why = ""
        if quota.rescues_left <= 0:
            why = "заходы на задачу кончились"
        elif point in self._alice_points:
            why = "на этой точке Алиса уже была"
        elif quota.remaining() < alice_agent.MIN_CALLS_TO_START:
            why = "мало вызовов модели в бюджете"
        if why:
            trajectory.append({"action": "alice_gave_up", "reason_code": code, "why": why})
            return None
        quota.rescues_left -= 1
        self._alice_points.add(point)
        if code in {Reason.MISSING_PROFILE_FIELD, Reason.VALIDATION_FAILED}:
            self._alice_flush(page, form_index)
        title = (page.title or "").strip()[:80]
        result = alice_agent.rescue(
            self.engine,
            self._llm_allowed_keys(profile),
            f"откликнуться на вакансию «{title}»" if title else "откликнуться на вакансию",
            code,
            self.alice,
            read_only=self.dry_run or bool(getattr(self.engine, "read_only", False)),
            budget=quota,
            value_for=lambda key, fmt=None: self._alice_value(profile, key, fmt),
            resume_path=profile.resume_path,
            notes=notes,
        )
        trajectory.extend(result.steps)
        self._alice_radios |= result.radio_names
        fresh: PageState | None = None
        if result.status != alice_agent.BLOCKED and result.acted:
            try:
                # Живой DOM изменился: модель страницы берём заново, иначе
                # _apply_values перед отправкой затёр бы сделанное Алисой.
                fresh = self.engine.current_page()
            except EngineError as exc:
                result.why = f"страницу не снять: {type(exc).__name__}"
        if fresh is None:
            trajectory.append({"action": "alice_gave_up", "reason_code": code,
                               "status": result.status, "why": result.why})
            return None
        trajectory.append({"action": "alice_rescued", "reason_code": code, "status": result.status,
                           "why": result.why, "calls": result.calls})
        return fresh

    def _site_fix(self, page: PageState, verdict: dict, profile: CandidateProfile,
                  round_no: int) -> list[ControlState]:
        """Поля, подсвеченные сайтом, — к следующему кругу: обязательные, а
        заполненные нами — очищаются и пишутся иначе (_phone_for_control,
        _date_for_control). Возвращает подсвеченные поля этой формы."""
        refs = set(verdict.get("refs") or [])
        messages = verdict.get("messages") or {}
        marked = [c for c in page.controls if c.dom_ref and c.dom_ref in refs]
        for control in marked:
            control.required = True
            if control.tag == "select" or control.type in {"checkbox", "radio", "file"}:
                continue
            control.fix_round = round_no
            if self.fix_advisor is not None and control.value:
                try:
                    hint = self.fix_advisor({
                        "label": self.descriptor(control), "placeholder": control.placeholder,
                        "pattern": control.pattern, "type": control.type,
                        "message": messages.get(control.dom_ref, ""),
                    }, self._secrets(profile))
                except Exception:  # noqa: BLE001 — сбой нейросети не должен ронять отклик
                    hint = None
                control.fix_format = hint or ""
            control.value = ""
        return marked

    def _apply_verdict(
        self,
        verdict: dict,
        fingerprint: ApplicationFingerprint | None,
        page: PageState,
        evidence: list[SubmissionEvidence],
        trajectory: list[dict[str, Any]],
    ) -> AgentResult | None:
        kind = verdict.get("verdict")
        fields = [str(f) for f in (verdict.get("fields") or [])][:10]
        quote = str(verdict.get("quote") or "")[:200]
        trajectory.append({
            "action": "outcome_judged", "source": verdict.get("source"),
            "verdict": kind, "fields": fields, "quote": quote,
        })
        if kind == "accepted" and quote:
            evidence = [*evidence, SubmissionEvidence("PAGE_JUDGED", quote, 0.9, page.url)]
            if fingerprint is not None:
                self._record_receipt(fingerprint, "submitted", page.url, evidence)
            trajectory.append({"action": "success_detected", "url": page.url,
                               "status": page.status, "by": "outcome_judge"})
            return AgentResult("submitted", trajectory=trajectory)
        if kind == "needs_fix":
            reason = ("Site did not accept the form; it asks to fix: "
                      + (", ".join(f"«{f}»" for f in fields) if fields else "fields of the form"))
            code = Reason.SITE_NEEDS_FIX
        elif kind == "error" and quote:
            reason = f"Site answered with an error: «{quote}»"
            code = Reason.SITE_REJECTED
        else:
            return None
        trajectory.append({"action": "action_required", "reason": reason, "reason_code": code})
        return AgentResult("action_required", reason, trajectory, code)

    def _unknown_outcome(
        self,
        before: PageState,
        fingerprint: ApplicationFingerprint,
        trajectory: list[dict[str, Any]],
        detail: str,
    ) -> AgentResult:
        """POST ушёл, ответа нет. Сначала отметка, потом одна проверка GET-ом."""
        receipt = self._record_receipt(
            fingerprint, "submission_unknown", before.url, []
        )
        trajectory.append({
            "action": "submission_unknown",
            "url": before.url,
            "reason": detail,
            "reason_code": Reason.SUBMISSION_UNKNOWN,
            "receipt": receipt.as_dict(),
        })

        # Одна попытка узнать правду безопасным способом. GET ничего не
        # создаёт, поэтому его повторить можно, в отличие от POST.
        try:
            after = self.engine.open(before.url)
        except EngineError as exc:
            reason = (
                "Submission outcome is unknown: the connection dropped and "
                f"verification also failed ({exc})"
            )
            trajectory.append({
                "action": "verification_failed",
                "reason": reason,
                "reason_code": Reason.SUBMISSION_UNKNOWN,
            })
            return AgentResult(
                "submission_unknown", reason, trajectory, Reason.SUBMISSION_UNKNOWN
            )

        evidence = self._evidence(before, after, form_gone=not after.forms)
        trajectory.append({
            "action": "verify_submission",
            "url": after.url,
            "confirmed": is_confirmed(evidence),
            "score": round(score_evidence(evidence), 2),
            "evidence": [item.as_dict() for item in evidence],
        })
        if is_confirmed(evidence):
            self._record_receipt(fingerprint, "submitted", after.url, evidence)
            return AgentResult("submitted", trajectory=trajectory)

        reason = (
            "Submission outcome is unknown: the connection dropped and the "
            "page shows no confirmation. Jupiter will not repeat the POST"
        )
        return AgentResult(
            "submission_unknown", reason, trajectory, Reason.SUBMISSION_UNKNOWN
        )

    def _run_from_page(
        self,
        page: PageState,
        profile: CandidateProfile,
        trajectory: list[dict[str, Any]],
    ) -> AgentResult:
        # sent_once — «хоть один POST ушёл», в том числе переход между
        # шагами. Отметка нужна, чтобы не принять за успех страницу, где
        # слово «спасибо» стояло ещё до всякой отправки.
        sent_once = False
        # Чем был последний ушедший запрос: отправкой отклика или переходом
        # между шагами. Без этого повтор экрана после настоящей отправки
        # объявлялся «шаг не сдвинулся» — и статистика совместимости считала
        # бы неподтверждённые отправки проблемой многошаговых анкет.
        last_click_was_submit = False
        # Сайт подсветил поля после «Отправить» (01.10.2026): на следующем
        # круге они считаются обязательными — заполняем из профиля или
        # спрашиваем человека (вопросы работодателей), и отправляем снова.
        # Не больше SITE_FIX_ROUNDS кругов; POST при этом не уходил.
        site_fix_rounds = 0
        retry_after_fix = False
        flow = FormFlow()
        visited = {page.url}

        for _ in range(self.max_steps):
            captcha = self.detect_captcha(page)
            # Контакт кандидата спрашиваем только на входе в анкету: раз
            # предыдущий шаг этого прогона уже был распознан как анкета,
            # дальше визард ведёт по своей же анкете, и требовать телефон
            # или почту заново на каждом шаге — не про эту форму, а про
            # то, что реальные визарды так не устроены.
            in_flow = bool(flow.signatures)
            target_form_index = self._target_form_index(
                page, profile, require_contact=not in_flow
            )
            filled_before = len(trajectory)
            if target_form_index is not None:
                signature = self._step_signature(page, target_form_index)
                advanced = flow.enter(signature, {
                    "url": page.url,
                    "form_index": target_form_index,
                })
                if not advanced and sent_once and not retry_after_fix:
                    # Тот же экран с тем же набором полей после запроса.
                    # Значит, сервер нас вернул, а мы этого не поняли.
                    if last_click_was_submit:
                        reason = (
                            "Submit returned the same form again without any "
                            "confirmation that the application was accepted"
                        )
                        code = Reason.SUCCESS_NOT_CONFIRMED
                    else:
                        reason = (
                            "Multi-step form returned the same step again: "
                            "Jupiter is not making progress"
                        )
                        code = Reason.STEP_DID_NOT_ADVANCE
                    if code == Reason.STEP_DID_NOT_ADVANCE:
                        rescued = self._alice_rescue(
                            page, profile, trajectory, code, form_index=target_form_index,
                        )
                        if rescued is not None:
                            # Круг идёт заново: «тот же шаг» уже не повод остановиться.
                            page, retry_after_fix = rescued, True
                            continue
                    trajectory.append({
                        "action": "action_required",
                        "reason": reason,
                        "reason_code": code,
                        "step_index": flow.step_index,
                    })
                    return AgentResult("action_required", reason, trajectory, code)
                trajectory.append({
                    "action": "target_form",
                    "form_index": target_form_index,
                    "step_index": flow.step_index,
                    "score": self._form_score(page, target_form_index, profile),
                })
                self.drop_preselected_radios(page, target_form_index, trajectory)
                for control in page.controls:
                    if control.form_index != target_form_index:
                        continue
                    if control.disabled or self.is_submit(control):
                        continue
                    if control.type == "checkbox" and control.checked:
                        self.drop_preselected_optional_consent(control, profile, trajectory)
                        continue
                    if not self.control_is_empty(control):
                        continue
                    self.fill_control(page, control, profile, trajectory)
            filled_any = any(
                item.get("action") in {"fill", "select", "check", "upload"}
                for item in trajectory[filled_before:]
            )

            missing = self._required_missing(page, target_form_index)
            if missing and self._map_unknown_fields(
                page, target_form_index, profile, trajectory
            ):
                missing = self._required_missing(page, target_form_index)
            has_application_form = target_form_index is not None
            submit = self._submit_control(
                page, target_form_index, require_contact=not in_flow
            )
            # Кнопка перехода — не кнопка отправки. Держим её отдельно:
            # от этого зависит и отчёт dry-run, и то, чем мы назовём клик.
            pending_next = (
                submit
                if submit is not None and self.submit_intent(submit) == "next"
                else None
            )

            if has_application_form or filled_any:
                if missing:
                    code = self._missing_reason_code(page, target_form_index)
                    if code != Reason.CONSENT_REQUIRED:
                        questions, special = extract_questions(
                            page, target_form_index, self.descriptor,
                        )
                        # Алиса пробует раньше человека, но только там, где ответ может
                        # лежать в профиле: нет вопросов вовсе, среди них есть «факт»
                        # (контакт, пол, стаж) или поле без настоящей подписи (_alice_can_try).
                        # Вопросы
                        # «под вакансию» ключом не закрываются; согласия, юридические
                        # вопросы и особые категории остаются человеку.
                        if (code == Reason.MISSING_PROFILE_FIELD and not special
                                and (not questions or any(self._alice_can_try(q) for q in questions))):
                            rescued = self._alice_rescue(
                                page, profile, trajectory, code, form_index=target_form_index,
                                notes=["Не заполнены обязательные поля: "
                                       + "; ".join((q.text for q in questions) if questions else missing[:8])],
                            )
                            if rescued is not None:
                                page, retry_after_fix = rescued, True
                                continue
                        # Особые категории — только на сайте, самим человеком.
                        if questions and not special:
                            result = self._handoff(
                                page, trajectory,
                                action_type=HumanAction.UNKNOWN_FIELD,
                                prompt="Employer questions need the candidate's answers: "
                                       + "; ".join(q.text for q in questions),
                                reason_code=Reason.NEEDS_ANSWERS,
                                field_name=questions[0].text,
                            )
                            result.questions = self._explain_questions(
                                page, target_form_index, [q.as_dict() for q in questions],
                            )
                            return result
                    action_type = {
                        Reason.CONSENT_REQUIRED: HumanAction.CONSENT,
                        Reason.UNKNOWN_REQUIRED_QUESTION:
                            HumanAction.LEGAL_CONFIRMATION,
                    }.get(code, HumanAction.UNKNOWN_FIELD)
                    return self._handoff(
                        page, trajectory,
                        action_type=action_type,
                        prompt=(
                            "Missing candidate data for required field(s): "
                            + "; ".join(missing)
                        ),
                        reason_code=code,
                        field_name=missing[0],
                    )

                issues = self._validation_issues(page, target_form_index)
                if issues:
                    # Формат значения: Алиса называет запись (FIX_FORMATS), значение пишет код.
                    rescued = self._alice_rescue(
                        page, profile, trajectory, Reason.VALIDATION_FAILED,
                        form_index=target_form_index,
                        notes=[f"{issue.field}: {issue.rule}; {issue.message}" for issue in issues[:5]],
                    )
                    if rescued is not None:
                        page, retry_after_fix = rescued, True
                        continue
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
                    return self._dry_run_complete(
                        page, trajectory, captcha, flow, pending_next
                    )

                if captcha:
                    return self._handoff(
                        page, trajectory,
                        action_type=HumanAction.CAPTCHA,
                        prompt=(
                            "CAPTCHA detected; the form is filled and waits for "
                            "human verification. Jupiter does not bypass it"
                        ),
                        reason_code=Reason.CAPTCHA_REQUIRED,
                    )

            if submit is None:
                # Страница вакансии Сбера — уже цель: её анкету шлёт адаптер
                # ниже. Уходить отсюда по «Вакансии» или «Искать» нельзя —
                # иначе живая страница уводила на /search/, агент отдавал
                # UNSUPPORTED_SCRIPT, и согласие человека шло по кругу.
                next_step = (
                    None if sber.extract_vacancy(page) is not None
                    else self._best_navigation(page, visited)
                )
                if next_step is not None:
                    next_url, next_origin = next_step
                    trajectory.append({
                        "action": "navigate",
                        "from": page.url,
                        "url": next_url,
                        "found_in": next_origin,
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
                    visited.update({page.url, next_url})
                    continue

                if self.dry_run and (has_application_form or filled_any):
                    return self._dry_run_complete(
                        page, trajectory, captcha, flow, pending_next
                    )

                sber_vacancy = sber.extract_vacancy(page)
                if sber_vacancy is not None:
                    missing_profile = sber.missing_profile_fields(profile)
                    if missing_profile:
                        reason = (
                            "Sber application requires candidate field(s): "
                            + ", ".join(missing_profile)
                        )
                        trajectory.append({
                            "action": "action_required",
                            "reason": reason,
                            "reason_code": Reason.MISSING_PROFILE_FIELD,
                            "site_adapter": "sber_public_api",
                        })
                        return AgentResult(
                            "action_required", reason, trajectory,
                            Reason.MISSING_PROFILE_FIELD,
                        )

                    try:
                        sber_payload = sber.build_payload(
                            page, profile, sber_vacancy
                        )
                    except (OSError, ValueError) as exc:
                        reason = f"Sber application cannot use the selected resume: {exc}"
                        trajectory.append({
                            "action": "action_required",
                            "reason": reason,
                            "reason_code": Reason.MISSING_PROFILE_FIELD,
                            "site_adapter": "sber_public_api",
                        })
                        return AgentResult(
                            "action_required", reason, trajectory,
                            Reason.MISSING_PROFILE_FIELD,
                        )

                    if self.dry_run:
                        trajectory.append({
                            "action": "ready_to_submit",
                            "site_adapter": "sber_public_api",
                            "terms_url": sber.SBER_TERMS_URL,
                        })
                        return AgentResult("ready_to_submit", trajectory=trajectory)

                    # Live authorization is permission to submit the application,
                    # not acceptance of Sber's separate personal-data terms.
                    if not sber.has_personal_data_consent(profile):
                        reason = (
                            "Sber requires explicit consent to personal-data "
                            "processing before the application can be sent"
                        )
                        trajectory.append({
                            "action": "action_required",
                            "reason": reason,
                            "reason_code": Reason.CONSENT_REQUIRED,
                            "site_adapter": "sber_public_api",
                            "terms_url": sber.SBER_TERMS_URL,
                        })
                        return AgentResult(
                            "action_required", reason, trajectory,
                            Reason.CONSENT_REQUIRED,
                        )

                    if self.before_submit is not None:
                        self.before_submit(page.url, False)
                    trajectory.append({
                        "action": "click_submit",
                        "site_adapter": "sber_public_api",
                        "endpoint": sber.SBER_APPLICATION_URL,
                    })
                    try:
                        outcome, message, _body = sber.submit_payload(
                            self.engine, page, sber_payload
                        )
                    except (EngineTransportError, EngineError) as exc:
                        reason = (
                            "Sber application POST outcome is unknown: "
                            + str(exc)
                        )
                        trajectory.append({
                            "action": "submission_unknown",
                            "reason": reason,
                            "reason_code": Reason.SUBMISSION_UNKNOWN,
                            "site_adapter": "sber_public_api",
                        })
                        return AgentResult(
                            "submission_unknown", reason, trajectory,
                            Reason.SUBMISSION_UNKNOWN,
                        )

                    if outcome == "submitted":
                        trajectory.append({
                            "action": "verify_submission",
                            "confirmed": True,
                            "site_adapter": "sber_public_api",
                            "evidence": ["api_success=true"],
                        })
                        return AgentResult("submitted", trajectory=trajectory)

                    if outcome == "duplicate":
                        reason = message or "Sber reports that this vacancy was already applied to"
                        trajectory.append({
                            "action": "duplicate",
                            "reason": reason,
                            "reason_code": Reason.DUPLICATE_BLOCKED,
                            "site_adapter": "sber_public_api",
                        })
                        return AgentResult(
                            "duplicate", reason, trajectory,
                            Reason.DUPLICATE_BLOCKED,
                        )

                    reason = message or "Sber rejected the application"
                    trajectory.append({
                        "action": "action_required",
                        "reason": reason,
                        "reason_code": Reason.SUBMIT_FAILED,
                        "site_adapter": "sber_public_api",
                    })
                    return AgentResult(
                        "action_required", reason, trajectory,
                        Reason.SUBMIT_FAILED,
                    )

                if page.has_script:
                    js_nav = self._js_engine_navigation(page, visited)
                    if js_nav is not None:
                        js_url, js_origin = js_nav
                        trajectory.append({
                            "action": "navigate",
                            "from": page.url,
                            "url": js_url,
                            "found_in": js_origin,
                        })
                        try:
                            page = self.engine.open(js_url)
                        except EngineSecurityError as exc:
                            reason = f"JS-discovered URL blocked by policy: {exc}"
                            trajectory.append({
                                "action": "action_required",
                                "reason": reason,
                                "reason_code": Reason.DOMAIN_BLOCKED,
                            })
                            return AgentResult(
                                "action_required", reason, trajectory,
                                Reason.DOMAIN_BLOCKED,
                            )
                        except EngineError as exc:
                            reason = f"JS-discovered URL failed: {exc}"
                            trajectory.append({
                                "action": "failed",
                                "reason": reason,
                                "reason_code": Reason.NAVIGATION_FAILED,
                            })
                            return AgentResult(
                                "failed", reason, trajectory,
                                Reason.NAVIGATION_FAILED,
                            )
                        visited.add(page.url)
                        continue

                    kinds = self._spa_payload_kinds(page)
                    reason = (
                        "Page requires JavaScript interaction outside the supported "
                        "Jupiter runtime"
                    )
                    if kinds:
                        reason += (
                            "; embedded state was read ("
                            + ", ".join(kinds)
                            + ") and holds no application link"
                        )
                    trajectory.append({
                        "action": "action_required",
                        "reason": reason,
                        "reason_code": Reason.UNSUPPORTED_SCRIPT,
                        "spa_payloads": kinds,
                    })
                    return AgentResult(
                        "action_required", reason, trajectory, Reason.UNSUPPORTED_SCRIPT
                    )
                hr_email = email_apply.find_hr_email(page.html, page.text, self._root_url or page.url)
                if hr_email:
                    reason = "Employer takes applications by email"
                    trajectory.append({"action": "email_apply", "to": hr_email, "url": page.url,
                                       "reason_code": Reason.EMAIL_APPLY})
                    result = AgentResult("action_required", reason, trajectory, Reason.EMAIL_APPLY)
                    result.email_to = hr_email
                    return result
                # Ни анкеты, ни перехода: кнопку отклика без привычных признаков
                # может найти Алиса. Вернула страницу — круг идёт заново.
                rescued = self._alice_rescue(
                    page, profile, trajectory, Reason.VACANCY_NOT_FOUND,
                )
                if rescued is not None:
                    page, retry_after_fix = rescued, True
                    visited.add(page.url)
                    continue
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
                return self._dry_run_complete(
                    page, trajectory, captcha, flow, pending_next
                )

            if captcha:
                return self._handoff(
                    page, trajectory,
                    action_type=HumanAction.CAPTCHA,
                    prompt=(
                        "CAPTCHA detected; the form is filled and waits for "
                        "human verification. Jupiter does not bypass it"
                    ),
                    reason_code=Reason.CAPTCHA_REQUIRED,
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

            # Промежуточная кнопка не отправка: так и записываем. По этой
            # отметке потом считается, был ли отклик вообще подан.
            clicked_next = pending_next is not None
            trajectory.append({
                "action": "click_next" if clicked_next else "click_submit",
                "field": self.descriptor(submit),
                "intent": self.submit_intent(submit),
                "step_index": flow.step_index,
                "method": (submit.formmethod or form.method).upper(),
                "action_url": submit.formaction or form.action or page.url,
            })

            # Отпечаток считается ДО отправки. После неё он уже не нужен:
            # если POST ушёл, а ответа не было, отметку всё равно надо на что-то
            # повесить.
            fingerprint = None
            if not clicked_next:
                fingerprint = self._fingerprint(page, form, submit, profile)
                known = self.receipts.find(fingerprint.key())
                if known is not None:
                    return self._already_submitted(known, fingerprint, trajectory)

            before = page
            before_form_index = form.index
            if self.before_submit is not None:
                self.before_submit(page.url, clicked_next)
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
            except EngineTransportError as exc:
                # Ответа не было. Заявка могла дойти и могла не дойти — и это
                # ровно тот случай, когда повторять POST нельзя.
                if fingerprint is not None:
                    return self._unknown_outcome(
                        before, fingerprint, trajectory, str(exc)
                    )
                reason = f"Jupiter Web Engine lost the connection: {exc}"
                trajectory.append({
                    "action": "failed",
                    "reason": reason,
                    "reason_code": Reason.NAVIGATION_FAILED,
                })
                return AgentResult(
                    "failed", reason, trajectory, Reason.NAVIGATION_FAILED
                )
            except EngineFillError as exc:
                # Клика и запроса не было: before_submit уже взвёл в воркере
                # «отправка начата», но отклик точно не ушёл. Отдельный код
                # не даёт воркеру записать «Скорее всего, ушёл».
                reason = f"Jupiter Web Engine failed to fill form before submit: {exc}"
                trajectory.append({
                    "action": "failed",
                    "reason": reason,
                    "reason_code": Reason.FILL_FAILED,
                })
                return AgentResult(
                    "failed", reason, trajectory, Reason.FILL_FAILED
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

            sent_once = True
            last_click_was_submit = not clicked_next
            submit_mode = getattr(self.engine, "last_submit_mode", "http")
            action_name = {
                "script": "script_submit",
                "script_network": "script_network_submit",
            }.get(submit_mode, "http_submit")
            if clicked_next:
                action_name = "http_step"
            trajectory.append({
                "action": action_name,
                "url": page.url,
                "status": page.status,
                "step_index": flow.step_index,
            })

            form_gone = not any(
                self._step_signature(page, index) == self._step_signature(
                    before, before_form_index
                )
                for index in range(len(page.forms))
            )
            # Ответ API на «Далее» — это сохранение шага, а не отклик.
            api_result = None if clicked_next else getattr(self.engine, "last_api_result", None)
            evidence = self._evidence(before, page, form_gone, api_result)
            trajectory.append({
                "action": "verify_submission",
                "url": page.url,
                "confirmed": is_confirmed(evidence),
                "score": round(score_evidence(evidence), 2),
                "evidence": [item.as_dict() for item in evidence],
            })

            if is_confirmed(evidence):
                if fingerprint is not None:
                    self._record_receipt(fingerprint, "submitted", page.url, evidence)
                trajectory.append({
                    "action": "success_detected",
                    "url": page.url,
                    "status": page.status,
                })
                return AgentResult("submitted", trajectory=trajectory)

            retry_after_fix = False
            if not clicked_next:
                verdict = self._site_verdict(page, profile)
                if (verdict and verdict.get("verdict") == "needs_fix" and verdict.get("source") == "site"
                        and site_fix_rounds < SITE_FIX_ROUNDS):
                    marked = self._site_fix(page, verdict, profile, site_fix_rounds + 1)
                    if marked:
                        site_fix_rounds += 1
                        retry_after_fix = True
                        trajectory.append({"action": "site_fix_retry", "round": site_fix_rounds,
                                           "fields": verdict.get("fields") or [],
                                           "formats": [c.fix_format for c in marked if c.fix_format]})
                        continue
                judged = self._apply_verdict(verdict, fingerprint, page, evidence, trajectory) if verdict else None
                if judged is not None:
                    # Сайт сам подсветил поля до отправки (POST не уходил):
                    # исправить их может Алиса. Вердикт нейросети (не сайта) не
                    # повод — там отклик мог уйти.
                    if judged.reason_code == Reason.SITE_NEEDS_FIX and verdict.get("source") == "site":
                        rescued = self._alice_rescue(
                            page, profile, trajectory, Reason.SITE_NEEDS_FIX,
                            form_index=before_form_index,
                            notes=["Сайт просит исправить: " + "; ".join(
                                str(f) for f in (verdict.get("fields") or [])[:8])],
                        )
                        if rescued is not None:
                            page, retry_after_fix = rescued, True
                            continue
                    return judged

            if self._same_page(before, page):
                if clicked_next:
                    # «Далее» не увело дальше — обычно это отказ проверки на
                    # сервере. Называть это неподтверждённой отправкой нельзя:
                    # отклик мы ещё даже не подавали.
                    reason = (
                        "Step button did not move the form forward; "
                        "the page came back unchanged"
                    )
                    code = Reason.STEP_DID_NOT_ADVANCE
                    rescued = self._alice_rescue(
                        page, profile, trajectory, code, form_index=target_form_index,
                    )
                    if rescued is not None:
                        page, retry_after_fix = rescued, True
                        continue
                else:
                    reason = (
                        "Submit returned the same page without explicit success "
                        "confirmation"
                    )
                    code = Reason.SUCCESS_NOT_CONFIRMED
                trajectory.append({
                    "action": "action_required",
                    "reason": reason,
                    "reason_code": code,
                    "step_index": flow.step_index,
                })
                return AgentResult("action_required", reason, trajectory, code)

        reason = "Max Jupiter steps exceeded"
        trajectory.append({
            "action": "failed",
            "reason": reason,
            "reason_code": Reason.MAX_STEPS,
        })
        return AgentResult("failed", reason, trajectory, Reason.MAX_STEPS)

    def _run_huntflow(
        self, vacancy: "huntflow.HuntflowVacancy", url: str, profile: CandidateProfile,
    ) -> AgentResult | None:
        """Карьерный сайт Huntflow — через его API (huntflow.py). None — API не
        ответил как ждали: дальше обычный разбор страницы."""
        api = self.engine if hasattr(self.engine, "request_json") else JupiterWebEngine(
            set(self.allowed_hosts), read_only=self.dry_run)
        tag = {"site_adapter": "huntflow_api"}
        trajectory: list[dict[str, Any]] = [{"action": "open", "url": url, "dry_run": self.dry_run, **tag}]

        def stop(status: str, reason: str, code: str, **extra: Any) -> AgentResult:
            trajectory.append({"action": status, "reason": reason, "reason_code": code, **tag, **extra})
            return AgentResult(status, reason, trajectory, code)

        try:
            status, body = api.request_json(
                f"{vacancy.origin}/api/vacancy/{urllib.parse.quote(vacancy.slug)}",
                headers={"Referer": url})
        except (EngineError, EngineSecurityError):
            return None
        vid, archived = huntflow.vacancy_id(status, body)
        if vid is None:
            return None
        if archived:
            return stop("action_required", "Huntflow: the vacancy is archived", Reason.VACANCY_NOT_FOUND)
        missing = huntflow.missing_profile_fields(profile)
        if missing:
            return stop("action_required", "Huntflow application requires candidate field(s): "
                        + ", ".join(missing), Reason.MISSING_PROFILE_FIELD)
        resume = huntflow.resume_file(profile)
        if self.dry_run:
            trajectory.append({"action": "ready_to_submit", "vacancy_id": vid,
                               "fields": sorted(huntflow.build_payload(profile, None)),
                               "resume": bool(resume), **tag})
            return AgentResult("ready_to_submit", trajectory=trajectory)
        # Поручение отправить отклик — ещё не согласие с условиями работодателя.
        if not huntflow.has_consent(profile):
            return stop("action_required", "Huntflow requires explicit consent to personal-data "
                        "processing before the application can be sent", Reason.CONSENT_REQUIRED)
        endpoint = f"{vacancy.origin}/api/vacancy/{vid}/response"
        fingerprint = ApplicationFingerprint.build(
            candidate_id=self._candidate_id(profile), vacancy_url=url, apply_url=url,
            control_names=["name", "surname", "phone", "email", "agreement"], action=endpoint)
        known = self.receipts.find(fingerprint.key())
        if known is not None:
            return self._already_submitted(known, fingerprint, trajectory)
        file_id = None
        if resume is not None:
            try:
                file_id = huntflow.uploaded_file_id(*api.request_json(
                    f"{vacancy.origin}/api/vacancy/{vid}/upload", method="POST",
                    files=[("file", resume)], headers={"Referer": url}))
            except (EngineError, EngineSecurityError):
                file_id = None
            trajectory.append({"action": "upload", "source": "resume", "ok": file_id is not None,
                               "filename": resume.name, **tag})
        if self.before_submit is not None:
            self.before_submit(url, False)
        trajectory.append({"action": "click_submit", "endpoint": endpoint, **tag})
        try:
            status, body = api.request_json(endpoint, method="POST",
                                            payload=huntflow.build_payload(profile, file_id),
                                            headers={"Origin": vacancy.origin, "Referer": url})
        except (EngineError, EngineSecurityError) as exc:
            self._record_receipt(fingerprint, "submission_unknown", url, [])
            return stop("submission_unknown", f"Huntflow application POST outcome is unknown: {exc}",
                        Reason.SUBMISSION_UNKNOWN)
        outcome, message, fields = huntflow.interpret_response(status, body)
        if outcome == "submitted":
            evidence = [SubmissionEvidence("API_RESPONSE", f"Huntflow HTTP {status}", 0.95, endpoint)]
            self._record_receipt(fingerprint, "submitted", url, evidence)
            trajectory.append({"action": "verify_submission", "confirmed": True,
                               "evidence": [f"api_status={status}"], **tag})
            return AgentResult("submitted", trajectory=trajectory)
        if outcome == "duplicate":
            return stop("duplicate", "Huntflow reports that this vacancy was already applied to",
                        Reason.DUPLICATE_BLOCKED)
        if outcome == "needs_fix":
            return stop("action_required", "Site did not accept the form; it asks to fix: "
                        + ", ".join(f"«{f}»" for f in fields), Reason.SITE_NEEDS_FIX, message=message)
        return stop("action_required", message, Reason.SUBMIT_FAILED)

    def run(self, url: str, profile: CandidateProfile) -> AgentResult:
        self._root_url = url
        self._alice_quota, self._alice_points, self._alice_radios = None, set(), set()
        self._expand_policy_for_start(url)
        vacancy = huntflow.parse_url(url)
        if vacancy is not None:
            result = self._run_huntflow(vacancy, url, profile)
            if result is not None:
                return result
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
            "engine": getattr(self.engine, "name", "jupiter-web-engine"),
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
            "engine": getattr(self.engine, "name", "jupiter-web-engine"),
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
    parser.add_argument(
        "--receipts",
        help=(
            "Path to the submitted-applications journal. Without it the "
            "duplicate guard only lasts for this run"
        ),
    )
    args = parser.parse_args()

    profile = CandidateProfile.load(args.profile)
    agent = JupiterAgent(
        set(args.allow_host),
        args.max_steps,
        dry_run=args.dry_run,
        receipts=ReceiptStore(args.receipts),
    )
    result = agent.run(args.url, profile)
    print(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
    return 0 if result.status in {
        "submitted", "ready_to_submit", "step_ready", "action_required",
        "duplicate",
    } else 1


if __name__ == "__main__":
    raise SystemExit(main())
