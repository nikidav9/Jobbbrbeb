-- Приглашения: «устроился на работу» вместо «вышел на смену».
--
-- Решение владельца: подработка закрыта (смены больше не создаются), поэтому
-- поручительство теперь записывается, когда работодатель перевёл отклик
-- приглашённого в статус «Нанят». Итог 'worked' и 'no_show' остаются: старые
-- записи о сменах живут и считаются.
--
-- Уникальный индекс по invitee_id (миграция 064) не трогаем: один приглашённый
-- по-прежнему даёт ровно одну строку в журнале, что бы с ним ни случилось.

alter table public.jm_referral_rewards
  drop constraint if exists jm_referral_rewards_outcome_check;
alter table public.jm_referral_rewards
  add constraint jm_referral_rewards_outcome_check
  check (outcome in ('worked', 'no_show', 'hired'));

notify pgrst, 'reload schema';
