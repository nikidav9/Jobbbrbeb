import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripEmoji } from '../lib/stripEmoji.ts';

// Эмодзи в интерфейсе не используем (решение владельца 01.10.2026): плашка и
// колокольчик снимают их при показе, в том числе из текстов сервера.
test('эмодзи снимаются, текст остаётся', () => {
  assert.equal(stripEmoji('✅ Аккаунт удалён'), 'Аккаунт удалён');
  assert.equal(stripEmoji('🎉 🎉 Мэтч!'), 'Мэтч!');
  assert.equal(stripEmoji('Добро пожаловать! 👋'), 'Добро пожаловать!');
  assert.equal(stripEmoji('⚠️ Ошибка'), 'Ошибка');
  assert.equal(stripEmoji('💬 Анна'), 'Анна');
});

test('обычный текст не трогается', () => {
  assert.equal(stripEmoji('Отклик отправлен'), 'Отклик отправлен');
  assert.equal(stripEmoji('3 000 ₽ — «ёлочки», №5'), '3 000 ₽ — «ёлочки», №5');
});
