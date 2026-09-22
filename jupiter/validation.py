#!/usr/bin/env python3
"""Проверка формы по правилам HTML5 до отправки.

Зачем отдельный слой. Раньше Jupiter считал анкету готовой, как только
заполнил обязательные поля. Браузер так не считает: он не даст отправить
форму, где телефон не подошёл под pattern, а комментарий короче minlength.
Для нас это худший из отказов — мы отчитались «ready_to_submit», а
работодатель заявку не увидел.

Правила ровно те, что применяет браузер: constraint validation. Ничего
своего мы сюда не добавляем — иначе начнём блокировать анкеты, которые
на самом деле принимаются.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from engine import ControlState, FormState, PageState

# Регулярка из спецификации HTML: намеренно мягкая. Строже — значит
# забраковать адрес, который сервер принимает.
_EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9]"
    r"(?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$"
)

_TEXTUAL = {
    "", "text", "search", "tel", "url", "email", "password", "number",
}

_LENGTH_TYPES = {"text", "search", "tel", "url", "email", "password", ""}

_RANGE_TYPES = {"number", "range", "date", "datetime-local", "month", "week", "time"}


@dataclass
class ValidationIssue:
    field: str
    rule: str
    current_value: str
    message: str
    # recoverable=True — значение написал сам Jupiter и может переписать.
    # recoverable=False — данных просто нет, нужен человек или профиль.
    recoverable: bool = True

    def as_dict(self) -> dict[str, object]:
        return {
            "field": self.field,
            "rule": self.rule,
            "current_value": self.current_value,
            "message": self.message,
            "recoverable": self.recoverable,
        }


def _descriptor(control: ControlState) -> str:
    for candidate in (
        control.label,
        control.aria,
        control.name,
        control.placeholder,
        control.id,
    ):
        if candidate:
            return candidate
    return f"control:{control.index}"


def _as_number(value: str) -> Decimal | None:
    try:
        return Decimal(value.strip())
    except (InvalidOperation, ValueError, AttributeError):
        return None


def _as_date(value: str) -> date | None:
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    except (ValueError, AttributeError):
        return None


def _numeric_pair(ctype: str, value: str) -> Decimal | None:
    if ctype == "date":
        parsed = _as_date(value)
        return Decimal(parsed.toordinal()) if parsed else None
    return _as_number(value)


def _skip(control: ControlState) -> bool:
    return (
        control.disabled
        or control.type in {"submit", "reset", "button", "image", "hidden"}
        or control.tag == "button"
    )


def _required_satisfied(page: PageState, control: ControlState) -> bool:
    if control.type == "radio":
        # Спецификация: группа обязательна, если обязателен ЛЮБОЙ её
        # переключатель, и закрывает её любой отмеченный.
        return any(
            peer.checked
            for peer in page.controls
            if peer.type == "radio"
            and peer.name == control.name
            and peer.form_index == control.form_index
        )
    if control.type == "checkbox":
        return control.checked
    if control.type == "file":
        return bool(control.file_path or control.file_paths)
    if control.tag == "select":
        return any(v.strip() for v in control.selected_values)
    return bool(control.value.strip())


def _check_value(control: ControlState) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    value = control.value or ""
    ctype = (control.type or "").lower()
    name = _descriptor(control)

    if not value.strip():
        return issues

    if ctype == "email" and not _EMAIL_RE.match(value.strip()):
        issues.append(ValidationIssue(
            name, "type-email", value, "Value is not a valid email address"
        ))
    if ctype == "url":
        stripped = value.strip()
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://\S+$", stripped):
            issues.append(ValidationIssue(
                name, "type-url", value, "Value is not an absolute URL"
            ))
    if ctype == "number" and _as_number(value) is None:
        issues.append(ValidationIssue(
            name, "type-number", value, "Value is not a number"
        ))

    if control.pattern:
        # Браузер якорит pattern целиком и не даёт ему пройти по куску строки.
        try:
            if not re.fullmatch(control.pattern, value):
                issues.append(ValidationIssue(
                    name, "pattern", value,
                    f"Value does not match pattern {control.pattern}",
                ))
        except re.error:
            # Неверная регулярка на странице — не наша беда: браузер такой
            # pattern тоже игнорирует.
            pass

    if ctype in _LENGTH_TYPES or control.tag == "textarea":
        if control.minlength is not None and 0 < len(value) < control.minlength:
            issues.append(ValidationIssue(
                name, "minlength", value,
                f"Value is shorter than minlength={control.minlength}",
            ))
        if control.maxlength is not None and len(value) > control.maxlength:
            issues.append(ValidationIssue(
                name, "maxlength", value,
                f"Value is longer than maxlength={control.maxlength}",
            ))

    if ctype in _RANGE_TYPES:
        current = _numeric_pair(ctype, value)
        low = _numeric_pair(ctype, control.min_attr) if control.min_attr else None
        high = _numeric_pair(ctype, control.max_attr) if control.max_attr else None
        if current is not None and low is not None and current < low:
            issues.append(ValidationIssue(
                name, "min", value, f"Value is below min={control.min_attr}"
            ))
        if current is not None and high is not None and current > high:
            issues.append(ValidationIssue(
                name, "max", value, f"Value is above max={control.max_attr}"
            ))
        step = _as_number(control.step) if control.step else None
        if current is not None and step and step > 0:
            base = low if low is not None else Decimal(0)
            remainder = (current - base) % step
            if remainder != 0:
                issues.append(ValidationIssue(
                    name, "step", value, f"Value does not fit step={control.step}"
                ))

    return issues


def validate_form(
    page: PageState,
    form: FormState,
    submitter: ControlState | None = None,
) -> list[ValidationIssue]:
    """Что браузер сказал бы об этой форме перед отправкой."""
    if form.novalidate or (submitter is not None and submitter.formnovalidate):
        return []

    issues: list[ValidationIssue] = []
    seen_radio_groups: set[str] = set()

    for index in form.control_indices:
        control = page.controls[index]
        if _skip(control):
            continue

        if control.required:
            if control.type == "radio" and control.name:
                if control.name in seen_radio_groups:
                    continue
                seen_radio_groups.add(control.name)
            if not _required_satisfied(page, control):
                issues.append(ValidationIssue(
                    _descriptor(control), "required", control.value,
                    "Required control has no value",
                    recoverable=False,
                ))
                continue

        issues.extend(_check_value(control))

    return issues
