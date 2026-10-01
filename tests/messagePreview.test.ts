import assert from 'node:assert/strict';
import test from 'node:test';

import { messagePreview, voiceOf } from '../services/messagePreview.ts';

test('messagePreview replaces attachment payloads with safe labels', () => {
  assert.equal(messagePreview('[img]https://example.test/private.jpg'), 'Фото');
  assert.equal(messagePreview('[voice]https://example.test/private.ogg|12'), 'Голосовое сообщение');
});

test('messagePreview keeps text and handles empty values', () => {
  assert.equal(messagePreview('Добрый день'), 'Добрый день');
  assert.equal(messagePreview(null), '');
});

test('voiceOf parses duration and defaults invalid values to zero', () => {
  assert.deepEqual(voiceOf('[voice]https://example.test/a.ogg|8'), {
    url: 'https://example.test/a.ogg',
    sec: 8,
  });
  assert.equal(voiceOf('[voice]https://example.test/a.ogg|bad').sec, 0);
});
