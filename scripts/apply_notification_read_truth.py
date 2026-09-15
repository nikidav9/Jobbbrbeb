#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one anchor, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'contexts/AppContext.tsx',
    """  const markNotifRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    await dbMarkNotifRead(id).catch(() => {});
  }, []);

  const markAllNotifsRead = useCallback(async () => {
    const user = await getSessionUser();
    if (!user) return;
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    await dbMarkAllNotifsRead(user.id).catch(() => {});
  }, []);
""",
    """  const markNotifRead = useCallback(async (id: string) => {
    // Глобальный badge меняем только после подтверждения сервера. Иначе при
    // обрыве связи уведомление оставалось unread в БД, но исчезало из счётчика
    // до следующего успешного refresh.
    await dbMarkNotifRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  }, []);

  const markAllNotifsRead = useCallback(async () => {
    const user = await getSessionUser();
    if (!user) return;
    await dbMarkAllNotifsRead(user.id);
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  }, []);
""",
)

replace_once(
    'components/ui/NotifBell.tsx',
    """  async function handleMarkAll() {
    if (!userId) return;
    try {
      await dbMarkAllNotifsRead(userId);
      setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
      app?.markAllNotifsRead?.();
    } catch {
      app?.showToast?.('Не удалось отметить уведомления прочитанными', 'error');
    }
  }
""",
    """  async function handleMarkAll() {
    if (!userId) return;
    try {
      // Один серверный запрос — через контекст, чтобы локальный список и
      // глобальный badge переходили в read после одного и того же commit.
      const op = app?.markAllNotifsRead
        ? app.markAllNotifsRead()
        : dbMarkAllNotifsRead(userId);
      await op;
      setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch {
      app?.showToast?.('Не удалось отметить уведомления прочитанными', 'error');
    }
  }
""",
)

replace_once(
    'components/ui/NotifBell.tsx',
    """    if (!n.isRead) {
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      app?.markNotifRead?.(n.id);
      void dbMarkNotifRead(n.id).catch(() => {
        setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: false } : x));
        app?.refreshNotifications?.();
      });
    }
""",
    """    if (!n.isRead) {
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      // Навигацию не ждём, но серверный write теперь ровно один. Контекст
      // обновит глобальный badge только после успеха; при отказе локальный
      // optimistic state откатываем.
      const markPromise = app?.markNotifRead
        ? app.markNotifRead(n.id)
        : dbMarkNotifRead(n.id);
      void markPromise.catch(() => {
        setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: false } : x));
        void app?.refreshNotifications?.();
      });
    }
""",
)

(ROOT / 'tests/notificationReadTruth.test.ts').write_text("""import assert from 'node:assert/strict';
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
""", encoding='utf-8')

print('notification read truth patch applied')
