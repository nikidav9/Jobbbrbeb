// Масштаб в приложении зафиксирован: ни браузер сам, ни человек пальцами.
// Решение владельца 25.09. Четыре слоя, потому что iOS Safari с 10-й версии
// игнорирует user-scalable=no: без touch-action и перехвата жестов щипок
// там по-прежнему приближает экран.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../app/+html.tsx', import.meta.url), 'utf8');

test('viewport запрещает масштаб', () => {
  const vp = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';
  for (const part of ['minimum-scale=1', 'maximum-scale=1', 'user-scalable=no']) {
    assert.ok(vp.includes(part), `в viewport нет ${part}: ${vp}`);
  }
});

test('touch-action оставляет только прокрутку', () => {
  assert.match(html, /html, body \{[^}]*touch-action: pan-x pan-y;/);
});

test('жесты iOS, второй палец и щипок тачпада перехвачены', () => {
  assert.match(html, /'gesturestart', 'gesturechange', 'gestureend'/);
  assert.match(html, /e\.touches && e\.touches\.length > 1\) e\.preventDefault\(\)/);
  assert.match(html, /if \(e\.ctrlKey\) e\.preventDefault\(\)/);
  assert.equal((html.match(/passive: false/g) ?? []).length, 3);
});
