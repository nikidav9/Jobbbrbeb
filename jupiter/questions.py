#!/usr/bin/env python3
"""Вопросы работодателя, на которые у Юпитера нет ответа, и ответы на них.

Решение владельца 30.09.2026 («Вопросы от работодателей»). Когда анкете нужно
то, чего нет в профиле, Юпитер не останавливается молча: он собирает вопросы —
текст, тип ответа, варианты с сайта — и отдаёт их серверу. Человек отвечает в
приложении, отклик уходит сам. Ответ на факт (Telegram, дата выхода,
зарплата) сохраняется в банк и потом подставляется без спроса; ответ на
вопрос под вакансию (почему мы, откуда узнали, выбор подразделения) задаётся
каждый раз.

Три запрета, которые здесь держатся:
- ответ не выдумывается: только то, что человек сам написал;
- особые категории 152-ФЗ (здоровье, инвалидность, судимость, биометрия) в
  очередь не идут и у нас не хранятся — такой отклик человек заполняет на
  сайте работодателя сам (встроенный браузер, «Ждут вас»);
- согласия вопросом не задаются: галочку ставит человек на сайте.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

from candidate import looks_like_consent

# Особые категории персональных данных (152-ФЗ, ст. 10–11) и близкое к ним.
_SPECIAL_MARKERS = (
    "здоров", "инвалид", "болезн", "заболеван", "диагноз", "медицинск",
    "беремен", "судим", "уголовн", "привлекал", "биометр",
    "вероисповед", "религи", "национальн", "политическ",
    "health", "disabilit", "criminal", "convict", "medical", "pregnan",
)

# Вопросы-факты: ответ один на все вакансии. Остальное — «под вакансию».
_FACT_MARKERS = (
    "telegram", "телеграм", "дата рожд", "birth", "пол ", "gender", " sex",
    "зарплат", "доход", "salary", "выйти на работу", "приступить", "дата выхода",
    "start date", "notice", "опыт работ", "стаж", "years of experience",
    "английск", "english", "язык", "гражданств", "citizenship",
    "разрешени на работ", "work permit", "воинск", "военн", "military",
    "водительск", "driving", "автомобил", "переезд", "relocat", "командиров",
    "github", "gitlab", "linkedin", "портфолио", "portfolio", "behance",
    "ссылка на резюме", "resume link", "город", "city", "отчеств",
    "образовани", "education", "текущая должность", "current position",
    "где работаете", "current company", "формат работ", "удален",
)


@dataclass
class Question:
    key: str
    text: str
    type: str
    kind: str
    name: str = ""
    options: list[dict[str, str]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key, "text": self.text, "type": self.type,
            "kind": self.kind, "name": self.name, "options": self.options,
        }


def _flat(text: str) -> str:
    text = (text or "").lower().replace("ё", "е")
    text = re.sub(r"[*•:?!.,;()\[\]\"«»]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def question_key(text: str) -> str:
    """Один и тот же вопрос на разных сайтах — один ключ: по смыслу подписи."""
    return "q:" + hashlib.sha1(_flat(text).encode("utf-8")).hexdigest()[:16]


def is_special(text: str) -> bool:
    flat = f" {_flat(text)} "
    return any(marker in flat for marker in _SPECIAL_MARKERS)


def question_kind(text: str) -> str:
    """fact — подставлять повторно; vacancy — спрашивать каждый раз.

    Сомнение — в пользу «спрашивать»: подставленный чужой ответ хуже вопроса.
    """
    flat = f" {_flat(text)} "
    return "fact" if any(marker in flat for marker in _FACT_MARKERS) else "vacancy"


def _control_type(control: Any) -> str:
    if control.tag == "select" or control.type == "radio":
        return "choice"
    if control.tag == "textarea":
        return "text_long"
    return {
        "checkbox": "yesno", "date": "date", "number": "number",
        "tel": "phone", "email": "email", "url": "url",
    }.get(control.type or "", "text")


def _options(control: Any, group: list[Any]) -> list[dict[str, str]]:
    if control.type == "radio":
        return [
            {"value": str(peer.value or ""), "label": (peer.label or peer.text or str(peer.value or "")).strip()}
            for peer in group if not peer.disabled
        ]
    if control.tag == "select":
        out = []
        for option in control.options:
            label = (option.label or "").strip()
            value = str(option.value or "").strip()
            if option.disabled or not value or _flat(label) in {"", "выберите", "choose", "select"}:
                continue
            out.append({"value": value, "label": label or value})
        return out
    return []


def question_text(control: Any, descriptor: Any) -> str:
    """Текст вопроса: видимая подпись поля, иначе то, что видит агент."""
    text = (control.label or control.placeholder or control.aria or control.title_attr or "").strip()
    text = text or str(descriptor(control) or "").strip()
    if control.tag == "select":
        # <label> вокруг <select> забирает в подпись и тексты вариантов.
        labels = [(o.label or "").strip() for o in control.options if (o.label or "").strip()]
        trimmed = True
        while trimmed:
            trimmed = False
            for label in labels:
                if text.endswith(label) and len(text) > len(label):
                    text = text[: -len(label)].rstrip()
                    trimmed = True
    return text


def extract_questions(
    page: Any, form_index: int | None, descriptor: Any,
) -> tuple[list[Question], bool]:
    """Пустые обязательные поля формы — вопросами. Второе — есть ли особое.

    `descriptor(control)` — подпись поля так, как её видит агент. Капча,
    файлы, скрытые и служебные поля и согласия вопросами не бывают.
    """
    from agent import JupiterAgent, _looks_like_captcha

    questions: list[Question] = []
    special = False
    seen: set[str] = set()
    for control in page.controls:
        if form_index is not None and control.form_index != form_index:
            continue
        if not control.required or control.disabled or control.readonly:
            continue
        if control.type in {"hidden", "submit", "image", "button", "reset", "file", "password"}:
            continue
        if _looks_like_captcha(control) or not JupiterAgent.control_is_empty(control):
            continue
        group = [control]
        if control.type == "radio":
            if not control.name or control.name in seen:
                continue
            group = [p for p in page.controls
                     if p.type == "radio" and p.name == control.name and p.form_index == control.form_index]
            if any(p.checked for p in group):
                continue
            seen.add(control.name)
        text = question_text(control, descriptor)
        if control.type == "checkbox" and looks_like_consent(text):
            continue
        if is_special(text):
            special = True
            continue
        if not text:
            continue
        key = question_key(text)
        if key in {q.key for q in questions}:
            continue
        questions.append(Question(
            key=key, text=text[:300], type=_control_type(control),
            kind=question_kind(text), name=control.name or "",
            options=_options(control, group)[:50],
        ))
    return questions[:30], special


def answer_for(text: str, answers: dict[str, Any] | None) -> Any:
    """Ответ человека на этот вопрос, если он его давал."""
    if not answers or not text:
        return None
    value = answers.get(question_key(text))
    return None if value in (None, "") else value
