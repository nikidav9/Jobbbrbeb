-- Поле disabilityStatus удалено из профиля 21.09.2026.
-- Удаляем и уже сохранённые значения из приватной JSON-анкеты, чтобы
-- прекращение сбора было фактическим, а не только визуальным.
update public.jm_users
set personal_data = personal_data - 'disabilityStatus'
where personal_data ? 'disabilityStatus';
