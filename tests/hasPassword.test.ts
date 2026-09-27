import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

// services/db.ts тянет react-native/AsyncStorage/expo-secure-store и не
// импортируется напрямую в обычном node — та же оговорка, что у остальных
// тестов этого набора (см. missingUsersRetry.test.ts, notificationReadTruth.test.ts).
// Проверяем исходник: rowToUser должен прокидывать has_password с сервера,
// не выдумывая значение, когда его нет (старый кэш/ответ без поля).
const dbts = readFileSync(resolve(process.cwd(), 'services/db.ts'), 'utf8');
const types = readFileSync(resolve(process.cwd(), 'constants/types.ts'), 'utf8');

function block(source: string, start: string, end: string): string {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  return a >= 0 && b > a ? source.slice(a, b) : '';
}

test('rowToUser прокидывает hasPassword с сервера', () => {
  const rowToUser = block(dbts, 'function rowToUser(r: any): User {', 'function userToRow(u: User)');
  assert.ok(rowToUser, 'rowToUser не найден');
  assert.ok(rowToUser.includes("hasPassword: typeof r.has_password === 'boolean' ? r.has_password : undefined,"));
});

test('rowToUser не читает и не пробрасывает сам хеш пароля с сервера в hasPassword', () => {
  const rowToUser = block(dbts, 'function rowToUser(r: any): User {', 'function userToRow(u: User)');
  // Единственное чтение пароля в rowToUser — старое клиентское поле password
  // (участвует в самой регистрации, а не в ответах сервера); значение
  // hasPassword должно приходить только из вычисленного сервером has_password.
  assert.ok(!rowToUser.includes('hasPassword: r.password'));
});

test('User.hasPassword — необязательное булево поле', () => {
  assert.ok(types.includes('hasPassword?: boolean;'));
});
