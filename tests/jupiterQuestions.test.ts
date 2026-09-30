import assert from 'node:assert/strict';
import test from 'node:test';
import { dateAfter, questionTitle, usableDraft } from '../services/jupiterQuestions.ts';
import { routeForNotification } from '../services/notificationRoute.ts';

test('дата выхода — в формате, который Юпитер вводит и в поле даты, и в текст', () => {
  const from = new Date(2026, 8, 30);
  assert.equal(dateAfter(0, from), '30.09.2026');
  assert.equal(dateAfter(14, from), '14.10.2026');
  assert.equal(dateAfter(30, from), '30.10.2026');
});

test('черновик списка — только если такой вариант есть на сайте', () => {
  const options = [{ value: 'hh', label: 'hh.ru' }, { value: 'f', label: 'От друзей' }];
  assert.equal(usableDraft({ type: 'choice', options, draft: 'От друзей' }), 'От друзей');
  assert.equal(usableDraft({ type: 'choice', options, draft: 'Из рекламы' }), '');
  assert.equal(usableDraft({ type: 'text', options: [], draft: '  @nikita ' }), '@nikita');
  assert.equal(usableDraft({ type: 'text', options: [], draft: null }), '');
});

test('пуш о вопросах ведёт в очередь вопросов, об ушедшем отклике — в «Отклики»', () => {
  assert.deepEqual(routeForNotification('jupiter_questions'), { pathname: '/jupiter-questions' });
  assert.deepEqual(routeForNotification('jupiter_sent'), { pathname: '/(tabs)/matches' });
});

test('заголовок вопроса: понятный текст от YandexGPT, иначе подпись без крика заглавными', () => {
  assert.equal(questionTitle({ question: 'КОМПАНИЯ', display: 'В какой компании вы сейчас работаете?' }),
    'В какой компании вы сейчас работаете?');
  assert.equal(questionTitle({ question: 'КОМПАНИЯ' }), 'Компания');
  assert.equal(questionTitle({ question: 'Ваш Telegram', display: null }), 'Ваш Telegram');
  assert.equal(questionTitle({ question: 'HR', display: '' }), 'HR');
});
