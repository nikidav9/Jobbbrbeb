// «Ответьте один раз» (01.10.2026): ответы подставляются из профиля, сохранённое главнее.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAnswersFor, applyAnswersFilled } from '../lib/applyAnswers.ts';

test('из профиля: зарплата, Telegram как @ник, английский, переезд', () => {
  const a = applyAnswersFor({
    personalDetails: { linksList: [{ type: 'telegram', url: 'https://t.me/nik_dev' }], relocationCities: ['СПб'] },
    resume: { salaryAmount: 200000, languages: [{ name: 'Английский', level: 'B2' }], specializations: [], experience: [] },
  } as never);
  assert.equal(a.desiredSalary, '200000');
  assert.equal(a.telegram, '@nik_dev');
  assert.equal(a.englishLevel, 'B2');
  assert.equal(a.relocation, 'Готов');
  assert.equal(applyAnswersFilled(a), 4);
});

test('сохранённые ответы главнее профиля; пустой профиль — ничего не выдумано', () => {
  const a = applyAnswersFor({
    personalDetails: { applyAnswers: { desiredSalary: '250000', noticePeriod: 'Через 2 недели' } },
    resume: { salaryAmount: 200000, specializations: [], experience: [], languages: [] },
  } as never);
  assert.equal(a.desiredSalary, '250000');
  assert.equal(a.noticePeriod, 'Через 2 недели');
  assert.equal(applyAnswersFilled(applyAnswersFor(null)), 0);
});
