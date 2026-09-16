import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/086_aviasales_company_label.sql', import.meta.url), 'utf8');
const parser = readFileSync(new URL('../php-proxy/career_feed.php', import.meta.url), 'utf8');

test('старые вакансии Авиасейлс не создают отдельные компании по названию команды', () => {
  assert.match(migration, /set company = 'Авиасейлс'/);
  assert.match(migration, /source_id = 'career'/);
  assert.match(migration, /https:\/\/www\.aviasales\.ru\/about\/vacancies\/%/);
  assert.match(migration, /https:\/\/aviasales\.ru\/about\/vacancies\/%/);
  assert.match(migration, /company is distinct from 'Авиасейлс'/);
});

test('company_const в карьерном JSON остаётся сильнее поля команды из ответа', () => {
  const dynamicCompany = parser.indexOf("foreach (['company' => 'company'");
  const constantCompany = parser.indexOf("$const = trim((string)($map['company_const'] ?? ''))");
  const constantAssignment = parser.indexOf("if ($const !== '') $item['company'] = $const;");

  assert.notEqual(dynamicCompany, -1);
  assert.notEqual(constantCompany, -1);
  assert.notEqual(constantAssignment, -1);
  assert.ok(dynamicCompany < constantCompany, 'company_const должен применяться после поля company из ответа');
  assert.ok(constantCompany < constantAssignment, 'после чтения company_const он должен записываться в company');
});
