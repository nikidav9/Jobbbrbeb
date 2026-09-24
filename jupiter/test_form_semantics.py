#!/usr/bin/env python3
"""Семантика HTML-формы и проверка ограничений — без сети.

Отдельно от test_e2e.py намеренно: здесь не нужен сервер, и это самые
дешёвые тесты в наборе. Ломаются они тише всего: разбор формы не падает,
он просто начинает отдавать не те поля.
"""
from __future__ import annotations

import unittest

from agent import CandidateProfile, JupiterAgent, choose_key, is_application_form
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


class SubmitIntent(unittest.TestCase):
    """Слова, по которым «Далее» отличается от «Отправить».

    Список короткий и должен таким остаться: чем он шире, тем выше шанс
    объявить настоящую кнопку отправки промежуточной и никогда не подать
    отклик.
    """

    def intent(self, text: str) -> str:
        from engine import ControlState
        return JupiterAgent.submit_intent(
            ControlState(index=0, form_index=0, tag="button", type="submit", text=text)
        )

    def test_next_and_apply_are_told_apart(self):
        for text in ("Далее", "Продолжить", "Next step", "Дальше"):
            self.assertEqual(self.intent(text), "next", text)
        for text in ("Откликнуться", "Отправить заявку", "Submit", "Готово"):
            self.assertEqual(self.intent(text), "apply", text)

    def test_save_and_back_are_neither(self):
        self.assertEqual(self.intent("Назад"), "back")
        self.assertEqual(self.intent("Сохранить черновик"), "save")

    def test_save_and_continue_is_a_step_not_a_draft(self):
        # Сплошь и рядом на анкетах: сохранение — побочное действие кнопки,
        # а смысл её — перейти дальше.
        self.assertEqual(self.intent("Сохранить и продолжить"), "next")

    def test_apply_button_outranks_next_and_next_outranks_back(self):
        from engine import ControlState

        def button(text):
            return ControlState(
                index=0, form_index=0, tag="button", type="submit", text=text
            )

        apply_score = JupiterAgent._submit_score(button("Откликнуться"))
        next_score = JupiterAgent._submit_score(button("Далее"))
        back_score = JupiterAgent._submit_score(button("Назад"))
        self.assertGreater(apply_score, next_score)
        self.assertGreater(next_score, back_score)


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


class ApplicationFormSelection(unittest.TestCase):
    """is_application_form: анкета кандидата против соседних форм сайта.

    Разведка живых сайтов (19 разделов) показала, что агент путал с анкетой
    фильтр вакансий, подписку на рассылку и форму «порекомендуй знакомого» —
    все они формально набирают очки скоринга не хуже настоящей анкеты.
    """

    def test_name_and_phone_is_an_application_form(self):
        page = parse(
            '<form action="/apply" method="post">'
            '<input name="full_name" required>'
            '<input name="phone" type="tel" required>'
            '<button type="submit">Откликнуться</button>'
            "</form>"
        )
        self.assertTrue(is_application_form(page, 0))

    def test_phone_and_birth_date_is_an_application_form(self):
        page = parse(
            '<form action="/apply" method="post">'
            '<input name="phone" type="tel">'
            '<input name="birth_date" type="date">'
            "</form>"
        )
        self.assertTrue(is_application_form(page, 0))

    def test_vacancy_filter_is_not_an_application_form(self):
        page = parse(
            '<form action="/search" method="get">'
            '<select name="city"><option value="msk">Москва</option></select>'
            '<input type="checkbox" name="remote" value="1">'
            '<button type="submit">Найти</button>'
            "</form>"
        )
        self.assertFalse(is_application_form(page, 0))

    def test_newsletter_subscription_is_not_an_application_form(self):
        page = parse(
            '<form action="/subscribe" method="post">'
            '<input name="subscribe" type="text">'
            '<input name="email" type="email">'
            '<button type="submit">Подписаться</button>'
            "</form>"
        )
        self.assertFalse(is_application_form(page, 0))

    def test_client_lead_form_with_required_company_and_inn_is_not_an_application_form(self):
        page = parse(
            '<form action="/lead" method="post">'
            '<input name="company" required placeholder="Компания">'
            '<input name="inn" required placeholder="ИНН">'
            '<input name="phone" type="tel" required>'
            '<button type="submit">Отправить</button>'
            "</form>"
        )
        self.assertFalse(is_application_form(page, 0))

    def test_refer_a_friend_form_is_not_an_application_form(self):
        page = parse(
            '<form action="/refer" method="post">'
            '<input name="referrer_name">'
            '<input name="referrer_phone" type="tel">'
            '<input name="name">'
            '<input name="phone" type="tel">'
            '<button type="submit">Порекомендовать</button>'
            "</form>"
        )
        self.assertFalse(is_application_form(page, 0))

    def test_subscribe_checkbox_does_not_disqualify_a_real_application(self):
        page = parse(
            '<form action="/apply" method="post">'
            '<input name="phone" type="tel">'
            '<label><input type="checkbox" name="subscribe" value="1"> '
            "Подписаться на новости</label>"
            '<button type="submit">Откликнуться</button>'
            "</form>"
        )
        self.assertTrue(is_application_form(page, 0))

    def test_require_contact_false_accepts_a_step_without_contact_fields(self):
        # Поздний шаг уже распознанной анкеты: контакт был на первом экране
        # визарда, здесь его по делу нет.
        page = parse(
            '<form action="/wizard-submit" method="post">'
            '<textarea name="motivation" required></textarea>'
            '<button type="submit">Отправить заявку</button>'
            "</form>"
        )
        self.assertFalse(is_application_form(page, 0))
        self.assertTrue(is_application_form(page, 0, require_contact=False))

    def test_require_contact_false_still_rejects_a_refer_a_friend_form(self):
        # Дисквалификаторы действуют независимо от require_contact: это не
        # про отсутствие контакта, а про то, что форма — чужая.
        page = parse(
            '<form action="/refer" method="post">'
            '<input name="referrer_name">'
            '<input name="referrer_phone" type="tel">'
            '<input name="name">'
            '<input name="phone" type="tel">'
            '<button type="submit">Порекомендовать</button>'
            "</form>"
        )
        self.assertFalse(is_application_form(page, 0, require_contact=False))

    def test_dry_run_does_not_report_ready_to_submit_for_a_subscription_only_page(self):
        # Тот самый случай из разведки: единственная форма на странице —
        # подписка с полем email name=subscribe. Анкеты нет вовсе, и агент
        # обязан пойти по пути «анкета не найдена», а не подать чужую форму.
        html = (
            '<form action="/subscribe" method="post">'
            '<input name="subscribe" type="email" placeholder="Ваша почта">'
            '<button type="submit">Подписаться</button>'
            "</form>"
        )
        profile = CandidateProfile(values={
            "email": "candidate@example.com",
            "phone": "+79990000000",
        })
        agent = JupiterAgent({"127.0.0.1"}, dry_run=True)
        result = agent.run_loaded_html(html, "http://127.0.0.1/careers", profile)
        self.assertNotEqual(result.status, "ready_to_submit")
        self.assertNotEqual(result.status, "submitted")



class FieldMeaning(unittest.TestCase):
    """Что вписать в поле. Ошибки отсюда нашла разведка живых сайтов 24.09."""

    PROFILE = CandidateProfile(values={
        "first_name": "Иван", "last_name": "Петров", "patronymic": "Сергеевич",
        "email": "i@example.com", "phone": "+79990000000", "city": "Москва",
        "education": "Высшее", "desired_role": "Продавец-кассир",
    })

    def key_for(self, field_html: str) -> str | None:
        page = parse(f"<form method=post>{field_html}<button>Отправить</button></form>")
        control = next(c for c in page.controls if c.type not in {"submit"} and c.tag != "button")
        return choose_key(control, self.PROFILE, "https://employer.example/job")

    def test_label_with_several_name_parts_means_full_name(self):
        # 1С, Cloud.ru, ITG: раньше уходили только отчество или только фамилия.
        self.assertEqual(self.key_for('<label>Фамилия имя и отчество * <input name="fio"></label>'), "full_name")
        self.assertEqual(self.key_for('<label>Фамилия и Имя <input name="text"></label>'), "full_name")
        self.assertEqual(self.key_for('<label>Имя, фамилия* <input name="name"></label>'), "full_name")
        self.assertEqual(self.key_for('<label>Фамилия <input name="surname"></label>'), "last_name")

    def test_inner_field_name_wins_over_section(self):
        # Agima: VACANCY[NAME] получал желаемую должность вместо имени.
        self.assertEqual(self.key_for('<label>Имя <input name="VACANCY[NAME]"></label>'), "first_name")
        self.assertEqual(self.key_for('<label>Телефон <input name="VACANCY[PHONE]"></label>'), "phone")

    def test_work_and_education_history_is_never_invented(self):
        # Петрович: «Высшее» уходило в год окончания и учебное заведение,
        # желаемая должность — в должность на прошлом месте работы.
        self.assertIsNone(self.key_for('<label>ваш ответ <input name="EDUCATION[YEAR][]"></label>'))
        self.assertIsNone(self.key_for('<label>ваш ответ <input name="EDUCATION[BUILDING][]"></label>'))
        self.assertIsNone(self.key_for('<label>Должность <input name="WORK[POSITION][]"></label>'))
        self.assertIsNone(self.key_for('<label>Город <input name="WORK[CITY][]"></label>'))
        self.assertEqual(self.key_for('<label>Уровень <input name="EDUCATION[LEVEL][]"></label>'), "education")



class ValueFitsField(unittest.TestCase):
    """Значение профиля в записи, которую поле примет."""

    def fill(self, html: str, values: dict) -> dict:
        page = parse(f"<form method=post>{html}<button>Отправить</button></form>")
        agent = JupiterAgent({"127.0.0.1"}, dry_run=True)
        profile = CandidateProfile(values=dict(values))
        for c in page.controls:
            if c.tag != "button":
                agent.fill_control(page, c, profile, [])
        return {c.name: (c.value, c.checked) for c in page.controls if c.name}

    def test_phone_follows_digits_only_pattern(self):
        # Macroscop: pattern="[0-9]*" отвергал «+7…» ещё до отправки.
        got = self.fill('<label>Телефон <input name="phone" pattern="[0-9]*"></label>', {"phone": "+79001234567"})
        self.assertEqual(got["phone"][0], "79001234567")

    def test_phone_follows_maxlength(self):
        got = self.fill('<label>Телефон <input name="phone" maxlength="10"></label>', {"phone": "+7 900 123-45-67"})
        self.assertEqual(got["phone"][0], "9001234567")  # тот же номер, 10 цифр

    def test_phone_without_constraints_is_untouched(self):
        got = self.fill('<label>Телефон <input name="phone"></label>', {"phone": "+79001234567"})
        self.assertEqual(got["phone"][0], "+79001234567")

    def test_russia_matches_russian_federation_option(self):
        # Норникель: вариант «Российская Федерация», в профиле «Россия».
        got = self.fill(
            '<label>Гражданство <select name="citizenship"><option value="">—</option>'
            '<option value="rf">Российская Федерация</option><option value="by">Беларусь</option></select></label>',
            {"citizenship": "Россия"},
        )
        self.assertEqual(got["citizenship"][0], "rf")


if __name__ == "__main__":
    unittest.main(verbosity=2)
