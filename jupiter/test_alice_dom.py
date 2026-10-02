#!/usr/bin/env python3
"""alice_dom: описание страницы для Алисы.

Без браузера всегда работают тесты render_outline и locator_for на готовых данных.
Тесты с живой страницей идут при Playwright и Chromium (JUPITER_CHROMIUM или
JUPITER_BROWSER_TESTS=1, как в test_browser_engine.py)."""
from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

import alice_dom
from alice_dom import (AliceDomError, collect, collect_all, iter_items, known_indexes,
                       locator_for, render_outline)

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)


def el(idx, kind, label="", **kw):
    return {"t": "el", "idx": str(idx), "kind": kind, "label": label, "rank": 0, "dist": 0, "core": False,
            "required": False, "state": "", "format": "", "attrs": {}, "options": [], "more": 0,
            "invalid": False, "error": "", "new": False, "submit": False, "inForm": False, **kw}


def field(idx, kind, label, **kw):
    return el(idx, kind, label, core=True, inForm=True, **kw)


def page(items, **kw):
    return {"url": "", "title": "", "modal": False, "scroll": {"where": "page", "above": 0, "below": 0},
            "hidden": {"above": 0, "below": 0, "limit": 0}, "items": items, **kw}


class RenderTest(unittest.TestCase):
    def test_line_format(self):
        data = page([
            {"t": "h", "text": "Инженер-сметчик", "rank": 0, "dist": 0, "core": False},
            el(1230, "кнопка", "Откликнуться"),
            {"t": "form", "text": "Анкета кандидата"},
            field(2050, "поле", "Фамилия", required=True, state="заполнено"),
            field(2052, "поле-телефон", "Мобильный телефон", required=True, state="пусто",
                  format="+7 (___) ___-__-__", invalid=True, error="Заполните поле", new=True),
            field(2054, "список", "Город", required=True, state="пусто",
                  options=["Москва", "Казань"], more=79),
            field(2055, "радио", "Готовы к командировкам?", required=True,
                  options=[{"idx": "2055.1", "text": "Да"}, {"idx": "2055.2", "text": "Нет"}]),
            field(2056, "файл", "Резюме", attrs={"accept": ".pdf,.doc,application/msword"}),
            {"t": "err", "text": "Заполните поле «Мобильный телефон»", "rank": 0, "dist": 0, "core": False},
            el(2058, "кнопка", "Отправить отклик", core=True, submit=True),
        ], scroll={"where": "page", "above": 0, "below": 0.6})
        text = render_outline(data)
        lines = text.split("\n")
        self.assertEqual(lines[0], "[начало страницы]")
        self.assertIn("# Инженер-сметчик", lines)
        self.assertIn("[1230] кнопка «Откликнуться»", lines)
        self.assertIn("— форма «Анкета кандидата»", lines)
        self.assertIn("[2050] поле «Фамилия» обяз заполнено", lines)
        self.assertIn("*[2052] поле-телефон «Мобильный телефон» обяз пусто формат +7 (___) ___-__-__ "
                      "ошибка «Заполните поле»", lines)
        self.assertIn("[2054] список «Город» обяз пусто варианты: Москва | Казань (+79)", lines)
        self.assertIn("[2055] радио «Готовы к командировкам?» обяз варианты: [2055.1] Да | [2055.2] Нет", lines)
        self.assertIn("[2056] файл (pdf,doc,msword) «Резюме»", lines)
        self.assertIn("! Заполните поле «Мобильный телефон»", lines)
        self.assertIn("— прокрутка: выше 0,0 экрана, ниже 0,6", lines)
        self.assertNotIn("[конец страницы]", lines)

    def test_attrs_and_end_marker(self):
        data = page([field(1, "поле", "Индекс", attrs={"pattern": "[0-9]{6}", "maxlength": "6", "inputmode": "numeric",
                                                       "autocomplete": "postal-code"})])
        text = render_outline(data)
        self.assertIn("шаблон [0-9]{6} до 6 зн. цифры ac=postal-code", text)
        self.assertTrue(text.endswith("[конец страницы]"))

    def test_budget_drops_links_first_and_keeps_fields_and_submit(self):
        items = [el(i, "ссылка", f"Ссылка номер {i} в меню сайта") for i in range(1, 200)]
        items += [el(300 + i, "кнопка", f"Кнопка {i}") for i in range(30)]
        items += [{"t": "h", "text": "Заголовок", "rank": 0, "dist": 0, "core": False}]
        items += [field(1000 + i, "поле", f"Поле анкеты {i}") for i in range(10)]
        items += [el(2000, "кнопка", "Отправить отклик", core=True, submit=True)]
        text = render_outline(page(items), budget=1500)
        self.assertLessEqual(len(text), 1500)
        for i in range(10):
            self.assertIn(f"[{1000 + i}] поле", text)
        self.assertIn("[2000] кнопка «Отправить отклик»", text)
        self.assertIn("# Заголовок", text)            # заголовки режем после ссылок и кнопок
        self.assertIn("… ещё ", text)
        self.assertIn("элементов не показано", text)
        # ссылки ушли раньше кнопок
        self.assertLess(text.count("ссылка"), 199)
        n = int(text.split("… ещё ")[1].split()[0])
        shown = sum(1 for ln in text.split("\n") if ln.startswith("[") and "] " in ln)
        self.assertEqual(n + shown, 199 + 30 + 10 + 1)

    def test_far_from_screen_dropped_first(self):
        near = el(1, "ссылка", "Ближняя", rank=0, dist=0)
        far = el(2, "ссылка", "Дальняя " + "х" * 40, rank=1, dist=5000)
        text = render_outline(page([near, far]), budget=len("[начало страницы]\n[1] ссылка «Ближняя»\n[конец страницы]\n") + 40)
        self.assertIn("Ближняя", text)
        self.assertNotIn("Дальняя", text)

    def test_core_survives_tiny_budget(self):
        items = [field(i, "список", "Город", options=[{"idx": f"{i}.{k}", "text": "Вариант " + "я" * 30}
                                                       for k in range(8)], more=5) for i in range(1, 4)]
        text = render_outline(page(items), budget=200)
        for i in range(1, 4):
            self.assertIn(f"[{i}] список", text)       # поля не выкидываются даже сверх бюджета

    def test_hidden_counts_in_tail(self):
        text = render_outline(page([el(1, "ссылка", "а")], hidden={"above": 2, "below": 3, "limit": 1}))
        self.assertIn("… ещё 6 элементов не показано", text)

    def test_frame_inline_and_captcha(self):
        child = page([field("f7-3", "поле", "Имя", required=True, state="пусто")])
        data = page([
            {"t": "frame", "idx": "7", "key": "7", "host": "forms.example", "frame": child, "rank": 0, "dist": 0},
            {"t": "frame", "idx": "8", "key": "8", "host": "google.com", "captcha": True, "frame": None},
        ])
        text = render_outline(data)
        lines = text.split("\n")
        i = lines.index("— iframe forms.example")
        self.assertEqual(lines[i + 1], "[f7-3] поле «Имя» обяз пусто")
        self.assertIn("— iframe google.com: капча, решает кандидат", lines)
        self.assertEqual(known_indexes(data), {"f7-3"})

    def test_modal_and_scroll_in_modal(self):
        text = render_outline(page([field(1, "поле", "Имя")], modal=True,
                                   scroll={"where": "modal", "above": 0.5, "below": 1.2}))
        self.assertIn("— открыто диалоговое окно", text)
        self.assertIn("— прокрутка окна: выше 0,5 экрана, ниже 1,2", text)
        self.assertNotIn("[начало страницы]", text)

    def test_known_indexes_include_radio_options(self):
        data = page([field(16, "радио", "Опыт", options=[{"idx": "16.1", "text": "Да"}, {"idx": "16.2", "text": "Нет"}])])
        self.assertEqual(known_indexes(data), {"16", "16.1", "16.2"})
        self.assertEqual([i["idx"] for i in iter_items(data)], ["16"])


class _Rec:
    """Запоминает цепочку вызовов локатора."""

    def __init__(self, log=None):
        self.log = log if log is not None else []

    def frame_locator(self, sel):
        self.log.append(("frame", sel))
        return _Rec(self.log)

    def locator(self, sel):
        self.log.append(("locator", sel))
        return self

    @property
    def first(self):
        self.log.append(("first",))
        return self


class LocatorTest(unittest.TestCase):
    def test_plain_group_and_option(self):
        r = _Rec()
        locator_for(r, 7)
        self.assertEqual(r.log, [("locator", '[data-jt-idx="7"], [data-jt-group="7"]'), ("first",)])
        r = _Rec()
        locator_for(r, "16.2")
        self.assertEqual(r.log, [("locator", '[data-jt-idx="16.2"]'), ("first",)])

    def test_frames_chain(self):
        r = _Rec()
        locator_for(r, "f3-f1-5")
        self.assertEqual(r.log[:2], [("frame", '[data-jt-idx="3"]'), ("frame", '[data-jt-idx="1"]')])
        self.assertEqual(r.log[2], ("locator", '[data-jt-idx="5"], [data-jt-group="5"]'))

    def test_bad_idx_rejected(self):
        for bad in ("", "x", "f-3", '1"]', "1.", "f3-", "3 4", None):
            with self.assertRaises(AliceDomError, msg=repr(bad)):
                locator_for(_Rec(), bad)


# ---------------------------------------------------------------------------
# Живая страница
# ---------------------------------------------------------------------------

def _doc(body: str) -> str:
    return f'<!doctype html><meta charset="utf-8"><style>body{{margin:0;font:14px sans-serif}}</style>{body}'


MODAL = _doc("""
<header><a href="/jobs">Вакансии</a></header>
<form id="bg"><label>Фон-поле <input name="bg"></label><button type="submit">Фоновая кнопка</button></form>
<div role="dialog" aria-modal="true" style="position:fixed;left:50px;top:50px;width:500px;height:300px;background:#fff">
  <h2>Отклик на вакансию</h2>
  <form><label>Ваше имя <input name="n"></label><button type="submit">Отправить отклик</button></form>
</div>
""")

REACT = _doc("""
<div id="go" style="cursor:pointer;padding:10px;border:1px solid"><span>Откликнуться</span> <b>сейчас</b></div>
<div style="cursor:pointer" id="empty"></div>
<button id="real" disabled>Недоступная</button>
""")

SHADOW = _doc("""
<div id="host"></div>
<script>
  const r = document.getElementById('host').attachShadow({mode: 'open'});
  r.innerHTML = '<label>Телефон из компонента <input type="tel" name="ph"></label><button>Дальше в компоненте</button>';
</script>
""")

SELECT20 = _doc("<label>Город <select name='c' required><option value=''>Выберите</option>"
                + "".join(f"<option value='{i}'>Город-{i}</option>" for i in range(20)) + "</select></label>")

ERRORS = _doc("""
<div class="row"><label for="ph">Телефон *</label><input id="ph" name="phone" type="tel" aria-invalid="true">
  <div class="field-error">Укажите телефон в формате +7</div></div>
<div class="row"><label>Почта <input type="email" name="mail" required></label></div>
<div role="alert">Не удалось отправить форму</div>
""")

HIDDEN = _doc("""
<button style="display:none">Скрытая</button>
<button style="visibility:hidden">Невидимая</button>
<button style="opacity:0">Прозрачная</button>
<div aria-hidden="true"><button>Спрятанная</button></div>
<details><summary>Детали</summary><button>Внутри закрытых деталей</button></details>
<button>Видимая</button>
""")

COVERED = _doc("""
<button style="position:absolute;left:20px;top:20px;width:120px;height:40px">Под плашкой</button>
<div style="position:absolute;left:0;top:0;width:300px;height:100px;background:#ccc"></div>
<button style="position:absolute;left:20px;top:200px;width:120px;height:40px">На виду</button>
""")

IFRAME = _doc("""
<button>Снаружи</button>
<iframe style="width:400px;height:300px" srcdoc="<label>Имя в фрейме <input name='fn' required></label>
 <button type='submit'>Отправить во фрейме</button>"></iframe>
""")

MIXED = _doc("""
<form>
  <label>Дата рождения <input type="date" name="d" required></label>
  <label>Опыт <textarea name="t"></textarea></label>
  <fieldset><legend>Командировки</legend>
    <label><input type="radio" name="trip" value="y"> Да</label>
    <label><input type="radio" name="trip" value="n"> Нет</label></fieldset>
  <label><input type="checkbox" name="agree"> Согласен на обработку данных</label>
  <label>Резюме <input type="file" name="cv" accept=".pdf,.doc"></label>
  <input name="phone2" placeholder="+7 (___) ___-__-__" aria-label="Другой телефон">
  <input type="search" name="q" aria-label="Поиск по сайту">
  <button type="submit">Отправить</button>
</form>
""")

RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class AliceDomBrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def open(self, html):
        pg = self.browser.new_page(viewport={"width": 800, "height": 600})
        self.addCleanup(pg.close)
        pg.set_content(html)
        return pg

    @staticmethod
    def labels(data):
        return [i["label"] for i in iter_items(data)]

    def test_modal_narrows_scope(self):
        data = collect(self.open(MODAL))
        self.assertTrue(data["modal"])
        self.assertEqual(self.labels(data), ["Ваше имя", "Отправить отклик"])
        text = render_outline(data)
        self.assertNotIn("Фоновая кнопка", text)
        self.assertNotIn("Вакансии", text)
        self.assertIn("# Отклик на вакансию", text)

    def test_react_like_div_button(self):
        data = collect(self.open(REACT))
        items = list(iter_items(data))
        self.assertEqual(len(items), 1, items)          # вложенные span/b не плодят пунктов, пустой div и disabled — тоже
        self.assertEqual((items[0]["kind"], items[0]["label"]), ("кнопка", "Откликнуться сейчас"))

    def test_open_shadow_dom(self):
        pg = self.open(SHADOW)
        data = collect(pg)
        items = {i["label"]: i for i in iter_items(data)}
        self.assertEqual(items["Телефон из компонента"]["kind"], "поле-телефон")
        self.assertIn("Дальше в компоненте", items)
        loc = locator_for(pg, items["Телефон из компонента"]["idx"])
        loc.fill("+79991112233")
        self.assertEqual(loc.input_value(), "+79991112233")

    def test_select_with_20_options(self):
        data = collect(self.open(SELECT20))
        (sel,) = list(iter_items(data))
        self.assertEqual(sel["kind"], "список")
        self.assertTrue(sel["required"])
        self.assertEqual(sel["state"], "пусто")
        self.assertEqual(len(sel["options"]), 8)
        self.assertEqual(sel["more"], 12)
        self.assertEqual(sel["options"][0], "Город-0")
        self.assertIn("(+12)", render_outline(data))

    def test_required_and_error_next_to_field(self):
        data = collect(self.open(ERRORS))
        items = {i["label"]: i for i in iter_items(data)}
        ph = items["Телефон"]
        self.assertTrue(ph["required"])                      # «*» в подписи
        self.assertTrue(ph["invalid"])
        self.assertEqual(ph["error"], "Укажите телефон в формате +7")
        self.assertTrue(items["Почта"]["required"])
        self.assertEqual(items["Почта"]["kind"], "поле-почта")
        text = render_outline(data)
        self.assertIn("ошибка «Укажите телефон в формате +7»", text)
        self.assertIn("! Не удалось отправить форму", text)
        self.assertEqual(text.count("Укажите телефон"), 1)   # сообщение поля не дублируется строкой «!»

    def test_hidden_disabled_and_closed_details(self):
        data = collect(self.open(HIDDEN))
        self.assertEqual(self.labels(data), ["Детали", "Видимая"])

    def test_covered_element_dropped(self):
        data = collect(self.open(COVERED))
        self.assertEqual(self.labels(data), ["На виду"])

    def test_iframe_form(self):
        pg = self.open(IFRAME)
        pg.wait_for_function("document.querySelector('iframe').contentDocument.querySelector('input')")
        data = collect_all(pg)
        frame_items = [i for i in data["items"] if i["t"] == "frame"]
        self.assertEqual(len(frame_items), 1)
        inner = list(iter_items(frame_items[0]["frame"]))
        self.assertEqual([i["label"] for i in inner], ["Имя в фрейме", "Отправить во фрейме"])
        idx = inner[0]["idx"]
        self.assertRegex(idx, r"^f\d+-\d+$")
        text = render_outline(data)
        self.assertIn("— iframe", text)
        self.assertIn(f"[{idx}] поле «Имя в фрейме» обяз пусто", text)
        loc = locator_for(pg, idx)
        loc.fill("Анна")
        self.assertEqual(loc.input_value(), "Анна")
        self.assertIn(idx, known_indexes(data))

    def test_stable_numbers_and_new_marker(self):
        pg = self.open(MIXED)
        first = collect(pg)
        second = collect(pg)
        self.assertEqual([i["idx"] for i in iter_items(first)], [i["idx"] for i in iter_items(second)])
        self.assertFalse(any(i["new"] for i in iter_items(first)))      # первый снимок: «новым» не считаем
        self.assertFalse(any(i["new"] for i in iter_items(second)))
        pg.evaluate("""() => { const b = document.createElement('button'); b.textContent = 'Появилась позже';
            document.querySelector('form').after(b); }""")
        third = collect(pg)
        new = [i for i in iter_items(third) if i["new"]]
        self.assertEqual([i["label"] for i in new], ["Появилась позже"])
        self.assertTrue(render_outline(third).count("*[") == 1)
        old = {i["label"]: i["idx"] for i in iter_items(first)}
        self.assertEqual({i["label"]: i["idx"] for i in iter_items(third) if not i["new"]}, old)

    def test_kinds_state_format_groups(self):
        pg = self.open(MIXED)
        data = collect(pg)
        items = {i["label"]: i for i in iter_items(data)}
        self.assertNotIn("Поиск по сайту", items)                         # поиск — не анкета
        d = items["Дата рождения"]
        self.assertEqual((d["kind"], d["format"], d["required"]), ("поле-дата", "ГГГГ-ММ-ДД", True))
        self.assertEqual(items["Опыт"]["kind"], "текст")
        self.assertEqual(items["Другой телефон"]["format"], "+7 (___) ___-__-__")
        self.assertEqual(items["Другой телефон"]["state"], "пусто")
        cb = items["Согласен на обработку данных"]
        self.assertEqual((cb["kind"], cb["state"]), ("флажок", "пусто"))
        self.assertEqual(items["Резюме"]["attrs"]["accept"], ".pdf,.doc")
        grp = items["Командировки"]
        self.assertEqual(grp["kind"], "радио")
        self.assertEqual([o["text"] for o in grp["options"]], ["Да", "Нет"])
        self.assertRegex(grp["options"][0]["idx"], r"^\d+\.1$")
        self.assertTrue(items["Отправить"]["submit"])
        # клик по варианту радио через локатор
        locator_for(pg, grp["options"][1]["idx"]).check()
        self.assertEqual(pg.evaluate("document.querySelector('[name=trip]:checked').value"), "n")
        self.assertEqual({i["label"]: i for i in iter_items(collect(pg))}["Командировки"]["state"], "заполнено")
        # номер группы указывает на первый вариант
        self.assertEqual(locator_for(pg, grp["idx"]).get_attribute("value"), "y")

    def test_values_never_in_output(self):
        pg = self.open(MIXED + _doc("""
            <label>Фамилия <input name="ln"></label>
            <label>О себе <textarea name="about"></textarea></label>
            <div contenteditable="true" role="textbox" aria-label="Редактор"></div>
            <label>Пароль <input type="password"></label>"""))
        before = render_outline(collect(pg))
        pg.fill("[name=ln]", "Иванов")
        pg.fill("[name=about]", "ЧастныйТекстОСебе")
        pg.fill("[name=phone2]", "+79991234567")
        pg.fill("[name=d]", "1995-02-01")
        pg.fill("[type=password]", "СекретныйПароль")
        pg.fill("[contenteditable]", "ТекстВРедакторе")
        pg.check("[name=agree]")
        data = collect(pg)
        text = render_outline(data)
        blob = json.dumps(data, ensure_ascii=False) + text
        for bad in ("Иванов", "ЧастныйТекст", "79991234567", "1995-02-01", "СекретныйПароль", "ТекстВРедакторе"):
            self.assertNotIn(bad, blob, bad)
        items = {i["label"]: i for i in iter_items(data)}
        self.assertEqual(items["Фамилия"]["state"], "заполнено")
        self.assertEqual(items["О себе"]["state"], "заполнено")
        self.assertEqual(items["Другой телефон"]["state"], "заполнено")
        self.assertEqual(items["Редактор"]["state"], "заполнено")
        self.assertEqual(items["Согласен на обработку данных"]["state"], "отмечено")
        self.assertNotEqual(before, text)

    def test_limit_keeps_fields(self):
        links = "".join(f'<a href="/v{i}">Вакансия номер {i}</a><br>' for i in range(120))
        pg = self.open(_doc(links + MIXED))
        data = collect(pg, limit=12)
        labels = self.labels(data)
        for need in ("Дата рождения", "Опыт", "Отправить", "Резюме"):
            self.assertIn(need, labels)
        self.assertGreater(data["hidden"]["limit"] + data["hidden"]["below"], 0)
        text = render_outline(data, budget=900)
        self.assertLessEqual(len(text), 900)
        self.assertIn("[", text)
        self.assertIn("Отправить", text)

    def test_page_scroll_info(self):
        pg = self.open(_doc("<div style='height:2400px'></div><button>Низ</button>"))
        data = collect(pg)
        self.assertGreaterEqual(data["scroll"]["below"], 3)
        self.assertEqual(data["scroll"]["above"], 0)


if __name__ == "__main__":
    unittest.main()
