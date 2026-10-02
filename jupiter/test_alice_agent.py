#!/usr/bin/env python3
"""Алиса-спасатель (alice_agent): проверка ответа модели, лимиты цикла и работа в Chromium.

Без браузера всегда идут разбор и проверка ответа, сообщение шага, подбор варианта, квота и
встройка в агента (на заглушках). Страницы в Chromium — с Playwright и браузером
(JUPITER_CHROMIUM или JUPITER_BROWSER_TESTS=1); иначе пропускаются.

Главное ограничение проверяется отдельно: ни в одном запросе к модели нет значений профиля.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import alice_agent
from agent import CandidateProfile, JupiterAgent, Reason
from alice_agent import (
    CAPTCHA, BLOCKED, LIMIT, READY, STUCK, Context, RescueResult, Snapshot, TaskQuota,
    build_user, check_action, parse_answer, pick_option, rescue,
)
from engine import EngineError, JupiterWebEngine

try:
    from browser_engine import JupiterBrowserEngine, sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)
RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")

# Значения профиля уникальные: по ним проверяется, что модели они не уходили.
VALUES = {
    "first_name": "Аврелий",
    "last_name": "Квантов",
    "email": "aurelij.q7@example.org",
    "phone": "+79161230987",
    "telegram": "@aurelij_q7",
    "gender": "Мужской",
    "relocation": "Да",
    "city": "Нижневартовск-Q7",
    "citizenship": "Гражданство-Q7",
    "consent": True,
}
KEYS = ["city", "email", "first_name", "gender", "last_name", "phone", "relocation", "telegram"]
SECRET_STRINGS = [v for v in VALUES.values() if isinstance(v, str) and len(v) >= 6]   # «Да» — не секрет


def value_for(key, fmt=None):
    value = VALUES.get(key)
    return value if isinstance(value, str) else None


DONE_STUCK = {"ok": "unknown", "memory": "", "goal": "", "action": {"type": "done", "result": "stuck", "why": "нет сценария"}}
DONE_READY = {"ok": "yes", "memory": "готово", "goal": "", "action": {"type": "done", "result": "ready", "why": "анкета открыта"}}


def A(**action):
    return {"ok": "yes", "memory": "", "goal": "", "action": action}


class FakeLLM:
    """Скрипт ответов: элемент — готовый ответ или функция от текста сообщения шага."""

    def __init__(self, *script):
        self.script = list(script)
        self.calls = []

    def complete_json(self, system: str, user: str, schema_hint: str = "") -> dict:
        self.calls.append((system, user, schema_hint))
        n = len(self.calls) - 1
        item = self.script[n] if n < len(self.script) else DONE_STUCK
        return item(user) if callable(item) else item


def idx_of(user: str, label: str) -> str:
    m = re.search(r"\*?\[([\w.\-]+)\][^\n]*?«" + re.escape(label), user)
    if not m:
        raise AssertionError(f"в сообщении шага нет «{label}»:\n{user}")
    return m.group(1)


def click(label):
    return lambda user: A(type="click", idx=idx_of(user, label))


def el(idx, kind, label, **kw):
    return {"t": "el", "idx": idx, "kind": kind, "label": label, "required": False, "state": "",
            "options": [], "more": 0, "submit": False, "inForm": True, "attrs": {}, "format": "", **kw}


DATA = {
    "url": "https://e.example/vac?token=abc", "title": "Вакансия", "modal": False,
    "scroll": {"where": "page", "above": 0, "below": 0}, "hidden": {"above": 0, "below": 0, "limit": 0},
    "items": [
        el("1", "кнопка", "Присоединиться к нам", inForm=False),
        el("2", "кнопка", "Отправить отклик", submit=True),
        el("3", "кнопка", "Войти", inForm=False),
        el("4", "флажок", "Согласен на обработку персональных данных"),
        el("5", "поле", "Имя"),
        el("6", "список", "Гражданство", options=["РФ", "Другое"]),
        el("7", "файл", "Резюме"),
        el("8", "файл", "Фото"),
        el("9", "флажок", "Готов к командировкам"),
        el("10", "кнопка", "Вакансии", inForm=False),
        el("11", "радио", "Готовы к вахте", options=[{"idx": "11.1", "text": "Да"}, {"idx": "11.2", "text": "Нет"}]),
        el("12", "кнопка", "Я не робот", inForm=False),
        el("13", "поле", "Паспорт"),
        el("14", "кнопка", "Далее", submit=True),
        el("15", "кнопка", "Я согласен с условиями", inForm=False),
        el("16", "флажок", ""),
        el("17", "поле-дата", "Дата рождения", format="ГГГГ-ММ-ДД"),
        el("18", "кнопка", "Оплатить подписку", inForm=False),
        el("19", "кнопка", "Завершить", inForm=True),
        el("20", "поле-пароль", "Пароль"),
        el("21", "флажок", "Готов к переезду", state="отмечено"),
        el("22", "поле", "Телефон"),
        el("23", "флажок", "Я не против хранения данных в кадровом резерве"),
        el("24", "флажок", "Соглашаюсь с правилами сайта"),
    ],
}


def ctx(**kw):
    resume = kw.pop("resume", None)
    base = dict(profile_keys=frozenset(KEYS + ["citizenship", "has_car"]), value_for=value_for,
                resume_path=resume, read_only=False, last_step=False)
    base.update(kw)
    return Context(**base)


class ParseAnswerTest(unittest.TestCase):
    def ok(self, **action):
        answer, err = parse_answer(A(**action))
        self.assertIsNone(err, action)
        return answer["action"]

    def bad(self, raw):
        answer, err = parse_answer(raw)
        self.assertIsNone(answer, raw)
        self.assertTrue(err, raw)

    def test_valid_actions(self):
        self.assertEqual(self.ok(type="fill", idx="12", key="phone", format="phone_8"),
                         {"type": "fill", "idx": "12", "key": "phone", "format": "phone_8"})
        self.assertEqual(self.ok(type="click", idx=7)["idx"], "7")
        self.assertEqual(self.ok(type="click", idx="[*F3-7]")["idx"], "f3-7")
        self.assertEqual(self.ok(type="select", idx="16", option="Москва")["option"], "Москва")
        self.assertEqual(self.ok(type="select", idx="16.2", key="city")["key"], "city")
        self.assertEqual(self.ok(type="scroll", dir="down")["dir"], "down")
        self.assertEqual(self.ok(type="done", result="ask_human", question="Какой у вас пол?")["question"],
                         "Какой у вас пол?")

    def test_garbage(self):
        for raw in ("не dict", [], {}, None, {"action": "click"}, {"ok": "yes"},
                    {"action": {"type": "click", "idx": "1"}, "extra": 1},
                    {"ok": "maybe", "action": {"type": "scroll", "dir": "up"}},
                    {"memory": 5, "action": {"type": "scroll", "dir": "up"}}):
            self.bad(raw)

    def test_actions_outside_the_list_are_refused(self):
        for kind in ("submit", "navigate", "evaluate", "send_keys", "go_back", "input", "search", "open", ""):
            self.bad(A(type=kind, idx="1"))
        self.bad(A(idx="1"))
        self.bad(A(type=None))

    def test_no_free_text_anywhere(self):
        self.bad(A(type="fill", idx="5", key="first_name", text="любой текст"))
        self.bad(A(type="fill", idx="5", key="first_name", value="Иван"))
        self.bad(A(type="fill", idx="5", text="Иван"))
        self.bad(A(type="click", idx="1", url="http://evil.example"))
        self.bad(A(type="upload", idx="7", path="/etc/passwd"))

    def test_one_action_per_step(self):
        self.bad({"ok": "yes", "action": [{"type": "click", "idx": "1"}, {"type": "click", "idx": "2"}]})
        self.bad({"ok": "yes", "action": [{"type": "click", "idx": "1"}]})

    def test_bad_fields(self):
        for idx in ("abc", "1; drop", "1.2.3", "f-1", "", "  ", True, None, [1], {"a": 1}):
            self.bad(A(type="click", idx=idx))
        self.bad(A(type="click"))
        self.bad(A(type="fill", idx="1"))
        self.bad(A(type="fill", idx="1", key=5))
        self.bad(A(type="select", idx="1"))
        self.bad(A(type="select", idx="1", key="city", option="Москва"))
        self.bad(A(type="check", idx="1"))
        self.bad(A(type="scroll", dir="left"))
        self.bad(A(type="done", result="sent"))
        self.bad(A(type="done", result="ready", idx="1"))


class CheckActionTest(unittest.TestCase):
    def setUp(self):
        self.snap = Snapshot.build(DATA)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.resume = str(Path(tmp.name) / "cv.txt")
        Path(self.resume).write_text("резюме", encoding="utf-8")

    def check(self, _ctx=None, **action):
        answer, err = parse_answer(A(**action))
        self.assertIsNone(err, action)
        return check_action(answer["action"], self.snap, _ctx or ctx(resume=self.resume))

    def test_allowed(self):
        self.assertIsNone(self.check(type="click", idx="1"))
        self.assertIsNone(self.check(type="fill", idx="5", key="first_name"))
        self.assertIsNone(self.check(type="fill", idx="22", key="phone", format="phone_8"))
        self.assertIsNone(self.check(type="fill", idx="17", key="first_name"))
        self.assertIsNone(self.check(type="select", idx="11", key="relocation"))
        self.assertIsNone(self.check(type="select", idx="11.2", option="Нет"))       # номер варианта = его группа
        self.assertIsNone(self.check(type="check", idx="9", key="relocation"))
        self.assertIsNone(self.check(type="upload", idx="7"))
        self.assertIsNone(self.check(type="scroll", dir="down"))
        self.assertIsNone(self.check(type="done", result="ready"))

    def test_final_submit_and_next_are_ours(self):
        self.assertIn("основной цикл", self.check(type="click", idx="2"))
        self.assertIn("основной цикл", self.check(type="click", idx="14"))
        self.assertIn("основной цикл", self.check(type="click", idx="19"))     # «Завершить» внутри формы

    def test_login_register_pay_sections_captcha(self):
        self.assertIn("вход", self.check(type="click", idx="3"))
        self.assertIn("вход", self.check(type="click", idx="18"))
        self.assertIn("раздел", self.check(type="click", idx="10"))
        self.assertIn("капч", self.check(type="click", idx="12"))

    def test_consent_is_never_ours(self):
        self.assertIn("согласи", self.check(type="click", idx="15"))
        self.assertTrue(self.check(type="check", idx="4", key="relocation"))
        self.assertTrue(self.check(type="check", idx="16", key="relocation"))      # флажок без подписи
        self.assertTrue(self.check(type="click", idx="4"))                          # флажок — не кнопка
        # Распознаватель согласий их не узнаёт, но это согласия: ставит только кандидат.
        self.assertIn("согласи", self.check(type="check", idx="23", key="relocation"))
        self.assertIn("согласи", self.check(type="check", idx="24", key="relocation"))

    def test_unknown_or_foreign_elements(self):
        self.assertIn("нет элемента", self.check(type="click", idx="9999"))
        self.assertIn("нет элемента", self.check(type="fill", idx="f3-7", key="first_name"))
        self.assertTrue(self.check(type="click", idx="5"))                          # поле: есть fill
        self.assertTrue(self.check(type="fill", idx="1", key="first_name"))        # кнопка: не поле
        self.assertTrue(self.check(type="fill", idx="20", key="first_name"))       # пароль

    def test_keys(self):
        self.assertIn("нет в списке", self.check(type="fill", idx="5", key="salary_secret"))
        self.assertIn("юридический", self.check(type="fill", idx="5", key="citizenship"))   # даже если в списке
        self.assertIn("юридический", self.check(type="fill", idx="5", key="has_car"))
        self.assertIn("юридический", self.check(type="check", idx="9", key="has_car"))
        self.assertIn("юридический", self.check(type="select", idx="11", key="citizenship"))
        self.assertTrue(self.check(type="fill", idx="5", key="consent"))
        self.assertTrue(self.check(type="fill", idx="5", key="personal_data_consent"))
        # ключ в списке, но значения нет
        self.assertIn("нет значения", self.check(ctx(profile_keys=frozenset({"nick"}), resume=self.resume),
                                                 type="fill", idx="5", key="nick"))

    def test_legal_and_special_labels(self):
        self.assertIn("юридический", self.check(type="fill", idx="13", key="first_name"))      # паспорт
        self.assertIn("юридический", self.check(type="select", idx="6", option="РФ"))          # гражданство
        self.assertIn("юридический", self.check(type="select", idx="6", key="city"))

    def test_fill_format_only_from_list(self):
        self.assertIn("не из списка", self.check(type="fill", idx="22", key="phone", format="любая"))

    def test_check_needs_a_yes(self):
        self.assertIn("не «да»", self.check(type="check", idx="9", key="first_name"))
        self.assertIn("уже отмечен", self.check(type="check", idx="21", key="relocation"))
        self.assertTrue(self.check(type="check", idx="5", key="relocation"))                   # не флажок

    def test_upload(self):
        self.assertIn("фото", self.check(type="upload", idx="8"))
        self.assertIn("резюме нет", self.check(ctx(resume="/нет/такого.txt"), type="upload", idx="7"))
        self.assertIn("резюме нет", self.check(ctx(resume=None), type="upload", idx="7"))
        self.assertTrue(self.check(type="upload", idx="5"))

    def test_last_step_only_done(self):
        last = ctx(resume=self.resume, last_step=True)
        self.assertIn("только done", self.check(last, type="click", idx="1"))
        self.assertIn("только done", self.check(last, type="scroll", dir="down"))
        self.assertIsNone(self.check(last, type="done", result="stuck"))


class PickOptionTest(unittest.TestCase):
    def test_pick(self):
        self.assertEqual(pick_option("Да", ["Нет", "Да"]), 1)
        self.assertEqual(pick_option("True", ["Нет", "Да"]), 1)
        self.assertEqual(pick_option("нет", ["Да", "Нет"]), 1)
        self.assertEqual(pick_option("Мужской", ["Женский", "Мужской"]), 1)
        self.assertEqual(pick_option("Москва", ["Москва и область", "Тверь"]), 0)
        self.assertEqual(pick_option("Высшее", ["Среднее", "Высшее (магистр)"]), 1)

    def test_nothing_or_ambiguous(self):
        self.assertIsNone(pick_option("Омск", ["Москва", "Тверь"]))
        self.assertIsNone(pick_option("Москва", ["Москва-1", "Москва-2"]))
        self.assertIsNone(pick_option("Да", ["Возможно", "Нет"]))
        self.assertIsNone(pick_option("", ["Да"]))


class BuildUserTest(unittest.TestCase):
    def test_values_are_cut_but_key_names_are_shown(self):
        data = dict(DATA, items=[
            el("5", "поле", "Имя", state="заполнено"),
            {"t": "err", "text": "Контакт @aurelij_q7 не найден, Аврелий, проверьте"},
            {"t": "h", "text": "Вакансия в Нижневартовск-Q7"},
        ])
        user = build_user(goal="откликнуться на вакансию", code="VACANCY_NOT_FOUND", step=1, keys=KEYS,
                          memory="", history=[], last_error="", notes=["телефон +79161230987 занят"],
                          data=data, host="e.example", secrets=SECRET_STRINGS)
        for secret in SECRET_STRINGS:
            self.assertNotIn(secret.lower(), user.lower())
        self.assertIn("telegram", user)
        self.assertIn("[5] поле «Имя» заполнено", user)
        self.assertNotIn("token=abc", user)            # адрес — только хост

    def test_size_and_last_step(self):
        items = [el(str(i), "кнопка", f"Кнопка {i} " + "x" * 50, inForm=False) for i in range(1, 400)]
        user = build_user(goal="g", code="X", step=alice_agent.MAX_STEPS, keys=KEYS, memory="m" * 400,
                          history=["h" * 150] * 5, last_error="e" * 200, notes=[], data=dict(DATA, items=items),
                          host="h", secrets=[])
        self.assertLessEqual(len(user), alice_agent.USER_CHARS)
        self.assertIn("последний шаг", user)
        self.assertIn("ещё", user.splitlines()[-2] + user.splitlines()[-1] + "ещё")


class QuotaTest(unittest.TestCase):
    def test_remaining_is_the_smaller_of_task_and_hour(self):
        quota = TaskQuota(SimpleNamespace(remaining=lambda: 5))
        self.assertEqual(quota.remaining(), 5)
        quota = TaskQuota(SimpleNamespace(remaining=lambda: 50))
        self.assertEqual(quota.remaining(), alice_agent.MAX_CALLS)
        for _ in range(20):
            quota.spend()
        self.assertEqual(quota.remaining(), 0)
        self.assertEqual(TaskQuota().remaining(), alice_agent.MAX_CALLS)


class StubEngineTest(unittest.TestCase):
    """Встройка в агента без браузера: заглушка вместо движка."""

    def agent(self, alice, engine, **kw):
        agent = JupiterAgent({"e.example"}, engine=engine, alice=alice, **kw)
        return agent

    def setUp(self):
        self.profile = CandidateProfile(values=dict(VALUES))
        self.page = SimpleNamespace(url="https://e.example/vac", title="Вакансия", forms=[], controls=[])

    def test_http_engine_never_calls_the_model(self):
        llm = FakeLLM()
        agent = self.agent(llm, JupiterWebEngine({"e.example"}))
        trajectory = []
        self.assertIsNone(agent._alice_rescue(self.page, self.profile, trajectory, Reason.VACANCY_NOT_FOUND))
        self.assertEqual((llm.calls, trajectory), ([], []))

    def test_without_hook_nothing_happens(self):
        agent = self.agent(None, SimpleNamespace(_tab=object(), read_only=False))
        self.assertIsNone(agent._alice_rescue(self.page, self.profile, [], Reason.VACANCY_NOT_FOUND))

    def test_values_for_alice(self):
        agent = self.agent(None, JupiterWebEngine({"e.example"}))
        profile = CandidateProfile(values={"phone": "+79161230987", "birth_date": "1995-02-01", "relocation": True,
                                           "city": "Москва", "empty": "", "resume": "x", "nested": {"a": 1}})
        self.assertEqual(agent._alice_value(profile, "phone"), "+79161230987")
        self.assertEqual(agent._alice_value(profile, "phone", "phone_8"), "89161230987")
        self.assertEqual(agent._alice_value(profile, "phone", "phone_10"), "9161230987")
        self.assertEqual(agent._alice_value(profile, "phone", "phone_mask"), "+7 (916) 123-09-87")
        self.assertEqual(agent._alice_value(profile, "birth_date"), "1995-02-01")
        self.assertEqual(agent._alice_value(profile, "birth_date", "date_dmy"), "01.02.1995")
        self.assertEqual(agent._alice_value(profile, "city", "phone_8"), "Москва")
        self.assertEqual(agent._alice_value(profile, "relocation"), "Да")
        for key in ("empty", "resume", "nested", "нет"):
            self.assertIsNone(agent._alice_value(profile, key))

    def test_guards_and_trajectory(self):
        fresh = SimpleNamespace(url="https://e.example/vac", title="x")
        engine = SimpleNamespace(_tab=object(), read_only=False, current_page=lambda: fresh)
        agent = self.agent(FakeLLM(), engine)
        calls = []
        result = RescueResult(status=READY, acted=True, calls=2, radio_names={"trip"},
                              steps=[{"action": "alice_click", "ok": True, "idx": "7"}])

        def fake_rescue(*args, **kw):
            calls.append((args, kw))
            return result
        real = alice_agent.rescue
        alice_agent.rescue = fake_rescue
        self.addCleanup(setattr, alice_agent, "rescue", real)

        trajectory = []
        got = agent._alice_rescue(self.page, self.profile, trajectory, Reason.VACANCY_NOT_FOUND)
        self.assertIs(got, fresh)
        self.assertEqual([t["action"] for t in trajectory], ["alice_click", "alice_rescued"])
        self.assertEqual(agent._alice_radios, {"trip"})
        args, kw = calls[0]
        self.assertEqual(args[1], agent._llm_allowed_keys(self.profile))     # только имена ключей
        self.assertNotIn("consent", args[1])
        self.assertEqual(kw["value_for"]("phone", "phone_8"), "89161230987")
        # на той же точке второй раз не идём
        trajectory = []
        self.assertIsNone(agent._alice_rescue(self.page, self.profile, trajectory, Reason.VACANCY_NOT_FOUND))
        self.assertEqual(trajectory[0]["why"], "на этой точке Алиса уже была")
        self.assertEqual(len(calls), 1)
        # не больше двух заходов на задачу
        other = SimpleNamespace(url="https://e.example/other", title="", forms=[], controls=[])
        self.assertIs(agent._alice_rescue(other, self.profile, [], Reason.VACANCY_NOT_FOUND), fresh)
        third = SimpleNamespace(url="https://e.example/third", title="", forms=[], controls=[])
        trajectory = []
        self.assertIsNone(agent._alice_rescue(third, self.profile, trajectory, Reason.VACANCY_NOT_FOUND))
        self.assertEqual(trajectory[0]["why"], "заходы на задачу кончились")

    def test_gave_up_when_nothing_was_done_or_blocked(self):
        engine = SimpleNamespace(_tab=object(), read_only=True, current_page=lambda: self.fail("снимок не нужен"))
        agent = self.agent(FakeLLM(), engine)
        real = alice_agent.rescue
        self.addCleanup(setattr, alice_agent, "rescue", real)
        for status, acted in ((STUCK, False), (BLOCKED, True), (alice_agent.ASK_HUMAN, False)):
            alice_agent.rescue = lambda *a, status=status, acted=acted, **k: RescueResult(status=status, acted=acted, why="w")
            agent._alice_points.clear()
            agent._alice_quota = None
            trajectory = []
            self.assertIsNone(agent._alice_rescue(self.page, self.profile, trajectory, Reason.STEP_DID_NOT_ADVANCE))
            self.assertEqual(trajectory[-1]["action"], "alice_gave_up")
            self.assertEqual(trajectory[-1]["reason_code"], Reason.STEP_DID_NOT_ADVANCE)

    def test_current_page_failure_is_a_give_up(self):
        def broken():
            raise EngineError("упала вкладка")
        engine = SimpleNamespace(_tab=object(), read_only=False, current_page=broken)
        agent = self.agent(FakeLLM(), engine)
        real = alice_agent.rescue
        alice_agent.rescue = lambda *a, **k: RescueResult(status=READY, acted=True)
        self.addCleanup(setattr, alice_agent, "rescue", real)
        trajectory = []
        self.assertIsNone(agent._alice_rescue(self.page, self.profile, trajectory, Reason.VACANCY_NOT_FOUND))
        self.assertEqual(trajectory[-1]["action"], "alice_gave_up")

    def test_small_hour_budget_blocks_the_start(self):
        engine = SimpleNamespace(_tab=object(), read_only=False)
        agent = self.agent(FakeLLM(), engine)
        agent._alice_quota = TaskQuota(SimpleNamespace(remaining=lambda: 2))
        trajectory = []
        self.assertIsNone(agent._alice_rescue(self.page, self.profile, trajectory, Reason.VACANCY_NOT_FOUND))
        self.assertEqual(trajectory[0]["why"], "мало вызовов модели в бюджете")


# ---------------------------------------------------------------------------
# Страницы в Chromium
# ---------------------------------------------------------------------------

HEAD = '<!doctype html><meta charset="utf-8"><title>Вакансия</title>'

CONTACTS = """
  <label>Имя <input name="fn" required></label>
  <label>Фамилия <input name="ln" required></label>
  <label>Email <input name="em" type="email" required></label>
  <label>Телефон <input name="ph" type="tel" required></label>"""

# (а) «Кнопка» отклика — div с курсором-рукой, текст правилам движка незнаком,
# обработчик общий на документе. Анкета рисуется по клику.
ODD_CTA = HEAD + """<h1>Бухгалтер</h1><p>Работа в команде финансового отдела.</p>
<div class="cta" style="cursor:pointer;padding:8px;border:1px solid #888;width:200px">Присоединиться к нам</div>
<div id="root"></div>
<script>
document.addEventListener('click', e => {
  if (!e.target.closest('.cta')) return;
  document.getElementById('root').innerHTML = `<form method="post" action="/api/apply-page">""" + CONTACTS + """
    <button type="submit">Отправить отклик</button></form>`;
});
</script>"""

# (б) Обязательное поле без подписи в разметке: смысл — в соседнем тексте. Движок зовёт его
# jt-N, ни одно правило агента ключ не подберёт — только Алиса.
UNLABELED_SELECT = HEAD + """<h1>Менеджер</h1>
<form id="f">""" + CONTACTS + """
  <div class="row"><div class="lbl">Ваш пол</div>
    <select required><option value="">Выберите</option><option>Женский</option><option>Мужской</option></select></div>
  <button type="submit">Отправить отклик</button>
</form>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const v = [...e.target.querySelectorAll('input,select')].map(i => i.value);
  await fetch('/api/apply', { method: 'POST', body: JSON.stringify(v) });
  document.body.innerHTML = '<h2>Спасибо! Ваш отклик получен</h2>';
});
</script>"""

# То же для текстового поля: значение пишет код, а при отправке _apply_values его не затирает.
UNLABELED_TEXT = UNLABELED_SELECT.replace(
    """<div class="row"><div class="lbl">Ваш пол</div>
    <select required><option value="">Выберите</option><option>Женский</option><option>Мужской</option></select></div>""",
    """<div class="row"><div class="lbl">Ник для связи</div><input required></div>""")

# Радио-группа с вопросом-фактом: «заранее отмеченные» ответы агент снимает, но выбор
# Алисы по ключу профиля снимать нельзя.
RADIO_TRIP = HEAD + """<h1>Монтажник</h1>
<form method="post" action="/api/apply-page">""" + CONTACTS + """
  <fieldset><legend>Готовы к командировкам?</legend>
    <label><input type="radio" name="trip" value="yes" required> Да</label>
    <label><input type="radio" name="trip" value="no"> Нет</label></fieldset>
  <button type="submit">Отправить отклик</button>
</form>"""

# (в) Всё, что Алисе нельзя: отправка, вход, согласие, юридическое поле. Плюс сообщение
# сайта, повторяющее данные кандидата (должно быть вырезано до модели).
HOSTILE = HEAD + """<h1>Курьер</h1>
<a href="/login">Войти</a>
<div role="alert" class="error">Контакт @aurelij_q7 для Аврелий не найден</div>
<form method="post" action="/api/apply-page">""" + CONTACTS + """
  <label>Гражданство <select name="cit"><option value="">Выберите</option><option>РФ</option><option>Другое</option></select></label>
  <label><input type="checkbox" name="agree"> Согласен на обработку персональных данных</label>
  <button type="submit">Отправить отклик</button>
</form>"""

# (г) Кнопка без последствий и кнопки, которые растут.
INERT = HEAD + """<h1>Курьер</h1><button type="button" id="a">Показать подробности</button>
<button type="button" id="b">Показать условия</button>"""

GROW = HEAD + """<h1>Курьер</h1><div id="root"><button type="button" class="more" data-n="1">Показать ещё 1</button></div>
<script>
document.addEventListener('click', e => {
  const b = e.target.closest('.more'); if (!b) return;
  const n = +b.dataset.n + 1;
  b.outerHTML = `<button type="button" class="more" data-n="${n}">Показать ещё ${n}</button>`;
});
</script>"""

# Обычная кнопка шлёт POST «для статистики»: в read-only движок его обрывает.
TRACKER = HEAD + """<h1>Курьер</h1>
<button type="button" id="t">Показать контакты</button><p id="out"></p>
<script>
document.getElementById('t').onclick = async () => {
  try { await fetch('/api/track', { method: 'POST', body: 'x' }); } catch (e) {}
  document.getElementById('out').textContent = 'Контакты отдела кадров';
};
</script>"""

# SPA-анкета без <form>: кнопка «Готово» сама шлёт POST. Для Алисы это не кнопка
# отправки по признакам (подпись не отличить от «открыть анкету») — запрет держит сеть.
DIV_FORM = HEAD + """<h1>Курьер</h1><div id="f"><label>Имя <input id="n" required></label>
<div role="button" id="go">Готово</div></div><p id="out"></p>
<script>
document.getElementById('go').onclick = async () => {
  try { await fetch('/api/apply', { method: 'POST', body: 'n=' + document.getElementById('n').value });
        document.getElementById('f').innerHTML = '<p>Спасибо, отклик отправлен</p>'; } catch (e) {}
};
</script>"""

FOREIGN = HEAD + """<h1>Курьер</h1><a href="http://elsewhere.invalid:9/page" id="x">Подробнее на другом сайте</a>"""

CAPTCHA_PAGE = HEAD + """<h1>Курьер</h1><button type="button">Показать подробности</button>
<div class="g-recaptcha" style="width:300px;height:80px"></div>"""

THANKS = HEAD + "<h2>Спасибо! Ваш отклик получен</h2>"

PAGES = {
    "/oddcta": ODD_CTA, "/select": UNLABELED_SELECT, "/text": UNLABELED_TEXT, "/trip": RADIO_TRIP, "/hostile": HOSTILE,
    "/inert": INERT, "/grow": GROW, "/tracker": TRACKER, "/divform": DIV_FORM, "/foreign": FOREIGN, "/captcha": CAPTCHA_PAGE,
}


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str = "text/html; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in PAGES:
            self._send(200, PAGES[path].encode("utf-8"))
        else:
            self._send(404, b"")

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.server.state["posts"].append((self.path, raw))
        if self.path == "/api/apply-page":
            self._send(200, THANKS.encode("utf-8"))
        else:
            self._send(200, json.dumps({"ok": True}).encode(), "application/json")


def no_values(test: unittest.TestCase, llm: FakeLLM, msg: str = ""):
    """Ни в одном запросе к модели нет значений профиля."""
    for system, user, schema in llm.calls:
        blob = (system + "\n" + user + "\n" + schema).lower()
        for secret in SECRET_STRINGS:
            test.assertNotIn(secret.lower(), blob, msg or secret)


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class AliceBrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.server.state = {"posts": []}
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.server.state["posts"].clear()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        resume = Path(tmp.name) / "resume.txt"
        resume.write_text("Резюме Аврелия Квантова\n", encoding="utf-8")
        self.resume = str(resume)
        self.profile = CandidateProfile(values=dict(VALUES), resume_path=self.resume)

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def engine(self, *, read_only):
        eng = JupiterBrowserEngine({"127.0.0.1"}, read_only=read_only, executable_path=CHROMIUM)
        self.addCleanup(eng.close)
        return eng

    def posts(self, prefix="/api/apply"):
        return [urllib.parse.unquote_plus(raw.decode("utf-8", "replace"))
                for path, raw in self.server.state["posts"] if path.startswith(prefix)]

    def run_agent(self, path, llm, *, live):
        eng = self.engine(read_only=not live)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=not live, alice=llm)
        result = agent.run(self.url(path), self.profile)
        return eng, agent, result, json.dumps(result.as_dict(), ensure_ascii=False, indent=1)

    def resc(self, path, llm, *, read_only=False, budget=None, keys=KEYS, eng=None):
        eng = eng or self.engine(read_only=read_only)
        if eng.page is None or not eng._tab.url.startswith(self.url(path)):
            eng.open(self.url(path))
        res = rescue(eng, keys, "откликнуться на вакансию", "VACANCY_NOT_FOUND", llm, read_only=read_only,
                     budget=budget or TaskQuota(), value_for=value_for, resume_path=self.resume)
        return eng, res

    @staticmethod
    def newest(user):
        labels = re.findall(r"\[([\w.\-]+)\] кнопка «Показать ещё (\d+)»", user)
        return A(type="click", idx=labels[-1][0])

    # ── (а) кнопка отклика без привычных признаков ─────────────────────────
    def test_a_odd_apply_button_dry_run_reaches_ready(self):
        llm = FakeLLM(click("Присоединиться к нам"), DONE_READY)
        eng, _agent, result, dump = self.run_agent("/oddcta", llm, live=False)
        self.assertEqual(result.status, "ready_to_submit", dump)
        self.assertEqual(self.server.state["posts"], [], dump)
        self.assertEqual(len(llm.calls), 2, dump)
        steps = [t for t in result.trajectory if str(t.get("action", "")).startswith("alice_")]
        self.assertEqual([t["action"] for t in steps], ["alice_click", "alice_done", "alice_rescued"], dump)
        self.assertEqual(steps[0]["label"], "Присоединиться к нам")
        no_values(self, llm, dump)

    def test_a_odd_apply_button_live_submits_once(self):
        llm = FakeLLM(click("Присоединиться к нам"), DONE_READY)
        _eng, _agent, result, dump = self.run_agent("/oddcta", llm, live=True)
        self.assertEqual(result.status, "submitted", dump)
        sent = self.posts("/api/apply-page")
        self.assertEqual(len(sent), 1, dump)
        for value in (VALUES["first_name"], VALUES["last_name"], VALUES["email"]):
            self.assertIn(value, sent[0], dump)
        no_values(self, llm, dump)

    def test_a_without_the_hook_the_old_answer_is_kept(self):
        _eng, _agent, result, dump = self.run_agent("/oddcta", None, live=False)
        self.assertEqual((result.status, result.reason_code), ("failed", Reason.VACANCY_NOT_FOUND), dump)
        self.assertNotIn("alice", dump)

    def test_a_give_up_keeps_the_old_code_and_records_why(self):
        llm = FakeLLM(DONE_STUCK)
        _eng, _agent, result, dump = self.run_agent("/oddcta", llm, live=False)
        self.assertEqual((result.status, result.reason_code), ("failed", Reason.VACANCY_NOT_FOUND), dump)
        self.assertEqual(result.trajectory[-2]["action"], "alice_gave_up", dump)
        self.assertEqual(result.trajectory[-2]["reason_code"], Reason.VACANCY_NOT_FOUND, dump)
        self.assertEqual(len(llm.calls), 1)

    # ── (б) незнакомое обязательное поле: ключ называет Алиса, значение — код ─
    def _select_script(self):
        return FakeLLM(
            lambda user: A(type="select", idx=idx_of(user, "Ваш пол"), key="gender"),
            DONE_READY)

    def test_b_unlabeled_required_field_dry(self):
        llm = self._select_script()
        eng, _agent, result, dump = self.run_agent("/select", llm, live=False)
        self.assertEqual(result.status, "ready_to_submit", dump)
        steps = [t for t in result.trajectory if t.get("action") == "alice_select"]
        self.assertEqual(steps[0]["key"], "gender", dump)
        self.assertNotIn("Мужской", json.dumps(steps, ensure_ascii=False), dump)       # значения в траектории нет
        no_values(self, llm, dump)

    def test_b_unlabeled_required_field_live_value_survives_apply_values(self):
        llm = self._select_script()
        _eng, _agent, result, dump = self.run_agent("/select", llm, live=True)
        self.assertEqual(result.status, "submitted", dump)
        sent = self.posts("/api/apply")
        self.assertEqual(len(sent), 1, dump)
        # Выбор Алисы дошёл до сервера (_apply_values его не затёр), контакты — тоже.
        for value in ("Мужской", VALUES["first_name"], VALUES["email"]):
            self.assertIn(value, sent[0], dump)
        no_values(self, llm, dump)

    def test_b_unlabeled_text_field_value_survives_apply_values(self):
        llm = FakeLLM(lambda u: A(type="fill", idx=idx_of(u, "Ник для связи"), key="telegram"), DONE_READY)
        _eng, _agent, result, dump = self.run_agent("/text", llm, live=True)
        self.assertEqual(result.status, "submitted", dump)
        sent = self.posts("/api/apply")
        self.assertEqual(len(sent), 1, dump)
        for value in (VALUES["telegram"], VALUES["first_name"], VALUES["phone"][1:]):   # «+» в теле разобран как пробел
            self.assertIn(value, sent[0], dump)
        no_values(self, llm, dump)
        # в траектории — действие, номер и ключ, без значения
        fill = next(t for t in result.trajectory if t.get("action") == "alice_fill")
        self.assertEqual(sorted(fill), ["action", "idx", "key", "ok"])
        self.assertNotIn(VALUES["telegram"], json.dumps(fill, ensure_ascii=False))

    def test_b_known_fields_are_shown_to_alice_as_filled(self):
        llm = self._select_script()
        self.run_agent("/select", llm, live=False)
        first = llm.calls[0][1]
        self.assertRegex(first, r"поле «Имя» обяз заполнено")
        self.assertRegex(first, r"список «Ваш пол» обяз пусто")

    def test_b_radio_choice_is_not_cleared_as_site_default(self):
        llm = FakeLLM(lambda user: A(type="select", idx=idx_of(user, "Готовы к командировкам?"), key="relocation"),
                      DONE_READY)
        _eng, agent, result, dump = self.run_agent("/trip", llm, live=True)
        self.assertEqual(result.status, "submitted", dump)
        sent = self.posts("/api/apply-page")
        self.assertEqual(len(sent), 1, dump)
        self.assertIn("trip=yes", sent[0], dump)
        self.assertEqual(agent._alice_radios, {"trip"})
        no_values(self, llm, dump)

    def test_b_model_cannot_name_a_key_of_someone_else(self):
        llm = FakeLLM(lambda user: A(type="select", idx=idx_of(user, "Ваш пол"), key="salary_secret"), DONE_STUCK)
        _eng, _agent, result, dump = self.run_agent("/select", llm, live=False)
        self.assertEqual(result.status, "action_required", dump)
        self.assertEqual(result.reason_code, Reason.NEEDS_ANSWERS, dump)      # вопрос ушёл человеку, как раньше
        self.assertEqual(self.server.state["posts"], [])

    # ── (в) всё запрещённое отвергается и не трогает страницу ───────────────
    def test_c_forbidden_actions_are_rejected_and_page_is_untouched(self):
        eng = self.engine(read_only=False)
        eng.open(self.url("/hostile"))
        keys = KEYS + ["citizenship"]
        cases = {
            "отправить": click("Отправить отклик"),
            "войти": click("Войти"),
            "согласие кликом": lambda u: A(type="click", idx=idx_of(u, "Согласен на обработку персональных данных")),
            "согласие галочкой": lambda u: A(type="check", idx=idx_of(u, "Согласен на обработку персональных данных"),
                                            key="relocation"),
            "чужой ключ": lambda u: A(type="fill", idx=idx_of(u, "Имя"), key="salary_secret"),
            "юридический ключ": lambda u: A(type="fill", idx=idx_of(u, "Имя"), key="citizenship"),
            "юридическое поле по ключу": lambda u: A(type="select", idx=idx_of(u, "Гражданство"), key="city"),
            "юридическое поле по тексту": lambda u: A(type="select", idx=idx_of(u, "Гражданство"), option="РФ"),
            "нет такого номера": lambda u: A(type="click", idx="9999"),
            "действие submit": lambda u: A(type="submit", idx=idx_of(u, "Отправить отклик")),
            "переход по адресу": lambda u: A(type="navigate", url="http://evil.example/"),
            "свой текст": lambda u: A(type="fill", idx=idx_of(u, "Имя"), key="first_name", text="Иван"),
            "список действий": lambda u: {"ok": "yes", "action": [{"type": "click", "idx": "1"}]},
        }
        for name, bad in cases.items():
            with self.subTest(name):
                llm = FakeLLM(bad, DONE_STUCK)
                _, res = self.resc("/hostile", llm, keys=keys, eng=eng)
                self.assertFalse(res.acted, name)
                self.assertEqual(res.steps[0]["action"], "alice_rejected", (name, res.steps))
                self.assertEqual(res.status, STUCK, name)
                no_values(self, llm, name)
        state = eng._tab.evaluate("""() => ({name: document.querySelector('[name=fn]').value,
            cit: document.querySelector('[name=cit]').value,
            agree: document.querySelector('[name=agree]').checked, url: location.pathname})""")
        self.assertEqual(state, {"name": "", "cit": "", "agree": False, "url": "/hostile"})
        self.assertEqual(self.server.state["posts"], [])

    def test_c_good_actions_on_the_same_page_work(self):
        eng = self.engine(read_only=False)
        llm = FakeLLM(lambda u: A(type="fill", idx=idx_of(u, "Имя"), key="first_name"), DONE_READY)
        _, res = self.resc("/hostile", llm, eng=eng)
        self.assertEqual((res.status, res.acted), (READY, True))
        self.assertEqual(eng._tab.evaluate("document.querySelector('[name=fn]').value"), VALUES["first_name"])
        self.assertEqual(res.steps[0], {"action": "alice_fill", "ok": True,
                                         "idx": res.steps[0]["idx"], "key": "first_name"})
        # ни в траектории, ни в запросах значения нет
        self.assertNotIn(VALUES["first_name"], json.dumps(res.steps, ensure_ascii=False))
        no_values(self, llm)

    def test_c_ready_without_a_single_action_is_not_ready(self):
        _, res = self.resc("/hostile", FakeLLM(DONE_READY))
        self.assertEqual((res.status, res.acted), (STUCK, False))

    # ── (г) петли и лимиты ─────────────────────────────────────────────────
    def test_d_repeated_action_stops(self):
        llm = FakeLLM(click("Показать подробности"), click("Показать подробности"), DONE_READY)
        _, res = self.resc("/inert", llm)
        self.assertEqual(res.status, STUCK)
        self.assertIn("повтор", res.why)
        self.assertEqual(len(llm.calls), 2)
        self.assertEqual(res.steps[-1]["action"], "alice_loop")

    def test_d_page_without_changes_stops_after_two_steps(self):
        llm = FakeLLM(click("Показать подробности"), click("Показать условия"), click("Показать подробности"))
        _, res = self.resc("/inert", llm)
        self.assertEqual(res.status, STUCK)
        self.assertIn("не меняется", res.why)
        self.assertEqual(len(llm.calls), 2)        # третьего вызова нет

    def test_d_two_bad_steps_in_a_row_stop(self):
        bad = A(type="click", idx="9999")
        llm = FakeLLM(bad, bad, DONE_READY)
        _, res = self.resc("/inert", llm)
        self.assertEqual(res.status, STUCK)
        self.assertEqual(len(llm.calls), 2)
        # ошибку шага модель видит на следующем шаге
        self.assertIn("нет элемента", llm.calls[1][1])

    def test_d_one_bad_step_is_survivable(self):
        llm = FakeLLM(A(type="click", idx="9999"), self.newest, DONE_READY)
        _, res = self.resc("/grow", llm)
        self.assertEqual((res.status, res.acted), (READY, True))

    def test_d_six_steps_and_the_last_one_is_only_done(self):
        llm = FakeLLM(*([self.newest] * 8))
        _, res = self.resc("/grow", llm)
        self.assertEqual(res.status, LIMIT)
        self.assertEqual(len(llm.calls), alice_agent.MAX_STEPS)
        self.assertEqual(sum(1 for s in res.steps if s["action"] == "alice_click"), alice_agent.MAX_STEPS - 1)
        self.assertEqual(res.steps[-1]["action"], "alice_rejected")
        self.assertIn("последний шаг", llm.calls[-1][1])
        self.assertTrue(res.acted)

    def test_d_new_elements_are_starred_for_the_next_step(self):
        llm = FakeLLM(self.newest, DONE_READY)
        self.resc("/grow", llm)
        self.assertIn("*[", llm.calls[1][1])

    def test_d_budget(self):
        eng = self.engine(read_only=False)
        llm = FakeLLM()
        _, res = self.resc("/grow", llm, budget=TaskQuota(calls=alice_agent.MIN_CALLS_TO_START - 1), eng=eng)
        self.assertEqual((res.status, len(llm.calls)), (LIMIT, 0))
        # бюджет кончается посреди захода: вызовов ровно столько, сколько было
        quota = TaskQuota(calls=alice_agent.MIN_CALLS_TO_START)
        llm = FakeLLM(*([self.newest] * 8))
        _, res = self.resc("/grow", llm, budget=quota, eng=eng)
        self.assertEqual((res.status, len(llm.calls), quota.calls_left), (LIMIT, 3, 0))
        self.assertIn("бюджет", res.why)
        # общий часовой бюджет процесса меньше, чем на задачу
        quota = TaskQuota(SimpleNamespace(remaining=lambda: 1))
        _, res = self.resc("/grow", FakeLLM(), budget=quota, eng=eng)
        self.assertEqual(res.status, LIMIT)

    def test_d_empty_and_broken_model(self):
        eng = self.engine(read_only=False)
        _, res = self.resc("/inert", FakeLLM({}), eng=eng)
        self.assertEqual((res.status, res.calls), (STUCK, 1))

        class Broken:
            def complete_json(self, *a):
                raise RuntimeError("дневной потолок")
        _, res = self.resc("/inert", Broken(), eng=eng)
        self.assertEqual(res.status, STUCK)
        self.assertIn("RuntimeError", res.why)

    def test_d_deadline(self):
        ticks = iter([0, 1000, 1000, 1000])
        eng = self.engine(read_only=False)
        eng.open(self.url("/inert"))
        res = rescue(eng, KEYS, "g", "X", FakeLLM(), read_only=False, budget=TaskQuota(), value_for=value_for,
                     clock=lambda: next(ticks))
        self.assertEqual(res.status, LIMIT)
        self.assertIn("время", res.why)

    # ── режимы ────────────────────────────────────────────────────────────
    def test_read_only_click_goes_through_but_post_is_cut(self):
        llm = FakeLLM(click("Показать контакты"), DONE_READY)
        eng, res = self.resc("/tracker", llm, read_only=True)
        self.assertEqual((res.status, res.acted), (READY, True))
        self.assertEqual(self.server.state["posts"], [])
        self.assertTrue(any(a.get("reason") == "read_only" for a in eng.actions if a.get("action") == "blocked_request"))
        self.assertEqual(eng._tab.evaluate("document.getElementById('out').textContent"), "Контакты отдела кадров")

    def test_live_click_that_posts_is_cut_and_stops_the_rescue(self):
        llm = FakeLLM(lambda u: A(type="fill", idx=idx_of(u, "Имя"), key="first_name"),
                      click("Готово"), DONE_READY)
        eng, res = self.resc("/divform", llm, read_only=False)
        self.assertEqual(self.server.state["posts"], [])
        self.assertEqual(res.status, BLOCKED, res)
        self.assertEqual(res.steps[-1]["action"], "alice_stopped", res)
        self.assertEqual(len(llm.calls), 2)
        self.assertFalse(eng.read_only)          # боевой режим движка вернулся

    def test_live_agent_does_not_send_through_alice(self):
        llm = FakeLLM(lambda u: A(type="fill", idx=idx_of(u, "Имя"), key="first_name"),
                      click("Готово"), DONE_READY)
        _eng, _agent, result, dump = self.run_agent("/divform", llm, live=True)
        self.assertEqual(self.server.state["posts"], [], dump)
        self.assertNotEqual(result.status, "submitted", dump)
        self.assertIn("alice_stopped", [t.get("action") for t in result.trajectory], dump)

    def test_read_only_submit_button_is_still_forbidden(self):
        llm = FakeLLM(click("Отправить отклик"), DONE_STUCK)
        _, res = self.resc("/hostile", llm, read_only=True)
        self.assertEqual(res.steps[0]["action"], "alice_rejected")
        self.assertEqual(self.server.state["posts"], [])

    def test_foreign_host_is_blocked(self):
        llm = FakeLLM(click("Подробнее на другом сайте"), DONE_READY)
        eng, res = self.resc("/foreign", llm)
        self.assertEqual(res.status, BLOCKED, res)
        self.assertEqual(len(llm.calls), 1)

    def test_captcha_stops_at_once(self):
        llm = FakeLLM(click("Показать подробности"))
        _, res = self.resc("/captcha", llm)
        self.assertEqual((res.status, res.acted, len(llm.calls)), (CAPTCHA, False, 0))

    # ── (д) модель не видит значений ────────────────────────────────────────
    def test_e_no_value_in_any_request_even_if_the_page_repeats_it(self):
        llm = FakeLLM(lambda u: A(type="fill", idx=idx_of(u, "Имя"), key="first_name"),
                      lambda u: A(type="scroll", dir="down"), DONE_READY)
        _, res = self.resc("/hostile", llm)
        self.assertGreaterEqual(len(llm.calls), 2)
        no_values(self, llm)
        # сообщение сайта доходит, но с вырезанными данными
        self.assertIn("[скрыто]", llm.calls[0][1])
        self.assertIn("Ключи:", llm.calls[0][1])
        for key in ("first_name", "telegram"):
            self.assertIn(key, llm.calls[0][1])
        # Системная часть с описанием схемы не содержит ни одного значения профиля.
        self.assertIn("x-data-logging", "x-data-logging")           # (заголовок проверяет test_yandex_gpt)

    def test_e_all_value_slots_go_through_value_for_only(self):
        seen = []

        def spy(key, fmt=None):
            seen.append(key)
            return value_for(key, fmt)
        eng = self.engine(read_only=False)
        eng.open(self.url("/hostile"))
        llm = FakeLLM(lambda u: A(type="fill", idx=idx_of(u, "Имя"), key="last_name"), DONE_READY)
        res = rescue(eng, KEYS, "g", "X", llm, read_only=False, budget=TaskQuota(), value_for=spy)
        self.assertTrue(res.acted)
        self.assertEqual(eng._tab.evaluate("document.querySelector('[name=fn]').value"), VALUES["last_name"])
        self.assertIn("last_name", seen)


class HttpEngineTest(unittest.TestCase):
    """HTTP-движок: у него нет вкладки, Алису не зовут."""

    def test_http_engine_gets_no_model_calls(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        server.state = {"posts": []}
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        llm = FakeLLM(DONE_READY)
        agent = JupiterAgent({"127.0.0.1"}, dry_run=True, alice=llm)
        result = agent.run(f"http://127.0.0.1:{server.server_address[1]}/inert", CandidateProfile(values=dict(VALUES)))
        self.assertEqual(llm.calls, [])
        self.assertNotEqual(result.status, "submitted")


if __name__ == "__main__":
    unittest.main()
