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
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}::jsonb`;
  if (value === null || value === undefined) return `'null'::jsonb`;
  return `to_jsonb(${sqlString(value)}::text)`;
}
