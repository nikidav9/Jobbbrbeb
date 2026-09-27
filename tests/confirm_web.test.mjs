// Вопросы «да/нет» — только через services/confirm.ts (27.09).
//
// В веб-сборке (сайт и мини-приложение в Телеграме) Alert.alert из
// react-native-web — пустышка: «Удалить резюме» и «Удалить переписку» на
// сайте молча не работали. window.confirm давал серое окно браузера, а в
// части клиентов Телеграма — ничего. Сторож не даёт вернуть ни то, ни другое.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const OWN = path.join('services', 'confirm.ts');

function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

const files = ['app', 'components', 'services', 'hooks']
  .flatMap(sources)
  .filter(f => f !== OWN);
// Комментарии не в счёт: в них эти имена объясняют, почему их нет.
const code = f => fs.readFileSync(path.join(root, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('window.confirm нигде, кроме services/confirm.ts', () => {
  const bad = files.filter(f => /window\.confirm\s*\(/.test(code(f)));
  assert.deepEqual(bad, []);
});

test('Alert.alert нигде, кроме services/confirm.ts', () => {
  const bad = files.filter(f => /Alert\.alert\s*\(/.test(code(f)));
  assert.deepEqual(bad, []);
});

// Одна кнопка стирала всех пользователей, кроме админа (решение 27.09).
test('в админке нет массового удаления пользователей', () => {
  const admin = code(path.join('app', 'admin.tsx'));
  assert.doesNotMatch(admin, /deleteAllUsersExceptAdmin|Удалить всех/);
});

test('окно вопросов смонтировано в корне для веба', () => {
  const layout = fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8');
  assert.match(layout, /Platform\.OS === 'web' \? <ConfirmHost \/> : null/);
});
