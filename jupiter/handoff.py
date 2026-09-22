#!/usr/bin/env python3
"""Передача шага человеку — так, чтобы можно было продолжить.

Раньше Jupiter на CAPTCHA, входе или незнакомом обязательном вопросе просто
останавливался. Для продукта этого мало: человек, решивший капчу в своём
браузере, ничем нам не помог — сессия-то была наша.

Поэтому остановка теперь оставляет после себя две вещи: понятную просьбу и
состояние, из которого прогон продолжается. Токен возврата — единственное,
что нужно знать, чтобы вернуться ровно на тот же шаг.

Что здесь НЕ делается: капча не обходится, MFA не обходится, пароли
работодателя не хранятся. Мы только не теряем контекст, пока человек делает
то, что должен сделать сам.
"""
from __future__ import annotations

import json
import secrets
import time
# field импортируется под своим именем: у HumanActionRequest есть
# атрибут field, и внутри класса он перекрывает dataclasses.field.
from dataclasses import dataclass, field as dc_field
from pathlib import Path
from typing import Any


class HumanAction:
    CAPTCHA = "CAPTCHA"
    OTP_EMAIL = "OTP_EMAIL"
    OTP_PHONE = "OTP_PHONE"
    LOGIN = "LOGIN"
    CONSENT = "CONSENT"
    UNKNOWN_FIELD = "UNKNOWN_FIELD"
    LEGAL_CONFIRMATION = "LEGAL_CONFIRMATION"


@dataclass
class HumanActionRequest:
    type: str
    prompt: str
    page_url: str
    resume_token: str
    field: str | None = None
    created_at: float = dc_field(default_factory=time.time)

    def as_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "prompt": self.prompt,
            "page_url": self.page_url,
            "resume_token": self.resume_token,
            "field": self.field,
            "created_at": self.created_at,
        }


@dataclass
class ResumeState:
    """Ровно то, без чего продолжить нельзя.

    Куки здесь — данные сессии работодателя, а не кандидата, и живут они
    недолго: до конца задачи. Хранить их дольше незачем и опасно.
    """

    token: str
    page_url: str
    allowed_hosts: list[str]
    dry_run: bool
    cookies: list[dict[str, str]] = dc_field(default_factory=list)
    request: dict[str, Any] | None = None
    created_at: float = dc_field(default_factory=time.time)

    def as_dict(self) -> dict[str, Any]:
        return {
            "token": self.token,
            "page_url": self.page_url,
            "allowed_hosts": list(self.allowed_hosts),
            "dry_run": self.dry_run,
            "cookies": list(self.cookies),
            "request": self.request,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ResumeState":
        return cls(
            token=str(raw.get("token", "")),
            page_url=str(raw.get("page_url", "")),
            allowed_hosts=[str(h) for h in raw.get("allowed_hosts", [])],
            dry_run=bool(raw.get("dry_run", False)),
            cookies=[dict(c) for c in raw.get("cookies", [])],
            request=raw.get("request"),
            created_at=float(raw.get("created_at", 0) or 0),
        )


def new_token() -> str:
    return secrets.token_urlsafe(24)


class HandoffStore:
    """Хранилище состояний возврата. Файл или память — как у журнала чеков."""

    # Сессия работодателя протухает сама, и держать её дольше суток смысла
    # нет: человек либо вернулся, либо задача устарела.
    TTL_SECONDS = 24 * 3600

    def __init__(self, path: str | None = None):
        self.path = Path(path) if path else None
        self._items: dict[str, ResumeState] = {}
        if self.path and self.path.is_file():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                raw = {}
            for token, item in (raw or {}).items():
                if isinstance(item, dict):
                    self._items[token] = ResumeState.from_dict(item)

    def _alive(self, state: ResumeState) -> bool:
        return (time.time() - state.created_at) <= self.TTL_SECONDS

    def save(self, state: ResumeState) -> None:
        self._items[state.token] = state
        self._flush()

    def load(self, token: str) -> ResumeState | None:
        state = self._items.get(token)
        if state is None:
            return None
        if not self._alive(state):
            self.drop(token)
            return None
        return state

    def drop(self, token: str) -> None:
        self._items.pop(token, None)
        self._flush()

    def _flush(self) -> None:
        if not self.path:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            alive = {
                token: state.as_dict()
                for token, state in self._items.items()
                if self._alive(state)
            }
            self.path.write_text(
                json.dumps(alive, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError:
            pass
