-- Удаление аккаунта кодом из письма (01.10.2026, решение владельца): цель
-- delete в jm_auth_codes. Код выпускается только на подтверждённую почту
-- аккаунта из сессии (dbAuthSendCode) и предъявляется в dbDeleteAccountByCode.
alter table public.jm_auth_codes drop constraint if exists jm_auth_codes_purpose_check;
alter table public.jm_auth_codes
  add constraint jm_auth_codes_purpose_check
  check (purpose in ('register', 'attach', 'reset', 'login', 'delete'));
