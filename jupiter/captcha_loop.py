"""Капча через человека: показать картинку кандидату в приложении и ввести его ответ.

Капчу Jupiter не решает сам и никому не отдаёт на распознавание — её решает
только кандидат. Здесь лишь доставка: снимок капчи уходит в очередь, приложение
показывает его человеку, ответ возвращается и вводится в ту же живую страницу.
Два вида: слово с картинки (человек вводит текст) и галочка «я не робот» /
сетка картинок (человек нажимает на снимок рамки, сервер повторяет нажатия,
03.10.2026).

Ответ человека нигде не логируется и не попадает в траекторию: это одноразовый
секрет той страницы, в истории отклика ему не место.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

log = logging.getLogger("jupiter")

SOLVED = "solved"
FAILED = "failed"
EXPIRED = "expired"
UNSUPPORTED = "unsupported"

# Больше двух капч на одну заявку — сайт, скорее всего, гоняет по кругу;
# дальше пусть человек разбирается сам («Нужны вы»).
MAX_CAPTCHAS_PER_TASK = 2
# Нажатия: галочка нередко открывает окно с заданием, а неверный выбор в сетке
# приносит новую сетку — столько снимков подряд показываем за один заход.
MAX_TAP_ROUNDS = 3
# Картинка на сайте меняется, ответ может не подойти. Человек жмёт «Повторить
# капчу» или вводит ответ заново: столько снимков за один заход и столько
# неверных ответов подряд — больше сайт, скорее всего, гоняет по кругу.
MAX_TEXT_ROUNDS = 6
MAX_WRONG_ANSWERS = 2


def solve_with_human(
    engine: Any,
    queue: Any,
    task_id: str,
    *,
    wait_s: float = 600,
    poll_s: float = 5,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> str:
    """Показать капчу человеку и ввести ответ. 'solved'|'failed'|'expired'|'unsupported'."""
    info = engine.captcha()
    if info is None:
        return UNSUPPORTED
    if getattr(info, "transferable", False):
        return _solve_text(engine, queue, task_id, info, wait_s, poll_s, sleep, clock)
    if getattr(info, "tappable", False) and callable(getattr(engine, "tap_captcha", None)):
        return _solve_taps(engine, queue, task_id, info, wait_s, poll_s, sleep, clock)
    return UNSUPPORTED


def _wait_answer(queue: Any, task_id: str, wait_s, poll_s, sleep, clock) -> tuple[str, str | None]:
    """Ждать ответа человека, держа аренду.

    ('answered', текст) | ('refresh', None) — человек просит новую капчу |
    ('expired', None)."""
    deadline = clock() + wait_s
    while clock() < deadline:
        # Потеряли аренду — задача уже не наша, вводить ответ нельзя.
        if queue.heartbeat(task_id) is False:
            return "expired", None
        status, answer = queue.captcha_poll(task_id)
        if status == "answered":
            return "answered", answer
        if status == "refresh":
            return "refresh", None
        if status == "expired":
            return "expired", None
        sleep(poll_s)
    return "expired", None


def _renew(engine: Any, info: Any) -> Any:
    """Новая капча по просьбе человека: «обновить картинку» на сайте, если она
    есть, и свежий поиск капчи на странице (None — капчи уже нет)."""
    refresh = getattr(engine, "refresh_captcha", None)
    if callable(refresh):
        refresh(info)
    return engine.captcha()


def _solve_text(engine, queue, task_id, info, wait_s, poll_s, sleep, clock) -> str:
    wrong = 0
    for _ in range(MAX_TEXT_ROUNDS):
        queue.captcha_post(task_id, engine.captcha_png(info))
        status, answer = _wait_answer(queue, task_id, wait_s, poll_s, sleep, clock)
        if status == "refresh":
            info = _renew(engine, info)
            if info is None:
                return SOLVED  # капчи уже нет: сайт пропустил сам
            if not getattr(info, "transferable", False):
                return UNSUPPORTED
            continue
        if status != "answered":
            return EXPIRED
        ok = bool(engine.enter_captcha(info, answer))
        answer = None
        if ok:
            queue.captcha_result(task_id, SOLVED)
            return SOLVED
        queue.captcha_result(task_id, FAILED)
        # Не подошло: сайт, как правило, показал новую картинку — человек
        # вводит заново, а не теряет отклик.
        wrong += 1
        info = engine.captcha()
        if wrong >= MAX_WRONG_ANSWERS or info is None or not getattr(info, "transferable", False):
            return FAILED
    return FAILED


def _solve_taps(engine, queue, task_id, info, wait_s, poll_s, sleep, clock) -> str:
    """Снимок рамки → нажатия человека → те же нажатия в браузере воркера."""
    from browser_captcha import CaptchaError, parse_taps

    taps_done = 0
    for _ in range(MAX_TAP_ROUNDS + 2):
        queue.captcha_post(task_id, engine.captcha_tap_png(info), "tap")
        status, answer = _wait_answer(queue, task_id, wait_s, poll_s, sleep, clock)
        if status == "refresh":
            # Свежий снимок рамки (значок обновления человек жмёт на снимке сам).
            info = engine.captcha()
            if info is None:
                return SOLVED
            if not getattr(info, "tappable", False):
                return UNSUPPORTED
            continue
        if status != "answered":
            return EXPIRED
        try:
            state = engine.tap_captcha(info, parse_taps(answer or ""))
        except CaptchaError:
            queue.captcha_result(task_id, FAILED)
            return FAILED
        finally:
            answer = None
        if state == "solved":
            queue.captcha_result(task_id, SOLVED)
            return SOLVED
        queue.captcha_result(task_id, FAILED)
        taps_done += 1
        if state != "again" or taps_done >= MAX_TAP_ROUNDS:
            return FAILED
        # Открылось (или обновилось) задание: новый снимок и новый круг.
        info = engine.captcha()
        if info is None:
            return SOLVED
        if not getattr(info, "tappable", False):
            return UNSUPPORTED
    return FAILED


def can_ask_human(agent: Any, queue: Any) -> bool:
    """Есть ли у движка и очереди всё, чтобы передать капчу человеку.

    HTTP-движок капчу не показывает; dry-run не должен дёргать человека.
    """
    engine = getattr(agent, "engine", None)
    return (
        not getattr(agent, "dry_run", True)
        and callable(getattr(engine, "captcha", None))
        and callable(getattr(queue, "captcha_post", None))
    )


def continue_through_captcha(
    agent: Any,
    queue: Any,
    task_id: str,
    profile: Any,
    result: Any,
    *,
    solve: Callable[..., str] = solve_with_human,
    max_captchas: int = MAX_CAPTCHAS_PER_TASK,
) -> Any:
    """Пока агент упирается в капчу — отдать её человеку и продолжить с той же страницы.

    Не получилось (не та капча, неверный ответ, человек не ответил) —
    возвращается исходный результат CAPTCHA_REQUIRED, и заявка уходит в «Нужны вы».
    """
    from agent import Reason

    for _ in range(max_captchas):
        if result.reason_code != Reason.CAPTCHA_REQUIRED or not can_ask_human(agent, queue):
            return result
        try:
            outcome = solve(agent.engine, queue, task_id)
        except Exception as exc:
            # Сбой доставки не должен ронять заявку: остаётся «Нужны вы».
            log.warning("captcha handoff failed for task %s: %s", task_id, type(exc).__name__)
            return result
        log.info("captcha for task %s: %s", task_id, outcome)
        if outcome != SOLVED:
            return result
        trajectory = result.trajectory
        trajectory.append({"action": "captcha", "status": SOLVED, "by": "candidate"})
        result = agent._run_from_page(agent.engine.current_page(), profile, trajectory)
    return result
