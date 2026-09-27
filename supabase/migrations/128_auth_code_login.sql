-- Вход по коду из письма, пароль — запасной (решение владельца 27.09.2026).
--
-- Код login — самостоятельная цель в jm_auth_codes: тот же выпуск и та же
-- сверка (php-proxy/auth_email.php), но db.php сразу выдаёт сессию, минуя
-- квитанцию — анкеты после кода нет.
--
-- Явные begin/commit: infra/migrate.sh гоняет psql БЕЗ --single-transaction.
begin;

alter table public.jm_auth_codes drop constraint if exists jm_auth_codes_purpose_check;
alter table public.jm_auth_codes
  add constraint jm_auth_codes_purpose_check check (purpose in ('register', 'attach', 'reset', 'login'));

commit;
