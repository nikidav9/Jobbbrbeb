-- Отклик — через телефон (решение владельца 28.09.2026). Серверный Юпитер
-- больше не отправляет анкеты сам: свайп копит заявку в «Нужны вы»
-- (state action_required, reason_code PHONE_FILL — jupiterEnqueue в db.php),
-- а анкету заполняет автопилот во встроенном браузере, «Отправить» жмёт
-- человек.
--
-- Заявки, которые уже ждали сервер (queued, ready_to_submit,
-- retryable_failed) или стояли с «автоотклик выключен»
-- (LIVE_AUTHORIZATION_REVOKED — такие автопилот не брал), переводим туда же, чтобы у всех была одна схема и ничего
-- не висело «в работе». Взятые воркером прямо сейчас (lease_owner не пуст) не
-- трогаем: он доведёт их и отпустит. Отправленные не трогаем.
--
-- Явные begin/commit: infra/migrate.sh гоняет psql БЕЗ --single-transaction.
begin;

update public.jm_jupiter_applications
   set state = 'action_required',
       reason_code = 'PHONE_FILL',
       submission_authorized_at = null,
       not_before = null,
       updated_at = now()
 where (state in ('queued', 'ready_to_submit', 'retryable_failed')
        or (state = 'action_required' and reason_code = 'LIVE_AUTHORIZATION_REVOKED'))
   and lease_owner is null;

commit;
