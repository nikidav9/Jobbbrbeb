import assert from 'node:assert/strict';
import test from 'node:test';

import type { User } from '../constants/types.ts';
import {
  emptyResume, patchPersonal, patchResume, removeAt, upsertAt,
} from '../lib/profileEdit.ts';
import { normalizeSkill, POPULAR_IT_SKILLS, searchSkills, SKILLS } from '../constants/skills.ts';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    role: 'worker',
    phone: '+79990000000',
    lastName: 'Иванов',
    firstName: 'Иван',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── searchSkills ────────────────────────────────────────────────────────

test('searchSkills не различает регистр', () => {
  const lower = searchSkills('excel');
  const upper = searchSkills('EXCEL');
  assert.deepEqual(lower, upper);
  assert.ok(lower.includes('Microsoft Excel'));
});

test('searchSkills не различает ё/е', () => {
  assert.ok(SKILLS.includes('Наставничество и менторство'));
  const bySimpleE = searchSkills('наставничество');
  assert.ok(bySimpleE.length > 0);
});

test('searchSkills: сначала начало названия, потом начало слова, потом подстрока', () => {
  const results = searchSkills('карт');
  // "Дорожная карта продукта" — совпадение по слову ("карта"), не по началу строки.
  const idx = results.indexOf('Дорожная карта продукта');
  assert.ok(idx >= 0);
  // Ни один результат раньше него не должен быть подстрокой-не-словом.
  for (const r of results.slice(0, idx)) {
    const folded = r.toLowerCase().replace(/ё/g, 'е');
    assert.ok(folded.startsWith('карт') || folded.split(/\s+/).some((w) => w.startsWith('карт')));
  }
});

test('searchSkills исключает уже выбранные навыки без учёта регистра', () => {
  const results = searchSkills('sql', ['sql']);
  assert.ok(!results.includes('SQL'));
});

test('searchSkills на пустой запрос возвращает пустой список', () => {
  assert.deepEqual(searchSkills(''), []);
  assert.deepEqual(searchSkills('   '), []);
});

test('POPULAR_IT_SKILLS соответствует макету resume/04-skills.html', () => {
  assert.deepEqual(POPULAR_IT_SKILLS, [
    'Jira', 'Agile / Scrum', 'SQL', 'Microsoft Excel', 'Confluence',
    'Управление проектами', 'Аналитика данных', 'Power BI',
  ]);
});

test('normalizeSkill схлопывает пробелы и обрезает края', () => {
  assert.equal(normalizeSkill('  React   Native  '), 'React Native');
});

// ── patchResume / patchPersonal ─────────────────────────────────────────

test('patchResume создаёт резюме, если его не было', () => {
  const user = makeUser();
  const next = patchResume(user, { desiredPosition: 'Курьер' });
  assert.deepEqual(next.resume, { ...emptyResume(), desiredPosition: 'Курьер' });
});

test('patchResume синхронизирует зарплату числом в строку', () => {
  const user = makeUser({ resume: emptyResume() });
  const next = patchResume(user, { salaryAmount: 150000, salaryNet: true });
  assert.equal(next.resume?.salary, '150 000 ₽ на руки');
});

test('patchResume синхронизирует занятость/формат из множественного выбора', () => {
  const user = makeUser({ resume: emptyResume() });
  const next = patchResume(user, { employmentTypes: ['Частичная', 'Проектная'], workFormats: ['Удалённо'] });
  assert.equal(next.resume?.employmentType, 'Частичная');
  assert.equal(next.resume?.workFormat, 'Удалённо');
});

test('patchResume: «работаю сейчас» переносится в end места работы', () => {
  const user = makeUser({
    resume: {
      ...emptyResume(),
      experience: [{ company: 'Лавка', position: 'Сборщик', start: 'Август 2022', end: 'Сентябрь 2023' }],
    },
  });
  const next = patchResume(user, {
    experience: upsertAt(user.resume!.experience, 0, {
      ...user.resume!.experience[0], current: true,
    }),
  });
  assert.equal(next.resume?.experience[0].end, 'Сейчас');
});

test('patchResume: год окончания образования/курса переносится в period', () => {
  const user = makeUser({
    resume: {
      ...emptyResume(),
      education: [{ institution: 'МГУ', endYear: 2020 }],
      coursework: [{ name: 'Курс аналитики', endYear: 2021 }],
    },
  });
  const next = patchResume(user, {});
  assert.equal(next.resume?.education[0].period, '2020');
  assert.equal(next.resume?.coursework[0].period, '2021');
});

test('patchPersonal создаёт анкету, если её не было', () => {
  const user = makeUser();
  const next = patchPersonal(user, { middleName: 'Сергеевич' });
  assert.deepEqual(next.personalDetails, { middleName: 'Сергеевич' });
});

test('patchPersonal синхронизирует ссылки в текстовый список', () => {
  const user = makeUser();
  const next = patchPersonal(user, {
    linksList: [
      { type: 'github', url: 'https://github.com/x' },
      { type: 'portfolio', url: 'https://x.dev', label: 'Мои проекты' },
    ],
  });
  assert.equal(next.personalDetails?.links, 'https://github.com/x\nМои проекты (https://x.dev)');
});

test('patchPersonal синхронизирует категории прав в driversLicense', () => {
  const user = makeUser();
  const withCategories = patchPersonal(user, { drivingCategories: ['B', 'BE'] });
  assert.equal(withCategories.personalDetails?.driversLicense, 'Да');

  const withoutCategories = patchPersonal(user, { drivingCategories: [] });
  assert.equal(withoutCategories.personalDetails?.driversLicense, 'Нет');
});

test('patchPersonal: снятие «есть ограничения» очищает описание', () => {
  const user = makeUser({ personalDetails: { employmentRestrictions: 'Отработка 2 недели', hasEmploymentRestrictions: true } });
  const next = patchPersonal(user, { hasEmploymentRestrictions: false });
  assert.equal(next.personalDetails?.employmentRestrictions, undefined);
});

test('patchPersonal переносит первую станцию метро в User.metroStation/metroLineId', () => {
  const user = makeUser();
  const next = patchPersonal(user, {
    metroStations: [
      { station: 'Щукинская', lineId: 'purple' },
      { station: 'Тушинская', lineId: 'purple' },
    ],
  });
  assert.equal(next.metroStation, 'Щукинская');
  assert.equal(next.metroLineId, 'purple');
});

// ── upsertAt / removeAt ──────────────────────────────────────────────────

test('upsertAt без индекса добавляет элемент в конец', () => {
  assert.deepEqual(upsertAt([1, 2], undefined, 3), [1, 2, 3]);
});

test('upsertAt с индексом заменяет элемент на месте', () => {
  assert.deepEqual(upsertAt(['a', 'b', 'c'], 1, 'x'), ['a', 'x', 'c']);
});

test('upsertAt не мутирует исходный список', () => {
  const list = [1, 2, 3];
  upsertAt(list, 0, 9);
  assert.deepEqual(list, [1, 2, 3]);
});

test('removeAt убирает элемент по индексу', () => {
  assert.deepEqual(removeAt(['a', 'b', 'c'], 1), ['a', 'c']);
});

test('removeAt с индексом вне диапазона список не меняет', () => {
  const list = ['a', 'b'];
  assert.deepEqual(removeAt(list, 5), list);
  assert.deepEqual(removeAt(list, -1), list);
});
