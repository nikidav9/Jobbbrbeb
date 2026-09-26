// Единая кнопка «назад» (решение владельца 26.09): components/ui/BackButton.
//
// До этого на двадцати экранах жило пять разных вариантов — «← Назад»
// текстом, стрелки 20–27 pt, символ «‹». Сторож не даёт вернуть их: новый
// экран берёт BackButton, а не рисует свою стрелку.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const OWN = path.join('components', 'ui', 'BackButton.tsx');

function tsxFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(rel));
    else if (e.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

const files = [...tsxFiles('app'), ...tsxFiles('components')].filter(f => f !== OWN);

test('своих стрелок «назад» на экранах нет', () => {
  const OLD = [
    [/name="(?:chevron-back|arrow-back)"/, 'иконка chevron-back/arrow-back'],
    [/← Назад/, 'текст «← Назад»'],
    [/>\s*[‹←]\s*</, 'символ ‹ или ← вместо кнопки'],
  ];
  const found = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const [re, what] of OLD) if (re.test(src)) found.push(`${f}: ${what}`);
  }
  assert.deepEqual(found, [], 'используйте components/ui/BackButton');
});

test('кнопка: круг 44 pt, подпись для читалок, выход при пустой истории', () => {
  const src = fs.readFileSync(path.join(root, OWN), 'utf8');
  assert.match(src, /BACK_BUTTON_SIZE = rs\(44\)/);
  assert.match(src, /accessibilityLabel=\{label\}/);
  assert.match(src, /label = 'Назад'/);
  // Открыли по прямой ссылке — назад некуда: router.back() молчит, уводим на главную.
  assert.match(src, /if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\(fallback\);/);
});

test('кнопкой пользуются экраны, где она была своя', () => {
  const must = [
    'app/legal.tsx', 'app/perm-vacancy-detail.tsx', 'app/chat-room.tsx', 'app/profile-settings.tsx',
    'app/register-worker.tsx', 'app/register-employer.tsx', 'app/saved.tsx', 'app/(tabs)/chats.tsx',
    'components/feature/MetroPicker.tsx',
  ];
  for (const f of must) {
    assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /<BackButton\b/, f);
  }
});
