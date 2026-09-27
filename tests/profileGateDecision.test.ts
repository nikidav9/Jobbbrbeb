import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideProfileGateStep } from '../services/profileGateDecision.ts';

// Окно первого отклика (решение владельца 27.09.2026, как у getmatch):
// нет резюме — выбор способа завести профиль; резюме есть, а имени нет —
// сразу поля; всё есть — окно не нужно вовсе.

test('нет резюме — выбор способа', () => {
  assert.equal(decideProfileGateStep(false), 'choose');
  assert.equal(decideProfileGateStep(false, 'Иван', 'Иванов'), 'choose');
});

test('резюме есть, имени или фамилии нет — поля имени', () => {
  assert.equal(decideProfileGateStep(true), 'names');
  assert.equal(decideProfileGateStep(true, '', ''), 'names');
  assert.equal(decideProfileGateStep(true, 'Иван', ''), 'names');
  assert.equal(decideProfileGateStep(true, '', 'Иванов'), 'names');
  assert.equal(decideProfileGateStep(true, '   ', 'Иванов'), 'names');
  assert.equal(decideProfileGateStep(true, null, undefined), 'names');
});

test('резюме и имя с фамилией есть — окно не нужно', () => {
  assert.equal(decideProfileGateStep(true, 'Иван', 'Иванов'), 'skip');
  assert.equal(decideProfileGateStep(true, '  Иван  ', '  Иванов  '), 'skip');
});
