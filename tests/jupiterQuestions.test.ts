import assert from 'node:assert/strict';
import test from 'node:test';
import { dateAfter, usableDraft } from '../services/jupiterQuestions.ts';

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
