import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMailLinks, linkLabel } from '../services/mailLinks.ts';

test('кнопка письма становится ссылкой, текст вокруг сохраняется', () => {
  const parts = splitMailLinks('Заполните анкету (https://pulse.sber.ru/form?id=1). Спасибо');
  assert.deepEqual(parts, [
    { text: 'Заполните анкету (' },
    { text: 'https://pulse.sber.ru/form?id=1', url: 'https://pulse.sber.ru/form?id=1' },
    { text: '). Спасибо' },
  ]);
});

test('точка в конце предложения не входит в адрес', () => {
  const parts = splitMailLinks('Смотрите https://x.example/a.');
  assert.equal(parts[1].url, 'https://x.example/a');
  assert.equal(parts[2].text, '.');
});

test('длинный адрес показывается коротко, но ведёт на полный', () => {
  const url = 'https://click.mail.example.com/track?u=' + 'a'.repeat(80);
  const [part] = splitMailLinks(url);
  assert.equal(part.url, url);
  assert.equal(part.text, 'click.mail.example.com/…');
  assert.equal(linkLabel('https://a.ru/b'), 'https://a.ru/b');
});

test('без ссылок — один кусок; javascript: ссылкой не считается', () => {
  assert.deepEqual(splitMailLinks('Привет'), [{ text: 'Привет' }]);
  assert.equal(splitMailLinks('javascript:alert(1)').some(p => p.url), false);
});

import { senderName, mailPreview, mailDate } from '../services/mailLinks.ts';

test('в списке — имя отправителя без адреса', () => {
  assert.equal(senderName('Платформа «Пульс» <hrplatform@sberbank.ru>'), 'Платформа «Пульс»');
  assert.equal(senderName('"HR Team" <hr@x.ru>'), 'HR Team');
  assert.equal(senderName('<hr@x.ru>'), 'hr@x.ru');
});

test('начало письма — одной строкой', () => {
  assert.equal(mailPreview('Код для входа\n\n   …\n'), 'Код для входа …');
});

test('дата как в почте', () => {
  const now = new Date(2026, 8, 25, 12, 0);
  assert.match(mailDate(new Date(2026, 8, 25, 10, 18).toISOString(), now), /^10:18$/);
  assert.doesNotMatch(mailDate(new Date(2026, 8, 20, 10, 18).toISOString(), now), /:/);
  assert.match(mailDate(new Date(2025, 0, 2).toISOString(), now), /2025/);
  assert.equal(mailDate('мусор', now), '');
});
