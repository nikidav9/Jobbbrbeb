"""Подтверждение отправки на SPA: что ответил сервер и что показал сайт.

На одностраничном сайте адрес не меняется, а форма может остаться на месте,
поэтому агенту (agent.py) нечем подтвердить отклик, кроме текста страницы.
Здесь три вещи, которые движок берёт во время отправки:

1. ResponseRecorder — запоминает ответы на POST/PUT к хостам вакансии, к
   поддоменам того же сайта и к известным ATS (ats_hosts): статус, тип
   содержимого и крошечный набор флагов из JSON. Берутся только ключи
   ok/success/status/id/error и производные флаги (result, code, errors,
   результат разбора message/detail, data.id, results у Tilda). Тексты
   сообщений и чужие ключи не сохраняются: там бывают данные человека.
2. classify — из записей выводит api_success / api_error / api_2xx /
   evidence. api_2xx — «сервер ответил 2xx на адрес отправки» без явного
   флага успеха: слабое доказательство (agent: API_2XX, 0.7).
3. toast_text — видимый текст toast, alert, role=status/alert и модалок:
   его добавляют к тексту страницы, и маркеры агента («отклик отправлен»)
   находят подтверждение, которое живёт в исчезающем всплывающем окне.

Модуль ничего не нажимает и не отправляет сам.
"""
from __future__ import annotations

import json
import re
import urllib.parse
from typing import Any

import ats_hosts
from submission import find_success_phrase, normalize_text

SAFE_KEYS = ("ok", "success", "status", "id", "error")
MAX_VALUE = 80
MAX_RECORDS = 20
MAX_BODY = 4096
_METHODS = {"POST", "PUT"}
_OK_STATUS_WORDS = {"ok", "success", "created", "accepted", "sent", "submitted", "done"}
_BAD_STATUS_WORDS = {"error", "fail", "failed", "failure", "rejected", "invalid", "denied"}
# Путь запроса похож на отправку анкеты (а не на аналитику и не на поиск).
_SUBMIT_PATH_RE = re.compile(
    r"apply|applic|respon|vacanc|candidate|lead|form|resume|submit|send|request|"
    r"callback|feedback|career|order|zayav|otklik|procces|queue|fill", re.I)
_NOISE_PATH_RE = re.compile(
    r"metrika|analytics|collect|track|beacon|telemetry|/log(?:s|ging)?(?:/|$|\.)|event|"
    r"/stats?(?:/|$|\.)|ping|csrf|token|captcha|search|suggest|autocomplete|"
    r"/watch(?:/|$)", re.I)
_MSG_ERROR_RE = re.compile(
    r"ошибк|неверн|некорректн|не удалось|заполните|обязательн|неправильн|недопустим|"
    r"invalid|error|fail|incorrect|required|forbidden|denied|wrong", re.I)
_MSG_OK_WORDS = {"ok", "success", "created", "accepted", "sent", "submitted", "done",
                 "успешно", "принято", "отправлено"}

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


def _message_flag(data: dict[str, Any]) -> str | None:
    """'ok' / 'error' по тексту message/detail — сам текст не сохраняется."""
    for key in ("message", "detail"):
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        if _MSG_ERROR_RE.search(value):
            return "error"
        norm = normalize_text(value)
        if norm in _MSG_OK_WORDS or find_success_phrase(norm):
            return "ok"
    return None


def _safe_json(body: str) -> dict[str, Any]:
    """Флаги ответа. Значений полей и сообщений здесь нет (там могут быть
    данные человека): только ключи успеха/ошибки и производные булевы."""
    try:
        data = json.loads(body[:MAX_BODY])
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out = {k: _short(data[k]) for k in SAFE_KEYS if k in data}
    result = data.get("result")
    if isinstance(result, bool):
        out["result"] = result
    elif isinstance(result, str) and result.strip().lower() in _OK_STATUS_WORDS | _BAD_STATUS_WORDS:
        out["result"] = result.strip().lower()
    code = data.get("code")
    if isinstance(code, int) and not isinstance(code, bool):
        out["code"] = code
    elif isinstance(code, str) and code.strip().isdigit():
        out["code"] = int(code.strip())
    errors = data.get("errors")
    if isinstance(errors, (list, dict)) and errors:
        out["errors"] = True
    flag = _message_flag(data)
    if flag:
        out["msg"] = flag
    inner = data.get("data")
    if isinstance(inner, dict) and inner.get("id") not in (None, "", False, 0):
        out["data_id"] = True
    results = data.get("results")  # Tilda: {"message":"OK","results":[{"message":"OK",...}]}
    if isinstance(results, list) and results and all(
        isinstance(r, dict) and str(r.get("message", "")).strip().lower() in _MSG_OK_WORDS
        for r in results
    ):
        out["results_ok"] = True
    return out


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

    def _scope(self, url: str) -> str:
        """primary — хост вакансии; related — поддомен того же сайта или
        известный ATS (Tilda, Bitrix24, amoCRM, Huntflow); пусто — чужой."""
        parts = urllib.parse.urlsplit(url)
        host = (parts.hostname or "").lower()
        if not host:
            return ""
        netloc = parts.netloc.lower()
        if host in self.allowed_hosts or netloc in self.allowed_hosts:
            return "primary"
        if ats_hosts.is_apply_ats(host):
            return "ats"
        for allowed in self.allowed_hosts:
            if ats_hosts.same_site(host, allowed.rsplit(":", 1)[0] if allowed.count(":") == 1 else allowed):
                return "related"
        return ""

    def _on_response(self, response: Any) -> None:
        try:
            request = response.request
            if request.method not in _METHODS:
                return
            scope = self._scope(response.url)
            if not scope:
                return
            path = urllib.parse.urlsplit(response.url).path[:120]
            submit_like = (scope == "ats" or bool(_SUBMIT_PATH_RE.search(path))) and not _NOISE_PATH_RE.search(path)
            # Чужие поддомены и ATS пишем только если это похоже на отправку:
            # иначе сбой чужого счётчика отменил бы настоящее подтверждение.
            if scope != "primary" and not submit_like:
                return
            if len(self.responses) >= MAX_RECORDS:
                return
            ctype = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
            data: dict[str, Any] = {}
            body_empty = False
            if "json" in ctype or ctype in {"", "text/plain"}:
                try:
                    text = response.text()
                    body_empty = not text.strip()
                    data = _safe_json(text) if "json" in ctype else {}
                except Exception:  # тело недоступно (редирект, обрыв)
                    data = {}
            self.responses.append({
                "method": request.method,
                "host_scope": scope,
                "path": path,
                "status": int(response.status),
                "content_type": ctype,
                "submit_like": submit_like,
                "body_empty": body_empty,
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
    if isinstance(status, int) and not isinstance(status, bool) and status >= 400:
        return f"status={status}"
    result = data.get("result")
    if result is False or (isinstance(result, str) and result in _BAD_STATUS_WORDS):
        return "result=false"
    code = data.get("code")
    if isinstance(code, int) and code >= 400:
        return f"code={code}"
    if data.get("errors") is True:
        return "errors"
    if data.get("msg") == "error":
        return "message=error"
    return None


def _has_success(data: dict[str, Any], submit_like: bool = True) -> bool:
    """Флаг успеха в теле. ok/success/status-слова/id верны для любого пути
    (так было всегда); result/code/числовой status/message/data.id/results —
    только если путь похож на отправку: у счётчиков такие ответы тоже бывают."""
    if _truthy(data.get("ok")) or _truthy(data.get("success")):
        return True
    status = data.get("status")
    if isinstance(status, str) and status.strip().lower() in _OK_STATUS_WORDS:
        return True
    if data.get("id") not in (None, "", False, 0):
        return True
    if not submit_like:
        return False
    if data.get("result") is True or data.get("result") in _OK_STATUS_WORDS:
        return True
    code = data.get("code")
    if isinstance(code, int) and (code == 0 or 200 <= code < 300):
        return True
    if isinstance(status, int) and not isinstance(status, bool) and 200 <= status < 300:
        return True
    return bool(data.get("msg") == "ok" or data.get("data_id") or data.get("results_ok"))


def classify(responses: list[dict[str, Any]]) -> dict[str, Any]:
    """{'api_success', 'api_error', 'api_2xx', 'evidence'}. Провал сильнее
    успеха: если хоть один ответ отказал, отклик подтверждённым не считаем."""
    error: str | None = None
    success = False
    twoxx = False
    evidence: list[str] = []
    for item in responses:
        status = int(item.get("status") or 0)
        data = item.get("json") or {}
        label = f"{item.get('method', '')} {item.get('path', '')} {status}".strip()
        # Записи без пометки (старый вид) считаем адресом отправки.
        submit_like = bool(item.get("submit_like", True))
        if status >= 400:
            error = error or f"HTTP {status}" + (f": {data['error']}" if data.get("error") else "")
            evidence.append(f"api_error {label}")
        elif 200 <= status < 300:
            bad = _has_error(data)
            if bad:
                error = error or bad
                evidence.append(f"api_error {label} {bad}")
            elif _has_success(data, submit_like):
                success = True
                evidence.append(f"api_success {label}")
            elif item.get("submit_like") and (
                status in (201, 202, 204) or item.get("body_empty")
                or "json" in str(item.get("content_type") or "")
                or item.get("content_type") == "text/plain"
            ):
                twoxx = True
                evidence.append(f"api_2xx {label}")
    if error:
        success = False
        twoxx = False
    return {"api_success": success, "api_error": error, "api_2xx": twoxx, "evidence": evidence}


def toast_text(page: Any) -> str:
    """Видимые всплывающие сообщения одной строкой (пусто, если нет)."""
    try:
        items = page.evaluate(TOAST_JS)
    except Exception:
        return ""
    return " | ".join(items)
