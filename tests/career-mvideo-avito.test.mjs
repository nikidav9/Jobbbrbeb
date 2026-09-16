import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/089_mvideo_avito.sql', import.meta.url), 'utf8');

test('М.Видео и Авито читаются ссылками со страницы', () => {
  assert.match(migration, /career\.mvideoeldorado\.ru\/vacancies/);
  assert.match(migration, /career\.avito\.com\/vacancies/);
  assert.equal((migration.match(/'mode', 'html_links'/g) ?? []).length, 2);
});

test('у каждого источника задано постоянное название компании', () => {
  assert.match(migration, /'company_const', 'М\.Видео-Эльдорадо'/);
  assert.match(migration, /'company_const', 'Авито'/);
});

// Прежние миграции перезаписывали весь connector_config целиком, и каждая такая
// перезапись — шанс потерять то, что добавила соседняя. Здесь дописываем.
test('настройка дополняется, а не переписывается целиком', () => {
  assert.match(migration, /\(connector_config->'endpoints'\) \|\| jsonb_build_array/);
  assert.doesNotMatch(migration, /set connector_config = '\{/);
});

// Миграции на проде прогоняются скриптом, который может запуститься повторно.
test('повторный прогон не задваивает источники', () => {
  assert.match(migration, /and not exists \(/);
  assert.match(migration, /e->>'url' = 'https:\/\/career\.mvideoeldorado\.ru\/vacancies'/);
});

test('правка идёт одной транзакцией', () => {
  assert.equal((migration.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((migration.match(/^commit;$/gm) ?? []).length, 1);
});
