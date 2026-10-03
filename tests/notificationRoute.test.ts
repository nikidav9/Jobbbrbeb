import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeForNotification, routeByTitle, routeForRefreshPush } from '../services/notificationRoute.ts';

// Колокольчик: уведомления, которые раньше никуда не вели (аудит 01.10.2026).
test('ответ поддержки ведёт в поддержку', () => {
  assert.deepEqual(routeForNotification('support'), { pathname: '/support' });
  assert.deepEqual(routeByTitle('🆘 Ответ поддержки'), { pathname: '/support' });
});

test('«Кандидаты ждут» и автоотказ ведут в «Отклики»', () => {
  assert.deepEqual(routeForNotification('pending_apps'), { pathname: '/(tabs)/matches' });
  assert.deepEqual(routeForNotification('app_auto_rejected'), { pathname: '/(tabs)/matches' });
  // Старые записи без type — по заголовку.
  assert.deepEqual(routeByTitle('⏳ Кандидаты ждут ответа'), { pathname: '/(tabs)/matches' });
  assert.deepEqual(routeByTitle('Отклик закрыт без ответа'), { pathname: '/(tabs)/matches' });
});

test('пуш ведёт туда же, куда колокольчик', () => {
  assert.deepEqual(
    routeForRefreshPush([{ title: '🆘 Ответ поддержки', is_read: false, type: 'support' }]),
    { pathname: '/support' },
  );
});

// Каждому виду пуша из таблицы JT_PUSH_EVENTS (php-proxy/push_privacy.php)
// соответствует экран по нажатию. Иначе пуш объясняет, зачем открыть
// приложение, а нажатие никуда не ведёт (жалоба владельца 03.10.2026).
test('у каждого вида пуша из таблицы сервера есть маршрут по нажатию', async () => {
  const { readFileSync } = await import('node:fs');
  const php = readFileSync(new URL('../php-proxy/push_privacy.php', import.meta.url), 'utf8');
  const block = php.slice(php.indexOf('const JT_PUSH_EVENTS'));
  const keys = [...block.slice(0, block.indexOf('];')).matchAll(/^\s*'([a-z_]+)'\s*=>/gm)].map(m => m[1]);
  assert.ok(keys.length >= 15, `в таблице найдено видов: ${keys.length}`);
  for (const type of keys) {
    assert.notEqual(routeForNotification(type, {}), null, `нет маршрута для вида «${type}»`);
  }
});

test('нажатие на пуш с видом «сообщение» без чата открывает список чатов', () => {
  assert.deepEqual(routeForNotification('message', {}), { pathname: '/(tabs)/chats' });
});
