"""Отклик письмом: Юпитер находит HR-почту компании (п.4, 01.10.2026)."""
from __future__ import annotations

import unittest

from agent import CandidateProfile, JupiterAgent, Reason
from email_apply import find_hr_email, registrable
from site_compat import _recon_ready
from submission import ReceiptStore

URL = "https://career.sibur.ru/vacancies"


class Finder(unittest.TestCase):
    def test_hr_box_on_company_domain(self):
        html = '<a href="mailto:rabota@sibur.ru">rabota@sibur.ru</a> <a href="mailto:press@sibur.ru">пресса</a>'
        self.assertEqual(find_hr_email(html, "Пишите нам", URL), "rabota@sibur.ru")

    def test_foreign_domains_are_never_taken(self):
        html = '<a href="mailto:hr.89633242887@gmail.com">hr</a> Резюме присылайте на hr@agency.ru'
        self.assertIsNone(find_hr_email(html, "Резюме присылайте на hr@agency.ru", URL))

    def test_generic_box_needs_resume_words_nearby(self):
        menu = '<a href="mailto:info@sibur.ru">info@sibur.ru</a>'
        self.assertIsNone(find_hr_email(menu, "Карьера · Контакты · info@sibur.ru", URL))
        text = "Присылайте резюме на info@sibur.ru — ответим за неделю"
        self.assertEqual(find_hr_email("", text, URL), "info@sibur.ru")

    def test_service_boxes_skipped_and_hr_preferred(self):
        text = "Резюме: noreply@sibur.ru, support@sibur.ru, anna@sibur.ru или job@sibur.ru"
        self.assertEqual(find_hr_email("", text, URL), "job@sibur.ru")

    def test_registrable(self):
        self.assertEqual(registrable("career.sibur.ru"), "sibur.ru")
        self.assertEqual(registrable("job.x.com.ru"), "x.com.ru")


class AgentResultTest(unittest.TestCase):
    def test_no_form_with_hr_email_is_email_apply(self):
        agent = JupiterAgent({"career.sibur.ru"}, dry_run=True, receipts=ReceiptStore(None))
        html = ("<html><body><h1>Вакансии</h1><p>Резюме присылайте на "
                '<a href="mailto:rabota@sibur.ru">rabota@sibur.ru</a></p></body></html>')
        result = agent.run_loaded_html(html, URL, CandidateProfile(values={"email": "a@b.ru"}))
        self.assertEqual((result.status, result.reason_code), ("action_required", Reason.EMAIL_APPLY))
        self.assertEqual(result.email_to, "rabota@sibur.ru")
        self.assertEqual(result.as_dict()["email_to"], "rabota@sibur.ru")

    def test_no_form_no_email_stays_not_found(self):
        agent = JupiterAgent({"career.sibur.ru"}, dry_run=True, receipts=ReceiptStore(None))
        result = agent.run_loaded_html("<html><body><h1>Вакансии</h1></body></html>", URL,
                                       CandidateProfile(values={}))
        self.assertEqual(result.reason_code, Reason.VACANCY_NOT_FOUND)
        self.assertIsNone(result.email_to)

    def test_recon_counts_email_site_as_connected(self):
        self.assertTrue(_recon_ready({"klass": "no_vacancy", "status": "action_required",
                                      "reason_code": "EMAIL_APPLY"}))

    def test_recon_counts_human_captcha_as_connected(self):
        def item(**captcha):
            return {"klass": "captcha", "status": "action_required", "captcha": captcha}
        # Слово с картинки и нажатия (галочка, сетка картинок) решает человек.
        self.assertTrue(_recon_ready(item(kind="text_image", transferable=True, tappable=False)))
        self.assertTrue(_recon_ready(item(kind="checkbox", transferable=False, tappable=True)))
        self.assertTrue(_recon_ready(item(kind="image_grid", transferable=False, tappable=True)))
        # Невидимая и неопознанная капча — показать человеку нечего.
        self.assertFalse(_recon_ready(item(kind="invisible", transferable=False, tappable=False)))
        self.assertFalse(_recon_ready(item(kind="unknown", transferable=False, tappable=False)))
        # Отчёт старого формата (без tappable) не открывает сайт.
        self.assertFalse(_recon_ready(item(kind="checkbox", transferable=False)))


if __name__ == "__main__":
    unittest.main()
