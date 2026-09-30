#!/usr/bin/env python3
"""Нестандартные поля SPA на синтетических виджетах, без сети.

Div-список с role=option (вариант в самом виджете и вариант с порталом в
body), маска телефона +7 (___) ___-__-__ и маска даты. Нужен Playwright и
Chromium (JUPITER_CHROMIUM); без них тесты пропускаются.
"""
from __future__ import annotations

import os
import unittest
from pathlib import Path

from engine import _SemanticParser

try:
    from playwright.sync_api import sync_playwright
    from browser_custom_controls import (
        CLONE_HOOK_JS, apply_custom_select, discover_custom_selects, fill_masked,
    )
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)
RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")

PAGE = """<!doctype html><meta charset="utf-8">
<label id="cl">Город</label>
<div id="city" role="combobox" aria-labelledby="cl" aria-expanded="false" tabindex="0"
     style="border:1px solid #000;width:200px">Выберите</div>
<div id="citylist" role="listbox" style="display:none">
  <div role="option">Москва</div><div role="option">Санкт-Петербург</div>
  <div role="option" aria-disabled="true">Казань</div>
</div>
<div id="grade" role="combobox" aria-label="Уровень" tabindex="0" style="width:200px">Не выбран</div>
<input id="phone" type="tel" aria-label="Телефон">
<input id="dob" aria-label="Дата рождения">
<script>
const city = document.getElementById('city'), list = document.getElementById('citylist');
city.setAttribute('aria-controls', 'citylist');
city.addEventListener('click', () => { list.style.display = list.style.display === 'none' ? 'block' : 'none'; });
list.querySelectorAll('[role=option]').forEach(o => o.addEventListener('click', () => {
  if (o.getAttribute('aria-disabled') === 'true') return;
  city.textContent = o.textContent; list.style.display = 'none';
}));
// Второй список рисуется порталом в конец body и не связан атрибутами.
const grade = document.getElementById('grade');
grade.addEventListener('click', () => {
  if (document.getElementById('portal')) return;
  const p = document.createElement('div'); p.id = 'portal'; p.setAttribute('role', 'listbox');
  for (const t of ['Junior', 'Middle', 'Senior']) {
    const o = document.createElement('div'); o.setAttribute('role', 'option'); o.textContent = t;
    o.addEventListener('click', () => { grade.textContent = t; p.remove(); });
    p.appendChild(o);
  }
  document.body.appendChild(p);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('portal')?.remove(); });
// Маска телефона: +7 (999) 123-45-67; на фокусе подставляет «+7 (».
const ph = document.getElementById('phone');
ph.addEventListener('focus', () => { if (!ph.value) ph.value = '+7 ('; });
ph.addEventListener('input', () => {
  let d = ph.value.replace(/\\D/g, '');
  if (d[0] === '7' || d[0] === '8') d = d.slice(1);
  d = d.slice(0, 10);
  let out = '+7 (' + d.slice(0, 3);
  if (d.length >= 3) out += ') ' + d.slice(3, 6);
  if (d.length >= 6) out += '-' + d.slice(6, 8);
  if (d.length >= 8) out += '-' + d.slice(8, 10);
  ph.value = out;
});
// Маска даты дд.мм.гггг.
const dob = document.getElementById('dob');
dob.addEventListener('input', () => {
  const d = dob.value.replace(/\\D/g, '').slice(0, 8);
  dob.value = d.slice(0, 2) + (d.length > 2 ? '.' + d.slice(2, 4) : '') + (d.length > 4 ? '.' + d.slice(4) : '');
});
</script>"""


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class CustomControlsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.page.set_content(PAGE)
        self.addCleanup(self.page.close)

    def test_discover_collects_options_and_closes_lists(self):
        found = {c.name: c for c in discover_custom_selects(self.page)}
        self.assertEqual(set(found), {"city", "grade"})
        self.assertEqual(found["city"].label, "Город")
        self.assertEqual([o.text for o in found["city"].options],
                         ["Москва", "Санкт-Петербург", "Казань"])
        self.assertTrue(found["city"].options[2].disabled)
        self.assertEqual([o.text for o in found["grade"].options], ["Junior", "Middle", "Senior"])
        self.assertEqual(found["grade"].label, "Уровень")
        # Всё закрыто, значения не менялись.
        self.assertFalse(self.page.locator("#citylist").is_visible())
        self.assertEqual(self.page.locator("#portal").count(), 0)
        self.assertEqual(self.page.locator("#city").inner_text(), "Выберите")

    def test_clone_hook_makes_synthetic_select_for_parser(self):
        specs = [c.as_dict() for c in discover_custom_selects(self.page)]
        html = self.page.evaluate(
            "([hook, specs]) => { document.querySelectorAll('[data-jt-cs]').forEach((e, i) =>"
            " e.setAttribute('data-jt-ref', 'w' + i));"
            " const c = document.documentElement.cloneNode(true);"
            " eval('(' + hook + ')')(c, specs); return c.outerHTML; }",
            [CLONE_HOOK_JS, specs],
        )
        self.assertIn("data-jt-custom", html)
        parser = _SemanticParser("http://x/")
        parser.feed(html)
        parser.close()
        page = parser.finish(html, 200, {})
        selects = [c for c in page.controls if c.tag == "select"]
        self.assertEqual(len(selects), 2)
        city = next(c for c in selects if c.name == "city")
        self.assertEqual([o.label for o in city.options if o.value], ["Москва", "Санкт-Петербург"])
        self.assertTrue(city.dom_ref)

    def test_apply_inline_list(self):
        discover_custom_selects(self.page)
        self.page.evaluate("document.querySelectorAll('[data-jt-cs]').forEach(e => e.setAttribute('data-jt-ref', e.id))")
        self.assertTrue(apply_custom_select(self.page, "city", "санкт петербург".replace(" ", "-")))
        self.assertEqual(self.page.locator("#city").inner_text(), "Санкт-Петербург")

    def test_apply_portal_list_by_substring(self):
        discover_custom_selects(self.page)
        self.page.evaluate("document.querySelectorAll('[data-jt-cs]').forEach(e => e.setAttribute('data-jt-ref', e.id))")
        self.assertTrue(apply_custom_select(self.page, "grade", "senior"))
        self.assertEqual(self.page.locator("#grade").inner_text(), "Senior")

    def test_apply_unknown_option_changes_nothing(self):
        discover_custom_selects(self.page)
        self.page.evaluate("document.querySelectorAll('[data-jt-cs]').forEach(e => e.setAttribute('data-jt-ref', e.id))")
        self.assertFalse(apply_custom_select(self.page, "grade", "Архитектор"))
        self.assertEqual(self.page.locator("#grade").inner_text(), "Не выбран")
        self.assertEqual(self.page.locator("#portal").count(), 0)

    def test_apply_headless_combobox_via_arrow_button(self):
        # job.mts.ru (01.10.2026): Headless UI — поле role=combobox и рядом
        # пустая кнопка-стрелка aria-haspopup=listbox. Выбор виден в поле, а
        # не в кнопке; раньше Юпитер считал, что город не выбрался, и
        # прерывал отправку ещё до нажатия «Отправить».
        self.page.set_content("""<!doctype html><meta charset="utf-8">
<div role="group"><label>Город</label>
<div class="h-combobox"><input id="cityinput" role="combobox" placeholder="Не выбран" value="">
<button id="arrow" type="button" aria-haspopup="listbox" aria-label="Город"><svg></svg></button></div></div>
<script>
const inp = document.getElementById('cityinput'), btn = document.getElementById('arrow');
btn.addEventListener('click', () => {
  if (document.getElementById('opts')) { document.getElementById('opts').remove(); return; }
  const ul = document.createElement('ul'); ul.id = 'opts'; ul.setAttribute('role', 'listbox');
  for (const t of ['Москва', 'Санкт-Петербург']) {
    const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = t;
    li.addEventListener('click', () => { inp.value = t; ul.remove(); });
    ul.appendChild(li);
  }
  btn.parentElement.appendChild(ul);
});
</script>""")
        discover_custom_selects(self.page)
        self.page.evaluate("document.querySelectorAll('[data-jt-cs]').forEach(e => e.setAttribute('data-jt-ref', e.id))")
        self.assertTrue(apply_custom_select(self.page, "arrow", "Москва"))
        self.assertEqual(self.page.locator("#cityinput").input_value(), "Москва")

    def test_phone_mask_with_country_code(self):
        loc = self.page.locator("#phone")
        self.assertTrue(fill_masked(self.page, loc, "+7 999 123-45-67"))
        self.assertEqual(loc.input_value(), "+7 (999) 123-45-67")

    def test_phone_mask_from_eight_and_refill(self):
        loc = self.page.locator("#phone")
        self.assertTrue(fill_masked(self.page, loc, "89001112233"))
        self.assertTrue(fill_masked(self.page, loc, "9991234567"))
        self.assertEqual(loc.input_value(), "+7 (999) 123-45-67")

    def test_date_mask(self):
        loc = self.page.locator("#dob")
        self.assertTrue(fill_masked(self.page, loc, "15.03.1990"))
        self.assertEqual(loc.input_value(), "15.03.1990")

    def test_mask_mismatch_is_reported(self):
        loc = self.page.locator("#dob")
        self.assertFalse(fill_masked(self.page, loc, "15.03.199090"))


if __name__ == "__main__":
    unittest.main()
