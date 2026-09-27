// Пустая колода при включённых фильтрах (жалоба 26.09: «выбрал Лавку — ничего
// не показывает, и фильтра больше нет»). С 27.09.2026 шестерёнки и общей
// шторки нет вовсе — вместо них полоса чипов, всегда видимая, даже когда
// карточек нет. Пустой экран при фильтрах обязан сам предложить сброс.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(import.meta.dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const empty = src.slice(src.indexOf('{!swTop ? ('), src.indexOf(') : swTop._ext ? ('));

test('пустой экран при фильтрах сам сбрасывает их', () => {
  assert.ok(empty.length > 0, 'пустое состояние ленты не найдено');
  assert.match(empty, /permFiltersActive \? \(/);
  assert.match(empty, /testID="empty-reset-filters"/);
  assert.match(empty, /onPress=\{\(\) => applyFilters\(EMPTY_FEED_FILTERS\)\}/);
});

test('«изменить фильтры» из пустого экрана убрано — полоса чипов уже на экране', () => {
  assert.doesNotMatch(empty, /testID="empty-edit-filters"/);
  assert.doesNotMatch(empty, /'Попробуйте изменить фильтры'/);
});

test('полоса чипов рисуется и при пустой, и при загружающейся колоде', () => {
  // FilterChipsBar стоит раньше ветки {!swTop ? (...)} в разметке — то есть
  // до раннего выхода из-под колоды, а не внутри одной из её веток.
  const beforeEmpty = src.slice(0, src.indexOf('{!swTop ? ('));
  assert.match(beforeEmpty, /<FilterChipsBar/);
  assert.match(beforeEmpty, /testID="feed-total"/);
});

test('подпись «Всего N» прячется у пустой недогружающейся колоды — иначе спорит с «ничего не нашлось»', () => {
  const beforeEmpty = src.slice(0, src.indexOf('{!swTop ? ('));
  assert.match(beforeEmpty, /\(swTop \|\| careerLoading\) \? \(/);
});

test('шторка и сброс применяют фильтры одной функцией', () => {
  assert.match(src, /onApply=\{applyFilters\}/);
});

test('в списке компаний только те, чьи вакансии колода может показать', () => {
  const memo = src.slice(src.indexOf('const ownCompanyCounts = useMemo'), src.indexOf('const permCompanyOptions = useMemo'));
  assert.match(memo, /sectionOfPerm\(v\.workType\) === 'it'/);
  assert.match(memo, /!permSwiped\.has\(v\.id\)/);
});
