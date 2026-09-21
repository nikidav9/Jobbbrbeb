-- Дополнительная минимизация личной анкеты, 21.09.2026.
-- Поля удалены из UI и TypeScript-модели; здесь удаляем уже сохранённые
-- значения из personal_data, чтобы прекращение обработки было фактическим.
update public.jm_users
set personal_data = personal_data
  - 'birthday'
  - 'emergencyContact'
  - 'veteranStatus'
  - 'gender'
  - 'pronouns'
  - 'race'
  - 'sexualOrientation'
  - 'professionalReferences'
  - 'militaryService'
  - 'securityClearance'
where personal_data ?| array[
  'birthday',
  'emergencyContact',
  'veteranStatus',
  'gender',
  'pronouns',
  'race',
  'sexualOrientation',
  'professionalReferences',
  'militaryService',
  'securityClearance'
];
