#!/usr/bin/env python3
"""Клиент YandexGPT (Yandex Cloud Foundation Models, completion API).

152-ФЗ: данные кандидата во внешний сервис не уходят. Любой текст перед
отправкой проходит redact(); complete_json() вызывает его сам и обходить нельзя.
Только stdlib.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Iterable

DEFAULT_BASE_URL = "https://llm.api.cloud.yandex.net"
COMPLETION_PATH = "/foundationModels/v1/completion"
MAX_PROMPT_CHARS = 12000

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE_RE = re.compile(r"(?<![\w])\+?\d[\d\s().-]{8,}\d(?![\w])")
# Три подряд слова с заглавной кириллицей (Иванов Иван Иванович).
_FIO_RE = re.compile(r"\b[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){2}\b")


class YandexGPTError(Exception):
    """Базовая ошибка клиента."""


class YandexGPTTransportError(YandexGPTError):
    """Сеть, таймаут, HTTP-ошибка."""


class YandexGPTResponseError(YandexGPTError):
    """Ответ не удалось разобрать как ожидаемый JSON."""


def redact(text: str, secrets: Iterable[str] = ()) -> str:
    """Вычёркивает значения профиля, email, телефоны и ФИО-подобные строки."""
    out = text or ""
    for s in sorted({str(v).strip() for v in secrets if v}, key=len, reverse=True):
        if len(s) >= 2:
            out = re.sub(re.escape(s), "[скрыто]", out, flags=re.IGNORECASE)
    out = _EMAIL_RE.sub("[email]", out)
    out = _PHONE_RE.sub("[телефон]", out)
    out = _FIO_RE.sub("[ФИО]", out)
    return out


def _extract_json(text: str) -> dict:
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.DOTALL)
    if m:
        t = m.group(1)
    try:
        data = json.loads(t)
    except ValueError:
        a, b = t.find("{"), t.rfind("}")
        if a < 0 or b <= a:
            raise YandexGPTResponseError("в ответе нет JSON")
        try:
            data = json.loads(t[a:b + 1])
        except ValueError as e:
            raise YandexGPTResponseError(f"невалидный JSON: {e}")
    if not isinstance(data, dict):
        raise YandexGPTResponseError("ожидался JSON-объект")
    return data


class YandexGPT:
    def __init__(self, api_key: str, folder_id: str, *, model: str = "yandexgpt-lite",
                 base_url: str = DEFAULT_BASE_URL, secrets: Iterable[str] = (),
                 temperature: float = 0.1, max_tokens: int = 1000):
        self.api_key = api_key
        self.folder_id = folder_id
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.secrets = [s for s in secrets if s]
        self.temperature = temperature
        self.max_tokens = max_tokens

    @classmethod
    def from_env(cls, **kw) -> "YandexGPT | None":
        key = os.environ.get("YANDEX_GPT_API_KEY", "").strip()
        folder = os.environ.get("YANDEX_GPT_FOLDER_ID", "").strip()
        if not key or not folder:
            return None
        return cls(key, folder, **kw)

    def _prepare(self, text: str) -> str:
        return redact(text, self.secrets)[:MAX_PROMPT_CHARS]

    def _call(self, system: str, user: str, timeout: float) -> str:
        body = {
            "modelUri": f"gpt://{self.folder_id}/{self.model}/latest",
            "completionOptions": {"stream": False, "temperature": self.temperature,
                                  "maxTokens": str(self.max_tokens)},
            "messages": [{"role": "system", "text": system},
                         {"role": "user", "text": user}],
        }
        req = urllib.request.Request(
            self.base_url + COMPLETION_PATH,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Api-Key {self.api_key}",
                     "x-folder-id": self.folder_id},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise YandexGPTTransportError(f"HTTP {e.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise YandexGPTTransportError(f"сеть/таймаут: {e}") from None
        except ValueError as e:
            raise YandexGPTResponseError(f"ответ не JSON: {e}") from None
        try:
            return payload["result"]["alternatives"][0]["message"]["text"]
        except (KeyError, IndexError, TypeError):
            raise YandexGPTResponseError("неожиданная структура ответа") from None

    def complete_json(self, system: str, user: str, schema_hint: str = "",
                      timeout: float = 20) -> dict:
        """Просит строго JSON; одна повторная попытка, если пришёл мусор."""
        sys_p = self._prepare(system)
        if schema_hint:
            sys_p += "\nОтвечай строго одним JSON-объектом без пояснений. Схема: " + schema_hint
        usr_p = self._prepare(user)
        try:
            return _extract_json(self._call(sys_p, usr_p, timeout))
        except YandexGPTResponseError:
            retry = sys_p + "\nПредыдущий ответ не был валидным JSON. Верни ТОЛЬКО JSON-объект."
            return _extract_json(self._call(retry, usr_p, timeout))
