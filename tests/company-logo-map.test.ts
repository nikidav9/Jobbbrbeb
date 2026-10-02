import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Сам модуль тянет AsyncStorage и сеть, поэтому проверяем чистые правила:
// ключ компании должен совпадать с серверным jt_company_logo_key.
function companyLogoKey(name?: string | null): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

test('ключ компании как на сервере: регистр и пробелы', () => {
  assert.equal(companyLogoKey('  Альфа-Банк \t '), 'альфа-банк');
  assert.equal(companyLogoKey('Яндекс   Крауд'), 'яндекс крауд');
  assert.equal(companyLogoKey(null), '');
});

test('правило ключа в модуле не разошлось с тестом', () => {
  const src = readFileSync('services/companyLogoMap.ts', 'utf8');
  assert.ok(src.includes(".trim().replace(/\\s+/g, ' ').toLowerCase()"));
  // Логотип из базы главнее встроенного, встроенный — главнее инициалов.
  const mark = readFileSync('components/ui/CompanyMark.tsx', 'utf8');
  assert.ok(/remote \? \{ uri: remote \} : companyLogo\(name\)/.test(mark));
});
