import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const context = readFileSync(resolve(process.cwd(), 'contexts/AppContext.tsx'), 'utf8');
const bell = readFileSync(resolve(process.cwd(), 'components/ui/NotifBell.tsx'), 'utf8');

function block(source: string, start: string, end: string): string {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  return a >= 0 && b > a ? source.slice(a, b) : '';
}

test('global read state changes only after server confirmation', () => {
  const one = block(context, '  const markNotifRead =', '  const markAllNotifsRead =');
  const all = block(context, '  const markAllNotifsRead =', '  const [permSavedIds');
  assert.ok(one.indexOf('await dbMarkNotifRead(id);') >= 0);
  assert.ok(one.indexOf('setNotifications') > one.indexOf('await dbMarkNotifRead(id);'));
  assert.ok(!one.includes('.catch(() => {})'));
  assert.ok(all.indexOf('await dbMarkAllNotifsRead(user.id);') >= 0);
  assert.ok(all.indexOf('setNotifications') > all.indexOf('await dbMarkAllNotifsRead(user.id);'));
  assert.ok(!all.includes('.catch(() => {})'));
});

test('notification tap performs one read operation and rolls back local UI on failure', () => {
  const tap = block(bell, '  async function handleTap', '  async function handleDelete');
  assert.ok(tap.includes('const markPromise = app?.markNotifRead'));
  assert.equal((tap.match(/dbMarkNotifRead\(n\.id\)/g) ?? []).length, 1); // fallback only
  assert.ok(tap.includes('void markPromise.catch(() => {'));
  assert.ok(tap.includes('{ ...x, isRead: false }'));
});

test('mark-all uses the context operation instead of a duplicate second request', () => {
  const markAll = block(bell, '  async function handleMarkAll', '  /** Чат с этим человеком');
  assert.ok(markAll.includes('app.markAllNotifsRead()'));
  assert.equal((markAll.match(/dbMarkAllNotifsRead\(userId\)/g) ?? []).length, 1); // fallback only
  assert.ok(markAll.indexOf('setNotifs') > markAll.indexOf('await op;'));
});
