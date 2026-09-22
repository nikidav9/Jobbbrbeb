#!/usr/bin/env python3
"""Семантика HTML-формы и проверка ограничений — без сети.

Отдельно от test_e2e.py намеренно: здесь не нужен сервер, и это самые
дешёвые тесты в наборе. Ломаются они тише всего: разбор формы не падает,
он просто начинает отдавать не те поля.
"""
from __future__ import annotations

import unittest

from engine import JupiterWebEngine
from validation import validate_form


def parse(html: str, url: str = "http://127.0.0.1/apply"):
    engine = JupiterWebEngine({"127.0.0.1"}, read_only=True)
    return engine.load_html(html, url)


def control(page, name: str):
    return next(c for c in page.controls if c.name == name)


class BaseHref(unittest.TestCase):
    def test_relative_action_resolves_against_base(self):
        page = parse(
            '<base href="http://127.0.0.1/careers/apply/">'
            '<form action="send" method="post"><input name="a"></form>',
            "http://127.0.0.1/careers/vacancy",
        )
        self.assertEqual(page.base_url, "http://127.0.0.1/careers/apply/")
        self.assertEqual(
            page.resolve(page.forms[0].action),
            "http://127.0.0.1/careers/apply/send",
        )

    def test_without_base_the_page_url_still_wins(self):
        page = parse(
            '<form action="send" method="post"><input name="a"></form>',
            "http://127.0.0.1/careers/vacancy",
        )
        self.assertEqual(page.resolve(page.forms[0].action), "http://127.0.0.1/careers/send")


class FieldsetDisabled(unittest.TestCase):
    HTML = """
    <form action="/s" method="post">
      <fieldset><legend>Контакты</legend>
        <label>Почта <input name="email" required></label>
      </fieldset>
      <fieldset disabled><legend>Для водителей</legend>
        <label>Категория <input name="licence" required></label>
      </fieldset>
      <button type="submit">Отправить</button>
    </form>
    """

    def test_controls_inside_disabled_fieldset_are_disabled(self):
        page = parse(self.HTML)
        self.assertFalse(control(page, "email").disabled)
        licence = control(page, "licence")
        self.assertTrue(licence.disabled)
        self.assertTrue(licence.disabled_by_fieldset)

    def test_legend_becomes_section_hint(self):
        page = parse(self.HTML)
        self.assertEqual(control(page, "email").section, "Контакты")
        self.assertEqual(control(page, "licence").section, "Для водителей")

    def test_disabled_fieldset_is_not_required_and_is_not_submitted(self):
        page = parse(self.HTML)
        control(page, "email").value = "a@b.ru"
        issues = validate_form(page, page.forms[0])
        self.assertEqual(issues, [])

        fields, _files = JupiterWebEngine._successful_controls(
            page, page.forms[0], None
        )
        self.assertNotIn("licence", [name for name, _ in fields])


class SelectSemantics(unittest.TestCase):
    def test_multiple_select_serializes_every_selected_option(self):
        page = parse(
            '<form action="/s" method="post">'
            '<select name="shifts" multiple>'
            '<option value="day" selected>День</option>'
            '<option value="night" selected>Ночь</option>'
            '<option value="mixed">Смешанный</option>'
            "</select></form>"
        )
        fields, _ = JupiterWebEngine._successful_controls(page, page.forms[0], None)
        self.assertEqual(
            [value for name, value in fields if name == "shifts"],
            ["day", "night"],
        )

    def test_single_select_defaults_to_first_option_like_a_browser(self):
        page = parse(
            '<form action="/s" method="post">'
            '<select name="city"><option value="msk">Москва</option>'
            '<option value="spb">Питер</option></select></form>'
        )
        self.assertEqual(control(page, "city").value, "msk")

    def test_multiple_select_stays_empty_without_an_explicit_choice(self):
        page = parse(
            '<form action="/s" method="post">'
            '<select name="skills" multiple>'
            '<option value="a">A</option><option value="b">B</option>'
            "</select></form>"
        )
        fields, _ = JupiterWebEngine._successful_controls(page, page.forms[0], None)
        self.assertEqual([v for n, v in fields if n == "skills"], [])

    def test_disabled_placeholder_option_is_visible_to_the_planner(self):
        page = parse(
            '<form action="/s" method="post">'
            '<select name="role" required>'
            '<option value="" disabled selected>Выберите</option>'
            '<option value="cashier">Кассир</option>'
            "</select></form>"
        )
        options = control(page, "role").options
        self.assertTrue(options[0].disabled)
        self.assertFalse(options[1].disabled)


class SubmitterOverrides(unittest.TestCase):
    HTML = """
    <form action="/draft" method="post">
      <input name="email" value="a@b.ru">
      <button type="submit" name="act" value="draft">Сохранить</button>
      <button type="submit" name="act" value="apply"
              formaction="/apply-now" formmethod="post">Откликнуться</button>
    </form>
    """

    def test_formaction_is_parsed(self):
        page = parse(self.HTML)
        apply_button = next(c for c in page.controls if c.value == "apply")
        self.assertEqual(apply_button.formaction, "/apply-now")
        self.assertEqual(apply_button.formmethod, "post")

    def test_only_the_pressed_button_is_submitted(self):
        page = parse(self.HTML)
        apply_button = next(c for c in page.controls if c.value == "apply")
        fields, _ = JupiterWebEngine._successful_controls(
            page, page.forms[0], apply_button
        )
        self.assertIn(("act", "apply"), fields)
        self.assertNotIn(("act", "draft"), fields)


class ImageSubmit(unittest.TestCase):
    def test_image_button_sends_coordinates(self):
        page = parse(
            '<form action="/s" method="post">'
            '<input name="email" value="a@b.ru">'
            '<input type="image" name="go" src="/go.png">'
            "</form>"
        )
        image = control(page, "go")
        fields, _ = JupiterWebEngine._successful_controls(page, page.forms[0], image)
        self.assertIn(("go.x", "0"), fields)
        self.assertIn(("go.y", "0"), fields)


class ReadonlyControls(unittest.TestCase):
    def test_readonly_is_parsed_and_still_submitted(self):
        page = parse(
            '<form action="/s" method="post">'
            '<input name="source" value="jobtoo" readonly></form>'
        )
        self.assertTrue(control(page, "source").readonly)
        fields, _ = JupiterWebEngine._successful_controls(page, page.forms[0], None)
        self.assertIn(("source", "jobtoo"), fields)


class Constraints(unittest.TestCase):
    def issues(self, html: str, **values):
        page = parse(html)
        for name, value in values.items():
            control(page, name).value = value
        return validate_form(page, page.forms[0])

    def test_pattern_must_match_the_whole_value(self):
        html = (
            '<form action="/s" method="post">'
            r'<input name="phone" pattern="\+7[0-9]{10}"></form>'
        )
        self.assertEqual(self.issues(html, phone="+79990000000"), [])
        bad = self.issues(html, phone="8 999 000 00 00")
        self.assertEqual([i.rule for i in bad], ["pattern"])
        # Кусок строки не должен проходить: браузер якорит pattern целиком.
        tail = self.issues(html, phone="тел: +79990000000")
        self.assertEqual([i.rule for i in tail], ["pattern"])

    def test_broken_pattern_on_the_page_is_ignored_not_fatal(self):
        html = '<form action="/s" method="post"><input name="x" pattern="[("></form>'
        self.assertEqual(self.issues(html, x="whatever"), [])

    def test_minlength_and_maxlength(self):
        html = (
            '<form action="/s" method="post">'
            '<textarea name="about" minlength="10" maxlength="20"></textarea></form>'
        )
        self.assertEqual([i.rule for i in self.issues(html, about="коротко")], ["minlength"])
        self.assertEqual(self.issues(html, about="ровно столько нужно"), [])
        self.assertEqual(
            [i.rule for i in self.issues(html, about="это уже значительно длиннее лимита")],
            ["maxlength"],
        )

    def test_number_range_and_step(self):
        html = (
            '<form action="/s" method="post">'
            '<input type="number" name="years" min="0" max="40" step="1"></form>'
        )
        self.assertEqual(self.issues(html, years="4"), [])
        self.assertEqual([i.rule for i in self.issues(html, years="41")], ["max"])
        self.assertEqual([i.rule for i in self.issues(html, years="-1")], ["min"])
        self.assertEqual([i.rule for i in self.issues(html, years="2.5")], ["step"])
        self.assertEqual([i.rule for i in self.issues(html, years="abc")], ["type-number"])

    def test_date_min_max(self):
        html = (
            '<form action="/s" method="post">'
            '<input type="date" name="start" min="2026-01-01" max="2026-12-31"></form>'
        )
        self.assertEqual(self.issues(html, start="2026-05-09"), [])
        self.assertEqual([i.rule for i in self.issues(html, start="2025-05-09")], ["min"])

    def test_email_and_url_types(self):
        html = (
            '<form action="/s" method="post">'
            '<input type="email" name="mail"><input type="url" name="site"></form>'
        )
        self.assertEqual(self.issues(html, mail="a@b.ru", site="https://b.ru"), [])
        self.assertEqual([i.rule for i in self.issues(html, mail="a-b-ru")], ["type-email"])
        self.assertEqual([i.rule for i in self.issues(html, site="b.ru")], ["type-url"])

    def test_required_radio_group_is_one_issue_not_three(self):
        page = parse(
            '<form action="/s" method="post">'
            '<input type="radio" name="shift" value="day" required>'
            '<input type="radio" name="shift" value="night" required>'
            '<input type="radio" name="shift" value="mixed" required>'
            "</form>"
        )
        issues = validate_form(page, page.forms[0])
        self.assertEqual([i.rule for i in issues], ["required"])
        control(page, "shift").checked = True
        self.assertEqual(validate_form(page, page.forms[0]), [])

    def test_novalidate_turns_the_whole_check_off(self):
        page = parse(
            '<form action="/s" method="post" novalidate>'
            '<input name="mail" type="email" value="broken"></form>'
        )
        self.assertEqual(validate_form(page, page.forms[0]), [])

    def test_formnovalidate_on_the_pressed_button_turns_it_off(self):
        page = parse(
            '<form action="/s" method="post">'
            '<input name="mail" type="email" value="broken">'
            '<button type="submit" formnovalidate>Сохранить</button>'
            '<button type="submit">Отправить</button></form>'
        )
        draft, apply_button = [c for c in page.controls if c.tag == "button"]
        self.assertEqual(validate_form(page, page.forms[0], draft), [])
        self.assertEqual(
            [i.rule for i in validate_form(page, page.forms[0], apply_button)],
            ["type-email"],
        )

    def test_empty_optional_field_is_not_an_issue(self):
        html = '<form action="/s" method="post"><input type="email" name="mail"></form>'
        self.assertEqual(self.issues(html), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
