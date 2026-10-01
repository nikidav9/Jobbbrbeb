"""База знаний Алисы (YandexGPT) о сайтах откликов (01.10.2026, решение владельца).

Раньше Алиса на каждом сайте разбиралась с нуля: где кнопка отклика, какое поле
чему соответствует, как пояснить вопрос анкеты. Здесь то, что сработало,
запоминается по сайту (хост вакансии) и между запусками:

- apply — текст кнопки, открывшей анкету;
- fields — подпись поля → ключ профиля кандидата;
- questions — ключ вопроса → понятная формулировка и пояснение.

Юпитер сначала берёт знание из базы, Алису спрашивает только о новом. Знания с
разных сайтов — ещё и примеры в подсказках Алисе: многие компании работают на
одних и тех же системах откликов, и выученное на одной помогает на другой.

Кто чему верит (решение владельца):
- ночная разведка пользуется всем, что есть, и сама пополняет базу;
- настоящие отклики — только знанием, которое ночная репетиция подтвердила
  (дошла с ним до «Отправить», сайт принял бы анкету) не старше
  CONFIRM_MAX_AGE_DAYS; иначе — как раньше, Алиса напрямую.
Сломалось (знание было, а до анкеты не дошли) — подтверждение снимается,
кнопка забывается и выучивается заново.

Только устройство страниц работодателей (подписи, тексты кнопок, через
redact()) и названия ключей профиля. Данных кандидатов здесь нет (152-ФЗ).
Файл публичный: /jupiter-knowledge.json. Только stdlib.
"""
from __future__ import annotations

import calendar
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable

from yandex_gpt import redact

VERSION = 1
ENV = "JUPITER_KNOWLEDGE_FILE"
DEFAULT_FILE = "/var/www/html/jupiter-knowledge.json"
CONFIRM_MAX_AGE_DAYS = 3
# Пример для подсказки — подпись, сопоставленная с ключом на стольких сайтах.
MIN_SITES_FOR_EXAMPLE = 2
MAX_EXAMPLES = 12
MAX_SITE_FIELDS = 80
MAX_SITE_QUESTIONS = 40
# Классы итога, при которых знание сайта не сработало (до анкеты не дошли).
FAILED_CLASSES = ("no_vacancy", "form_unmapped")


def norm(text: Any, limit: int = 80) -> str:
    return " ".join(redact(str(text or "")).lower().split())[:limit]


def field_sig(f: dict) -> str:
    """Подпись поля без значений: подпись|подсказка|имя|тип. Пустая — не запоминаем."""
    parts = [norm(f.get(k)) for k in ("label", "placeholder", "name")] + [norm(f.get("type"), 20)]
    return "|".join(parts) if any(parts[:3]) else ""


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def _ts(value: Any) -> float | None:
    try:
        return float(calendar.timegm(time.strptime(str(value), "%Y-%m-%dT%H:%M:%SZ")))
    except (ValueError, OverflowError):
        return None


class Knowledge:
    def __init__(self, data: dict | None = None) -> None:
        data = data if isinstance(data, dict) else {}
        sites = data.get("sites")
        self.sites: dict[str, dict] = {h: s for h, s in (sites or {}).items()
                                       if isinstance(h, str) and isinstance(s, dict)} \
            if isinstance(sites, dict) else {}
        self._lock = threading.Lock()

    @classmethod
    def load(cls, path: str | None = None) -> "Knowledge":
        path = path or os.environ.get(ENV) or DEFAULT_FILE
        try:
            return cls(json.loads(Path(path).read_text(encoding="utf-8")))
        except (OSError, ValueError):
            return cls()

    # ── чтение ───────────────────────────────────────────────────────────

    def site(self, host: str, *, live: bool = False, now: float | None = None) -> dict:
        """Знание сайта; для настоящих откликов — только свежее подтверждённое."""
        entry = self.sites.get((host or "").lower()) or {}
        if not live:
            return entry
        confirmed = _ts(entry.get("confirmed_at"))
        now = time.time() if now is None else now
        if confirmed is None or now - confirmed > CONFIRM_MAX_AGE_DAYS * 86400:
            return {}
        return entry

    def examples(self) -> dict[str, list]:
        """Проверенное на разных сайтах — примеры для подсказок Алисе."""
        votes: dict[tuple[str, str], set[str]] = {}
        buttons: dict[str, set[str]] = {}
        for host, entry in self.sites.items():
            for sig, key in (entry.get("fields") or {}).items():
                votes.setdefault((sig, key), set()).add(host)
            if entry.get("apply"):
                buttons.setdefault(entry["apply"], set()).add(host)
        fields = []
        for (sig, key), hosts in sorted(votes.items(), key=lambda kv: -len(kv[1])):
            if len(hosts) < MIN_SITES_FOR_EXAMPLE:
                break
            label, placeholder, name, ftype = (sig.split("|") + ["", "", "", ""])[:4]
            fields.append({k: v for k, v in (("label", label), ("placeholder", placeholder),
                                             ("name", name), ("type", ftype), ("key", key)) if v})
            if len(fields) >= MAX_EXAMPLES:
                break
        apply = [t for t, _ in sorted(buttons.items(), key=lambda kv: -len(kv[1]))][:MAX_EXAMPLES]
        return {"fields": fields, "apply": apply}

    # ── обучение (только ночная разведка) ───────────────────────────────

    def learn(self, host: str, learned: dict | None, *, used: bool, klass: str,
              verdict: str = "", now: float | None = None) -> None:
        host = (host or "").lower()
        if not host:
            return
        now = time.time() if now is None else now
        learned = learned if isinstance(learned, dict) else {}
        with self._lock:
            entry = self.sites.setdefault(host, {})
            changed = False
            if isinstance(learned.get("apply"), str) and learned["apply"]:
                entry["apply"] = norm(learned["apply"], 60)
                changed = True
            for name, limit in (("fields", MAX_SITE_FIELDS), ("questions", MAX_SITE_QUESTIONS)):
                got = learned.get(name)
                if isinstance(got, dict) and got:
                    merged = dict(entry.get(name) or {})
                    merged.update(got)
                    entry[name] = dict(list(merged.items())[-limit:])
                    changed = True
            if changed:
                entry["learned_at"] = _iso(now)
            if verdict == "would_send":
                entry["confirmed_at"] = _iso(now)
                entry.pop("broken_at", None)
            elif used and klass in FAILED_CLASSES:
                # Знание было, а до анкеты не дошли: сайт изменился.
                entry.pop("confirmed_at", None)
                entry.pop("apply", None)
                entry["broken_at"] = _iso(now)
            entry["checked_at"] = _iso(now)
            if not any(k in entry for k in ("apply", "fields", "questions", "broken_at")):
                self.sites.pop(host, None)

    def summary(self, now: float | None = None) -> dict[str, int]:
        now = time.time() if now is None else now
        return {
            "sites": len(self.sites),
            "confirmed": sum(1 for h in self.sites if self.site(h, live=True, now=now)),
            "broken": sum(1 for s in self.sites.values() if s.get("broken_at")),
            "with_apply": sum(1 for s in self.sites.values() if s.get("apply")),
            "fields": sum(len(s.get("fields") or {}) for s in self.sites.values()),
            "questions": sum(len(s.get("questions") or {}) for s in self.sites.values()),
        }

    def save(self, path: str) -> None:
        with self._lock:
            data = {"version": VERSION, "updated_at": _iso(time.time()),
                    "summary": self.summary(), "sites": dict(sorted(self.sites.items()))}
        target = Path(path)
        fd, tmp = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=str(target.parent or "."))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=1)
            os.chmod(tmp, 0o644)
            os.replace(tmp, target)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


class CountingLLM:
    """Обёртка клиента: считает вызовы и не пускает сверх max_calls в сутки."""

    def __init__(self, llm: Any, max_calls: int | None = None) -> None:
        self.llm, self.max_calls = llm, max_calls
        self.calls = 0
        self._day = time.strftime("%Y-%m-%d", time.gmtime())
        self._lock = threading.Lock()

    def complete_json(self, *args: Any, **kw: Any) -> Any:
        with self._lock:
            day = time.strftime("%Y-%m-%d", time.gmtime())
            if day != self._day:
                self._day, self.calls = day, 0
            if self.max_calls is not None and self.calls >= self.max_calls:
                raise RuntimeError("дневной потолок вызовов YandexGPT")
            self.calls += 1
        return self.llm.complete_json(*args, **kw)


class Advisor:
    """Сначала база, Алиса — только о новом. Выученное копится в learned."""

    def __init__(self, kb: Knowledge, host: str, llm: Any = None, *, live: bool = False) -> None:
        import browser_planner
        self.planner = browser_planner
        self.kb, self.llm, self.live = kb, llm, live
        self.host = (host or "").lower()
        self.entry = kb.site(self.host, live=live)
        self.examples = kb.examples() if llm is not None else {"fields": [], "apply": []}
        self.used = False
        self.learned: dict[str, Any] = {"apply": "", "fields": {}, "questions": {}}

    def apply(self, outline: dict) -> str | None:
        known = self.entry.get("apply")
        if known:
            for c in outline.get("clickables", []):
                if isinstance(c, dict) and c.get("jt") and norm(c.get("text"), 60) == known \
                        and not self.planner._FORBIDDEN_RE.search(str(c.get("text") or "")):
                    self.used = True
                    return c["jt"]
        if self.llm is None:
            return None
        mark = self.planner.suggest_apply_click(self.llm, outline, examples=self.examples["apply"])
        if mark:
            text = next((c.get("text") for c in outline.get("clickables", []) if c.get("jt") == mark), "")
            self.learned["apply"] = norm(text, 60)
        return mark

    def fields(self, fields: list[dict], allowed_keys: list[str]) -> dict[str, str]:
        allowed = set(allowed_keys or ())
        known = self.entry.get("fields") or {}
        out: dict[str, str] = {}
        rest: list[dict] = []
        sigs: dict[str, str] = {}
        for f in fields or []:
            ref = self.planner._field_id(f) if isinstance(f, dict) else None
            if not ref:
                continue
            sig = field_sig(f)
            sigs[ref] = sig
            if sig and known.get(sig) in allowed:
                out[ref] = known[sig]
                self.used = True
            else:
                rest.append(f)
        if rest and self.llm is not None:
            got = self.planner.suggest_field_keys(self.llm, rest, list(allowed_keys or ()), self.host,
                                                  examples=self.examples["fields"])
            for ref, key in got.items():
                out[ref] = key
                if sigs.get(ref):
                    self.learned["fields"][sigs[ref]] = key
        return out

    def judge(self, summary: dict, secrets: list[str]) -> dict | None:
        """Исход отправки по странице — только модель, в базу не пишется:
        у каждой отправки он свой."""
        if self.llm is None:
            return None
        return self.planner.judge_outcome(self.llm, summary, secrets)

    def questions(self, questions: list[dict], context: dict) -> dict[str, dict[str, str]]:
        known = self.entry.get("questions") or {}
        out: dict[str, dict[str, str]] = {}
        rest = []
        for q in questions or []:
            key = q.get("key") if isinstance(q, dict) else None
            if key and isinstance(known.get(key), dict):
                out[key] = dict(known[key])
                self.used = True
            elif key:
                rest.append(q)
        if rest and self.llm is not None:
            got = self.planner.explain_questions(self.llm, rest, context)
            out.update(got)
            self.learned["questions"].update(got)
        return out


def advisor_hooks(advisor: Advisor) -> dict[str, Callable]:
    """apply_advisor для движка, field_mapper, question_explainer и
    outcome_judge для агента."""
    return {"apply_advisor": advisor.apply, "field_mapper": advisor.fields,
            "question_explainer": advisor.questions, "outcome_judge": advisor.judge}

