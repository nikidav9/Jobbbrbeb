#!/usr/bin/env python3
"""Клиент YandexGPT (Yandex Cloud Foundation Models, completion API).

152-ФЗ: данные кандидата во внешний сервис не уходят. Любой текст перед
отправкой проходит redact(); complete_json() вызывает его сам и обходить нельзя.
В лог пишется только факт вызова, код ответа и время — без текста запроса и ответа.
Лимиты: таймаут 10 с, один повтор при 429/5xx, бюджет вызовов на процесс
(YANDEX_GPT_MAX_CALLS_PER_HOUR, по умолчанию 200); сверх бюджета — пустой ответ
без запроса. Только stdlib.
"""
from __future__ import annotations

import collections
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Iterable

DEFAULT_BASE_URL = "https://llm.api.cloud.yandex.net"
COMPLETION_PATH = "/foundationModels/v1/completion"
MAX_PROMPT_CHARS = 12000
DEFAULT_TIMEOUT = 10.0
DEFAULT_MAX_CALLS_PER_HOUR = 200
RETRY_PAUSE = 1.0

log = logging.getLogger("jupiter.yandex_gpt")

# Ссылка с параметрами или якорем: в них бывают токены, почта, id кандидата.
_URL_PARAMS_RE = re.compile(r"(?:https?://|www\.)[^\s?#]*[?#]\S*", re.IGNORECASE)
# Левая граница: без неё поиск квадратичен на длинных словах.
_EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE_RE = re.compile(r"(?<![\w])\+?\d[\d\s().-]{8,}\d(?![\w])")
# Числа длиннее 5 цифр: ИНН, СНИЛС, паспорт, номера счетов.
_LONG_NUMBER_RE = re.compile(r"\d{6,}")
# ФИО: два-три слова с заглавной (Иван Петров, Иванов Иван Иванович, Ivan Petrov)
# и фамилия с инициалами (Петров И. И., И.И. Петров).
_FIO_CYR_RE = re.compile(r"\b[А-ЯЁ][а-яё]+(?:[ \t]+[А-ЯЁ][а-яё]+){1,2}\b")
_FIO_LAT_RE = re.compile(r"\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,2}\b")
_INITIALS_RE = re.compile(
    r"\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?(?:[А-ЯЁ]\.?)?|\b[А-ЯЁ]\.\s?(?:[А-ЯЁ]\.\s?)?[А-ЯЁ][а-яё]+\b")
# Слова анкеты: «Фамилия Имя Отчество», «First Name» — это подписи, а не ФИО.
_FORM_WORDS = frozenset("""
фамилия имя отчество телефон почта город дата рождения адрес резюме сопроводительное
письмо зарплата должность компания страна гражданство опыт образование ссылка файл
электронная контактный мобильный ваш ваше ваша полное желаемая ожидаемая текущая
first last middle full name phone mobile email mail address city country date birth
resume cv cover letter salary position company current expected your linkedin github
portfolio website zip postal code street number upload file citizenship experience
""".split())


def _is_form_word(word: str) -> bool:
    # «телефона», «почты» — падежные окончания до двух букв; «Городецкий» не подпись.
    return any(word.startswith(s) and len(word) - len(s) <= 2 for s in _FORM_WORDS)


def _keep_form_words(regex: re.Pattern, placeholder: str, text: str) -> str:
    def sub(m: re.Match) -> str:
        words = m.group(0).lower().split()
        return m.group(0) if any(_is_form_word(w) for w in words) else placeholder
    return regex.sub(sub, text)


class YandexGPTError(Exception):
    """Базовая ошибка клиента."""


class YandexGPTTransportError(YandexGPTError):
    """Сеть, таймаут, HTTP-ошибка."""


class YandexGPTResponseError(YandexGPTError):
    """Ответ не удалось разобрать как ожидаемый JSON."""


def redact(text: str, secrets: Iterable[str] = ()) -> str:
    """Вычёркивает значения профиля, ссылки с параметрами, email, телефоны,
    длинные числа и ФИО-подобные строки."""
    out = text or ""
    for s in sorted({str(v).strip() for v in secrets if v}, key=len, reverse=True):
        if len(s) >= 2:
            out = re.sub(re.escape(s), "[скрыто]", out, flags=re.IGNORECASE)
    out = _URL_PARAMS_RE.sub("[ссылка]", out)
    out = _EMAIL_RE.sub("[email]", out)
    out = _PHONE_RE.sub("[телефон]", out)
    out = _LONG_NUMBER_RE.sub("[число]", out)
    out = _INITIALS_RE.sub("[ФИО]", out)
    out = _keep_form_words(_FIO_CYR_RE, "[ФИО]", out)
    out = _keep_form_words(_FIO_LAT_RE, "[ФИО]", out)
    return out


class _Budget:
    """Скользящее окно в час на весь процесс. Лимит читается из окружения на каждом вызове."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stamps: collections.deque[float] = collections.deque()

    @staticmethod
    def limit() -> int:
        raw = os.environ.get("YANDEX_GPT_MAX_CALLS_PER_HOUR", "").strip()
        try:
            return max(0, int(raw)) if raw else DEFAULT_MAX_CALLS_PER_HOUR
        except ValueError:
            return DEFAULT_MAX_CALLS_PER_HOUR

    def take(self) -> bool:
        now = time.monotonic()
        with self._lock:
            while self._stamps and now - self._stamps[0] >= 3600:
                self._stamps.popleft()
            if len(self._stamps) >= self.limit():
                return False
            self._stamps.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._stamps.clear()


BUDGET = _Budget()


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


class _BudgetExhausted(Exception):
    pass


class YandexGPT:
    def __init__(self, api_key: str, folder_id: str, *, model: str = "yandexgpt-lite",
                 base_url: str = DEFAULT_BASE_URL, secrets: Iterable[str] = (),
                 temperature: float = 0.0, max_tokens: int = 1000,
                 retry_pause: float = RETRY_PAUSE):
        self.api_key = api_key
        self.folder_id = folder_id
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.secrets = [s for s in secrets if s]
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.retry_pause = retry_pause

    @classmethod
    def from_env(cls, **kw) -> "YandexGPT | None":
        key = os.environ.get("YANDEX_GPT_API_KEY", "").strip()
        folder = os.environ.get("YANDEX_GPT_FOLDER_ID", "").strip()
        if not key or not folder:
            return None
        return cls(key, folder, **kw)

    def _prepare(self, text: str) -> str:
        return redact(text, self.secrets)[:MAX_PROMPT_CHARS]

    def _post(self, body: bytes, timeout: float) -> dict:
        """Один HTTP-запрос из бюджета. Лог — только код и время."""
        if not BUDGET.take():
            log.warning("YandexGPT: бюджет вызовов на час исчерпан, запрос не отправлен")
            raise _BudgetExhausted()
        req = urllib.request.Request(
            self.base_url + COMPLETION_PATH, data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Api-Key {self.api_key}",
                     "x-folder-id": self.folder_id},
            method="POST")
        started = time.monotonic()
        status = "сеть"
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = str(resp.status)
                raw = resp.read()
        except urllib.error.HTTPError as e:
            status = str(e.code)
            raise
        finally:
            log.info("YandexGPT: вызов, статус %s, %.2f с", status, time.monotonic() - started)
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError as e:
            raise YandexGPTResponseError(f"ответ не JSON: {e}") from None

    def _call(self, system: str, user: str, timeout: float) -> str:
        body = json.dumps({
            "modelUri": f"gpt://{self.folder_id}/{self.model}/latest",
            "completionOptions": {"stream": False, "temperature": self.temperature,
                                  "maxTokens": str(self.max_tokens)},
            "messages": [{"role": "system", "text": system},
                         {"role": "user", "text": user}],
        }).encode("utf-8")
        for attempt in (1, 2):
            try:
                payload = self._post(body, timeout)
                break
            except urllib.error.HTTPError as e:
                if attempt == 1 and (e.code == 429 or e.code >= 500):
                    time.sleep(self.retry_pause)
                    continue
                raise YandexGPTTransportError(f"HTTP {e.code}") from None
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                raise YandexGPTTransportError(f"сеть/таймаут: {type(e).__name__}") from None
        try:
            return payload["result"]["alternatives"][0]["message"]["text"]
        except (KeyError, IndexError, TypeError):
            raise YandexGPTResponseError("неожиданная структура ответа") from None

    def complete_json(self, system: str, user: str, schema_hint: str = "",
                      timeout: float = DEFAULT_TIMEOUT) -> dict:
        """Просит строго JSON; одна повторная попытка, если пришёл мусор.

        Бюджет исчерпан — пустой dict без запроса.
        """
        sys_p = self._prepare(system)
        if schema_hint:
            sys_p += "\nОтвечай строго одним JSON-объектом без пояснений. Схема: " + schema_hint
        usr_p = self._prepare(user)
        try:
            try:
                return _extract_json(self._call(sys_p, usr_p, timeout))
            except YandexGPTResponseError:
                retry = sys_p + "\nПредыдущий ответ не был валидным JSON. Верни ТОЛЬКО JSON-объект."
                return _extract_json(self._call(retry, usr_p, timeout))
        except _BudgetExhausted:
            return {}
