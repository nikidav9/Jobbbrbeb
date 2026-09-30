"""Подтверждение отправки на SPA: что ответил сервер и что показал сайт.

На одностраничном сайте адрес не меняется, а форма может остаться на месте,
поэтому агенту (agent.py) нечем подтвердить отклик, кроме текста страницы.
Здесь три вещи, которые движок берёт во время отправки:

1. ResponseRecorder — запоминает ответы на POST/PUT к хостам вакансии:
   статус, тип содержимого и крошечный JSON. Из тела берутся только ключи
   ok/success/status/id/error/message-подобные; значения обрезаются. ПДн
   (имя, телефон, почта) сюда не попадают: чужие ключи отбрасываются.
2. classify — из записей выводит api_success / api_error / evidence.
3. toast_text — видимый текст toast, alert, role=status/alert и модалок:
   его добавляют к тексту страницы, и маркеры агента («отклик отправлен»)
   находят подтверждение, которое живёт в исчезающем всплывающем окне.

Модуль ничего не нажимает и не отправляет сам.
"""
from __future__ import annotations

import json
import urllib.parse
from typing import Any

SAFE_KEYS = ("ok", "success", "status", "id", "error")
MAX_VALUE = 80
MAX_RECORDS = 20
MAX_BODY = 4096
_METHODS = {"POST", "PUT"}
_OK_STATUS_WORDS = {"ok", "success", "created", "accepted", "sent", "submitted", "done"}
_BAD_STATUS_WORDS = {"error", "fail", "failed", "failure", "rejected", "invalid", "denied"}

TOAST_JS = """() => {
  const sel = '[role=status],[role=alert],[role=alertdialog],[role=dialog],dialog[open],' +
    '[aria-live=polite],[aria-live=assertive],[class*=toast i],[class*=snack i],' +
    '[class*=notif i],[class*=modal i],[class*=alert i]';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) continue;
    if (r.width < 1 || r.height < 1) continue;
    const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    if (t && !out.includes(t)) out.push(t.slice(0, 300));
    if (out.length >= 8) break;
  }
  return out;
}"""


def _short(value: Any) -> Any:
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    if isinstance(value, (dict, list)):
        # error бывает объектом: берём только его текстовое лицо.
        text = json.dumps(value, ensure_ascii=False)
    else:
        text = str(value)
    return text[:MAX_VALUE]


def _safe_json(body: str) -> dict[str, Any]:
    try:
        data = json.loads(body[:MAX_BODY])
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: _short(data[k]) for k in SAFE_KEYS if k in data}


class ResponseRecorder:
    """Подписка на ответы страницы. Использование: start(page) ... stop()."""

    def __init__(self, allowed_hosts: set[str]):
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        self.responses: list[dict[str, Any]] = []
        self._page: Any = None

    def start(self, page: Any) -> "ResponseRecorder":
        self._page = page
        page.on("response", self._on_response)
        return self

    def stop(self) -> list[dict[str, Any]]:
        if self._page is not None:
            try:
                self._page.remove_listener("response", self._on_response)
            except Exception:  # страница уже закрыта
                pass
            self._page = None
        return self.responses

    def __enter__(self) -> "ResponseRecorder":
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()

    def _host_ok(self, url: str) -> bool:
        parts = urllib.parse.urlsplit(url)
        host = (parts.hostname or "").lower()
        if not host:
            return False
        netloc = parts.netloc.lower()
        return host in self.allowed_hosts or netloc in self.allowed_hosts

    def _on_response(self, response: Any) -> None:
        try:
            request = response.request
            if request.method not in _METHODS or not self._host_ok(response.url):
                return
            if len(self.responses) >= MAX_RECORDS:
                return
            ctype = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
            data: dict[str, Any] = {}
            if "json" in ctype:
                try:
                    data = _safe_json(response.text())
                except Exception:  # тело недоступно (редирект, обрыв)
                    data = {}
            self.responses.append({
                "method": request.method,
                "path": urllib.parse.urlsplit(response.url).path[:120],
                "status": int(response.status),
                "content_type": ctype,
                "json": data,
            })
        except Exception:  # запись — best effort, отправку не ломаем
            return


def _truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "ok"}
    return value is True or value == 1


def _has_error(data: dict[str, Any]) -> str | None:
    if "error" in data and data["error"] not in (None, False, "", 0):
        return str(data["error"])[:MAX_VALUE]
    if "ok" in data and not _truthy(data["ok"]):
        return "ok=false"
    if "success" in data and not _truthy(data["success"]):
        return "success=false"
    status = data.get("status")
    if isinstance(status, str) and status.strip().lower() in _BAD_STATUS_WORDS:
        return f"status={status.strip().lower()}"
    return None


def _has_success(data: dict[str, Any]) -> bool:
    if _truthy(data.get("ok")) or _truthy(data.get("success")):
        return True
    status = data.get("status")
    if isinstance(status, str) and status.strip().lower() in _OK_STATUS_WORDS:
        return True
    return data.get("id") not in (None, "", False, 0)


def classify(responses: list[dict[str, Any]]) -> dict[str, Any]:
    """{'api_success', 'api_error', 'evidence'}. Провал сильнее успеха:
    если хоть один ответ отказал, отклик подтверждённым не считаем."""
    error: str | None = None
    success = False
    evidence: list[str] = []
    for item in responses:
        status = int(item.get("status") or 0)
        data = item.get("json") or {}
        label = f"{item.get('method', '')} {item.get('path', '')} {status}".strip()
        if status >= 400:
            error = error or f"HTTP {status}" + (f": {data['error']}" if data.get("error") else "")
            evidence.append(f"api_error {label}")
        elif 200 <= status < 300:
            bad = _has_error(data)
            if bad:
                error = error or bad
                evidence.append(f"api_error {label} {bad}")
            elif _has_success(data):
                success = True
                evidence.append(f"api_success {label}")
    if error:
        success = False
    return {"api_success": success, "api_error": error, "evidence": evidence}


def toast_text(page: Any) -> str:
    """Видимые всплывающие сообщения одной строкой (пусто, если нет)."""
    try:
        items = page.evaluate(TOAST_JS)
    except Exception:
        return ""
    return " | ".join(items)
