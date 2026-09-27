// Пустая колода при включённых фильтрах (жалоба 26.09: «выбрал Лавку — ничего
// не показывает, и фильтра больше нет»). Шестерёнка живёт в ряду под
// карточкой; карточек нет — нет и её. Пустой экран обязан сам вести к
// фильтрам и уметь их сбросить, иначе человек заперт до перезапуска.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(import.meta.dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const empty = src.slice(src.indexOf('{!swTop ? ('), src.indexOf(') : swTop._ext ? ('));

test('пустой экран при фильтрах ведёт в фильтры и сбрасывает их', () => {
  assert.ok(empty.length > 0, 'пустое состояние ленты не найдено');
  assert.match(empty, /permFiltersActive \? \(/);
  assert.match(empty, /testID="empty-edit-filters"[\s\S]*?|onPress=\{\(\) => setPermFilterOpen\(true\)\}/);
  assert.match(empty, /onPress=\{\(\) => setPermFilterOpen\(true\)\}/);
  assert.match(empty, /applyPermFilters\(EMPTY_PERM_FILTERS\)/);
});

test('без фильтров пустой экран не просит «изменить фильтры»', () => {
  assert.doesNotMatch(empty, /'Попробуйте изменить фильтры'/);
});

test('шторка и сброс применяют фильтры одной функцией', () => {
  assert.match(src, /onApply=\{applyPermFilters\}/);
});

test('в списке компаний только те, чьи вакансии колода может показать', () => {
  const memo = src.slice(src.indexOf('const permCompanyOptions = useMemo'), src.indexOf('// Вакансии для карты'));
  assert.match(memo, /sectionOfPerm\(v\.workType\) === 'it'/);
  assert.match(memo, /!permSwiped\.has\(v\.id\)/);
});
