#!/usr/bin/env python3
"""Точка входа: крутит worker.run_once на серверной очереди.

    JOBTOO_URL=https://example.com \
    JOBTOO_ADMIN_TOKEN=secret \
    python3 run_worker.py

Профиль кандидата достаётся из базы по user_id задачи, а не из файла:
у каждой задачи свой кандидат, и данные берутся из его загруженного резюме.

Останавливается по SIGTERM / SIGINT (текущий прогон доводится до конца).
Только stdlib — как и весь Jupiter.
"""
from __future__ import annotations

import inspect
import logging
import os
import signal
import socket
import sys
import time

from agent import AgentResult, CandidateProfile, JupiterAgent, Reason
from handoff import HandoffStore
from remote_tasks import RemoteTaskQueue
from site_compat import AUDITED_SITES, live_ready, normalize_host, recon_ok_hosts
from submission import ReceiptStore
from tasks import ApplicationTask, SubmissionAuthorizationRevoked
import browser_engine
import browser_limits
import knowledge
import worker
import yandex_gpt

log = logging.getLogger("jupiter")

DELEGATED_CONSENTS = (
    "personal_data_consent", "privacy_consent", "terms_consent",
    "data_accuracy_confirmation",
)
# Раз в столько секунд воркер снимает с паузы отклики на сайты, которые
# разведка успела подключить (SITE_NOT_VERIFIED → queued).
REQUEUE_EVERY = 3600
# Сторож браузерной задачи: столько секунд на один заход агента (открыть и
# заполнить; ожидание капчи человеком сюда не входит — у него свой срок).
DEFAULT_TASK_TIMEOUT_S = 240.0
# Итоги, которые остаются в силе, даже если сторож успел сработать: отклик
# уже ушёл (или мог уйти) — повтор недопустим.
_KEEP_AFTER_TIMEOUT = ("submitted", "duplicate", "submission_unknown")

_stop = False


def _on_signal(signum: int, _frame: object) -> None:
    global _stop
    _stop = True
    log.info("получен сигнал %s, завершаюсь после текущей задачи", signum)


def _require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        sys.exit(f"переменная {name} не задана")
    return val


def _memory_allows_browser() -> bool:
    """Хватит ли свободной памяти ещё на один Chromium.

    Не max_parallel_browsers(): она нарочно не опускается ниже 1. Здесь та же
    формула без этого пола. Без /proc (не Linux) память не проверяем.
    """
    if not os.path.exists("/proc/meminfo"):
        return True
    free = browser_limits.read_available_mb() - browser_limits.RESERVE_MB
    return free // browser_limits.PER_BROWSER_MB >= 1


def _timeout_result(timeout: float) -> AgentResult:
    # NAVIGATION_FAILED — в worker.RETRYABLE_CODES: задача уйдёт на повтор,
    # а если отправка уже началась, worker сам переведёт её в SUBMISSION_UNKNOWN.
    reason = f"Jupiter task timed out after {timeout:.0f}s, browser killed"
    return AgentResult(
        "failed", reason,
        [{"action": "failed", "reason": reason, "reason_code": Reason.NAVIGATION_FAILED}],
        Reason.NAVIGATION_FAILED,
    )


def _watch_agent(agent: JupiterAgent, engine: object, timeout: float) -> None:
    """Каждый заход агента (run, resume, продолжение после капчи) — под
    сторожем browser_limits. Сработал сторож — итог «временная ошибка»."""
    depth = [0]  # run() зовёт _run_from_page() — сторож только на внешнем вызове

    def wrap(method):
        def guarded(*args, **kwargs):
            if depth[0]:
                return method(*args, **kwargs)
            depth[0] += 1
            watchdog = browser_limits.watch_engine(engine, timeout)
            result = None
            try:
                with watchdog:
                    result = method(*args, **kwargs)
            except SubmissionAuthorizationRevoked:
                raise
            except Exception:
                if not watchdog.fired:
                    raise
            finally:
                depth[0] -= 1
            if watchdog.fired and getattr(result, "status", None) not in _KEEP_AFTER_TIMEOUT:
                log.warning("задача превысила %.0f с, браузер убит сторожем", timeout)
                return _timeout_result(timeout)
            return result
        return guarded

    for name in ("run", "resume", "_run_from_page"):
        setattr(agent, name, wrap(getattr(agent, name)))


def main() -> int:
    logging.basicConfig(
        format="%(asctime)s %(levelname)s %(message)s",
        level=logging.INFO,
        stream=sys.stderr,
    )

    base_url = _require_env("JOBTOO_URL")
    admin_token = (
        os.environ.get("JOBTOO_ADMIN_TOKEN", "").strip()
        or os.environ.get("ADMIN_API_TOKEN", "").strip()
    )
    if not admin_token:
        sys.exit("переменная JOBTOO_ADMIN_TOKEN (или ADMIN_API_TOKEN) не задана")

    worker_id = os.environ.get("JUPITER_WORKER_ID", "").strip()
    if not worker_id:
        worker_id = f"jupiter-{socket.gethostname()}"

    poll_interval = int(os.environ.get("JUPITER_POLL_INTERVAL", "30"))
    max_steps = int(os.environ.get("JUPITER_MAX_STEPS", "30"))
    receipts_path = os.environ.get("JUPITER_RECEIPTS", "").strip() or None
    handoffs_path = os.environ.get("JUPITER_HANDOFFS", "").strip() or None
    lease_seconds = int(os.environ.get("JUPITER_LEASE_SECONDS", "300"))

    engine_kind = os.environ.get("JUPITER_ENGINE", "http").strip().lower() or "http"
    if engine_kind not in ("http", "browser"):
        sys.exit(f"JUPITER_ENGINE должен быть http или browser, а не {engine_kind!r}")
    chromium_path = os.environ.get("JUPITER_CHROMIUM", "").strip() or None
    if engine_kind == "browser" and browser_engine.sync_playwright is None:
        # Ошибка при старте, а не посреди задачи.
        sys.exit(
            "JUPITER_ENGINE=browser требует Playwright: pip install playwright "
            "(и Chromium — JUPITER_CHROMIUM или playwright install chromium)"
        )
    task_timeout = float(os.environ.get("JUPITER_TASK_TIMEOUT_S", "").strip()
                         or DEFAULT_TASK_TIMEOUT_S)
    if engine_kind == "browser":
        # До первого Chromium: по метке потом видно, чьи процессы добивать.
        browser_limits.mark_owner()
    # Браузерные движки, созданные фабрикой; закрываются после каждой задачи.
    open_engines: list = []

    # YandexGPT — только если на сервере есть ключ. Видит подписи полей и
    # названия ключей профиля, но не данные кандидата (browser_planner).
    # База знаний Алисы (knowledge.py): в настоящих откликах — только знание,
    # подтверждённое ночной репетицией; остальное спрашивается у модели, как
    # раньше. Свой дневной потолок вызовов: остальное от 1500 — ночной разведке.
    raw_llm = yandex_gpt.YandexGPT.from_env()
    llm = knowledge.CountingLLM(raw_llm, int(os.environ.get("YANDEX_GPT_MAX_CALLS_PER_DAY", "200") or 200)) \
        if raw_llm is not None else None
    agent_params = inspect.signature(JupiterAgent).parameters

    def advisor_hooks(task: ApplicationTask) -> dict:
        advisor = knowledge.Advisor(knowledge.Knowledge.load(), normalize_host(task.vacancy_url) or "",
                                    llm, live=True)
        hooks = knowledge.advisor_hooks(advisor)
        out = {}
        for hook, part in (("apply_advisor", "apply"), ("field_mapper", "fields"),
                           ("question_explainer", "questions"),
                           ("outcome_judge", "judge")):
            if (llm is not None or advisor.entry.get(part)) and (hook == "apply_advisor" or hook in agent_params):
                out[hook] = hooks[hook]
        return out

    receipts = ReceiptStore(receipts_path)
    handoffs = HandoffStore(handoffs_path)

    queue = RemoteTaskQueue(
        base_url, admin_token, _require_env("EXPO_PUBLIC_APP_SECRET"),
        lease_seconds=lease_seconds,
        engine=engine_kind,
    )

    def profile_factory(task: ApplicationTask) -> CandidateProfile:
        profile = queue.fetch_profile(task.candidate_id, task.id)
        # Third-party legal consent is intentionally scoped to one application
        # row. It is never copied from JobToo's own consent or reused globally.
        # Поручение (Соглашение п. 8.3) покрывает только то, без чего отклик
        # не рассмотреть: обработку ПДн работодателем, его политику и правила
        # сайта, подтверждение достоверности анкеты. Реклама, кадровый резерв,
        # передача третьим лицам, трансграничная передача и особые категории
        # сюда не входят никогда — их ключей здесь нет.
        if task.third_party_consent_at:
            for key in DELEGATED_CONSENTS:
                profile.values[key] = True
        return profile

    def agent_factory(task: ApplicationTask) -> JupiterAgent:
        dry_run = not bool(task.submission_authorized_at)
        agent_extra = advisor_hooks(task)
        apply_advisor = agent_extra.pop("apply_advisor", None)
        engine = None
        if engine_kind == "browser":
            engine = browser_engine.JupiterBrowserEngine(
                allowed_hosts=set(),
                read_only=dry_run,
                executable_path=chromium_path,
                # Кнопку «Откликнуться» правила не нашли — из базы знаний или YandexGPT.
                apply_advisor=apply_advisor,
            )
            open_engines.append(engine)
        agent = JupiterAgent(
            allowed_hosts=set(),
            max_steps=max_steps,
            dry_run=dry_run,
            receipts=receipts,
            handoffs=handoffs,
            **({"engine": engine} if engine is not None else {}),
            **agent_extra,
        )
        if engine is not None:
            _watch_agent(agent, engine, task_timeout)
        return agent

    def close_engines() -> None:
        # Одна браузерная задача за раз: после каждой Chromium закрывается.
        while open_engines:
            engine = open_engines.pop()
            try:
                engine.close()
            except Exception:
                log.exception("не удалось закрыть браузерный движок")
        if engine_kind == "browser":
            # Остатки Chromium (зависший close, убитый сторожем браузер) —
            # только наши процессы, чужие браузеры не трогаются.
            killed = browser_limits.kill_stray_chromium()
            if killed:
                log.warning("добиты оставшиеся процессы Chromium: %d", len(killed))

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    log.info(
        "воркер %s запущен, сервер %s, движок %s, режим по согласию заявки",
        worker_id, base_url, engine_kind,
    )
    # Только да/нет: ключ и каталог YandexGPT в журнал не пишем.
    log.info("YandexGPT для незнакомых полей: %s; база знаний: %s", "да" if llm is not None else "нет",
             os.environ.get(knowledge.ENV) or knowledge.DEFAULT_FILE)
    if engine_kind == "browser":
        log.info(
            "память: свободно %d МБ, браузеров параллельно до %d, таймаут задачи %.0f с",
            browser_limits.read_available_mb(), browser_limits.max_parallel_browsers(),
            task_timeout,
        )

    last_requeue = 0.0
    while not _stop:
        if time.monotonic() - last_requeue > REQUEUE_EVERY:
            last_requeue = time.monotonic()
            try:
                hosts = sorted(set(recon_ok_hosts()) | {
                    h for site in AUDITED_SITES if site.live_ready for h in site.hosts
                })
                moved = queue.requeue_site_ready(hosts)
                if moved:
                    log.info("сняты с паузы %d откликов на подключённых сайтах", moved)
            except Exception:
                log.exception("не удалось снять с паузы отклики SITE_NOT_VERIFIED")
        if engine_kind == "browser" and not _memory_allows_browser():
            log.warning("мало свободной памяти для Chromium, задачу не беру, жду %d сек",
                        poll_interval)
            time.sleep(poll_interval)
            continue
        try:
            result = worker.run_once(
                queue, profile_factory, agent_factory, worker_id,
                site_gate=live_ready,
            )
        except Exception:
            log.exception("ошибка в run_once")
            time.sleep(poll_interval)
            continue
        finally:
            close_engines()

        if result is None:
            log.debug("очередь пуста, жду %d сек", poll_interval)
            time.sleep(poll_interval)
            continue

        task, state = result
        log.info("задача %s → %s (%s)", task.id, state, task.vacancy_url)

    log.info("воркер остановлен")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
