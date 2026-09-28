import assert from 'node:assert/strict';
import test from 'node:test';

import type { User } from '../constants/types.ts';
import {
  emptyResume, mergeSelfUser, normalizeHttpUrl, parseSalaryAmount, parseSalaryNet,
  patchPersonal, patchResume, removeAt, upsertAt,
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

test('patchResume: стёртая зарплата убирает и старую строку salary', () => {
  const withSalary = patchResume(makeUser(), { salaryAmount: 150000, salaryNet: true });
  assert.equal(withSalary.resume?.salary, '150 000 ₽ на руки');
  const cleared = patchResume(withSalary, { salaryAmount: undefined });
  assert.equal(cleared.resume?.salary, undefined);
});

test('patchPersonal: город из «Город и метро» попадает и в resume.city', () => {
  const withResume = patchResume(makeUser(), { desiredPosition: 'Аналитик' });
  const moved = patchPersonal(withResume, { location: 'Казань' });
  assert.equal(moved.personalDetails?.location, 'Казань');
  assert.equal(moved.resume?.city, 'Казань');
  assert.equal(patchPersonal(makeUser(), { location: 'Казань' }).resume, undefined);
});

// ── очистка legacy-строк пустыми массивами ──────────────────────────────

test('patchPersonal: пустой linksList очищает links', () => {
  const withLinks = patchPersonal(makeUser(), {
    linksList: [{ type: 'github', url: 'https://github.com/x' }],
  });
  assert.equal(withLinks.personalDetails?.links, 'https://github.com/x');
  const cleared = patchPersonal(withLinks, { linksList: [] });
  assert.equal(cleared.personalDetails?.links, undefined);
});

test('patchPersonal: пустой workAuthorizationCountries очищает workAuthorization', () => {
  const withCountries = patchPersonal(makeUser(), { workAuthorizationCountries: ['Россия', 'Беларусь'] });
  assert.equal(withCountries.personalDetails?.workAuthorization, 'Россия, Беларусь');
  const cleared = patchPersonal(withCountries, { workAuthorizationCountries: [] });
  assert.equal(cleared.personalDetails?.workAuthorization, undefined);
});

test('patchResume: пустой employmentTypes очищает employmentType', () => {
  const withTypes = patchResume(makeUser(), { employmentTypes: ['Частичная'] });
  assert.equal(withTypes.resume?.employmentType, 'Частичная');
  const cleared = patchResume(withTypes, { employmentTypes: [] });
  assert.equal(cleared.resume?.employmentType, undefined);
});

test('patchResume: пустой workFormats очищает workFormat', () => {
  const withFormats = patchResume(makeUser(), { workFormats: ['Удалённо'] });
  assert.equal(withFormats.resume?.workFormat, 'Удалённо');
  const cleared = patchResume(withFormats, { workFormats: [] });
  assert.equal(cleared.resume?.workFormat, undefined);
});

// ── parseSalaryAmount / parseSalaryNet ──────────────────────────────────

test('parseSalaryAmount вытаскивает число из разных форматов строки', () => {
  assert.equal(parseSalaryAmount('150 000 ₽ на руки'), 150000);
  assert.equal(parseSalaryAmount('от 120000 руб.'), 120000);
  assert.equal(parseSalaryAmount('200 000–250 000 ₽'), 200000);
  assert.equal(parseSalaryAmount('150 000 ₽'), 150000);
  assert.equal(parseSalaryAmount(''), undefined);
  assert.equal(parseSalaryAmount(undefined), undefined);
  assert.equal(parseSalaryAmount('Договорная'), undefined);
});

test('parseSalaryNet распознаёт «на руки» и «до вычета»', () => {
  assert.equal(parseSalaryNet('150 000 ₽ на руки'), true);
  assert.equal(parseSalaryNet('150 000 ₽ до вычета налогов'), false);
  assert.equal(parseSalaryNet('150 000 ₽'), undefined);
  assert.equal(parseSalaryNet(undefined), undefined);
});

// ── normalizeHttpUrl ─────────────────────────────────────────────────────

test('normalizeHttpUrl: пустая строка — не ошибка', () => {
  assert.deepEqual(normalizeHttpUrl(''), {});
  assert.deepEqual(normalizeHttpUrl('   '), {});
});

test('normalizeHttpUrl: без схемы добавляет https://', () => {
  assert.deepEqual(normalizeHttpUrl('github.com/x'), { url: 'https://github.com/x' });
});

test('normalizeHttpUrl: javascript: отклоняется', () => {
  const result = normalizeHttpUrl('javascript:alert(1)');
  assert.equal(result.url, undefined);
  assert.ok(result.error);
});

test('normalizeHttpUrl: ftp:// отклоняется', () => {
  const result = normalizeHttpUrl('ftp://files.example.com');
  assert.equal(result.url, undefined);
  assert.ok(result.error);
});

test('normalizeHttpUrl: хост без точки отклоняется', () => {
  const result = normalizeHttpUrl('http://localhost');
  assert.equal(result.url, undefined);
  assert.ok(result.error);
});

test('normalizeHttpUrl: валидный http:// принимается как есть', () => {
  assert.deepEqual(normalizeHttpUrl('http://example.com/path'), { url: 'http://example.com/path' });
});

// ── mergeSelfUser ────────────────────────────────────────────────────────

test('mergeSelfUser: сохраняет self-only поля из prev, обновляет публичные', () => {
  const prev = makeUser({
    firstName: 'Иван',
    phone: '+79990000000',
    email: 'ivan@example.com',
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    hasPassword: true,
    personalDetails: { middleName: 'Сергеевич' },
    resume: {
      ...emptyResume(),
      desiredPosition: 'Курьер',
      email: 'resume@example.com',
      sourceFileName: 'cv.pdf',
      importedAt: '2026-01-02T00:00:00.000Z',
    },
  });
  // Публичная проекция dbGetUsers: без phone/email/personalDetails и без
  // resume.email/sourceFileName/importedAt, зато с изменившимся именем.
  const publicRow = makeUser({
    firstName: 'Иван-обновлённый',
    phone: '',
    resume: { ...emptyResume(), desiredPosition: 'Курьер-обновлённый' },
  });

  const merged = mergeSelfUser(prev, publicRow);

  assert.equal(merged.firstName, 'Иван-обновлённый');
  assert.equal(merged.phone, '+79990000000');
  assert.equal(merged.email, 'ivan@example.com');
  assert.equal(merged.emailVerifiedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(merged.hasPassword, true);
  assert.deepEqual(merged.personalDetails, { middleName: 'Сергеевич' });
  assert.equal(merged.resume?.desiredPosition, 'Курьер-обновлённый');
  assert.equal(merged.resume?.email, 'resume@example.com');
  assert.equal(merged.resume?.sourceFileName, 'cv.pdf');
  assert.equal(merged.resume?.importedAt, '2026-01-02T00:00:00.000Z');
});
