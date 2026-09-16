/**
 * Печать JSON в SQL — чистые функции без сети и файлов.
 *
 * Отделено по тому же правилу, что и career-discover-lib: решение «как это
 * ляжет в миграцию» должно проверяться на выдуманных данных. Ошибка здесь —
 * не падение, а миграция, которая молча запишет не то.
 */

/** Строка для SQL: одинарные кавычки удваиваются, ничего больше не нужно. */
export function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** jsonb_build_object(...) из обычного объекта — рекурсивно. */
export function jsonbLiteral(value) {
  if (Array.isArray(value)) {
    return `jsonb_build_array(${value.map(jsonbLiteral).join(', ')})`;
  }
  if (value && typeof value === 'object') {
    const pairs = Object.entries(value).flatMap(([k, v]) => [sqlString(k), jsonbLiteral(v)]);
    return pairs.length ? `jsonb_build_object(${pairs.join(', ')})` : `'{}'::jsonb`;
  }
  // Именно to_jsonb, а не приведение типом: `false::jsonb` и `8::jsonb`
  // Postgres не принимает вовсе — «cannot cast type boolean to jsonb».
  // Поймано прогоном миграции на пустой базе, до продакшена.
  if (typeof value === 'number' || typeof value === 'boolean') return `to_jsonb(${value})`;
  if (value === null || value === undefined) return `'null'::jsonb`;
  return `to_jsonb(${sqlString(value)}::text)`;
}

/**
 * Имя работодателя для карточки.
 *
 * В списке целей у шести компаний по два раздела, и различаются они хвостом
 * после « · »: «Золотое Яблоко · /», «Яндекс · /jobs/vacancies». Хвост —
 * пометка для нас, а не название компании. Без очистки он уехал бы прямо в
 * карточку вакансии и в фильтр «Компания», где одна компания стала бы двумя.
 */
export function companyName(target) {
  return String(target || '').split(' · ')[0].trim();
}
