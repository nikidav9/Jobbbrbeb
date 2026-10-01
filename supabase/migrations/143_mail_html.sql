-- Письмо целиком (01.10.2026): «Почта JobToo» показывает письма как обычная
-- почта — с вёрсткой, ссылками и картинками. Текст (body) остаётся для
-- списка, поиска подтверждений отклика и писем без HTML.
-- Отдаётся только владельцу и только по одному письму (jupiterMailHtml).
alter table public.jm_jupiter_emails add column if not exists html text not null default '';
