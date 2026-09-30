-- Вопросы от работодателей: понятная формулировка и пояснение (01.10.2026,
-- решение владельца — «максимально используй ИИ от Яндекса, чтобы вопрос был
-- понятен»). question_text остаётся подписью поля на сайте: по ней ключ и
-- подстановка ответа. question_display и question_hint пишет YandexGPT в
-- воркере Юпитера; модель видит только страницу работодателя.
alter table public.jm_jupiter_questions
  add column if not exists question_display text,
  add column if not exists question_hint text;
