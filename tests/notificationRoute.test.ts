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
