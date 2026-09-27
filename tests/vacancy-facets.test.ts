import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vacancyLevel, vacancyFormat, vacancySpecs } from '../services/vacancyFacets.ts';

type FacetCase = {
  title: string;
  schedule: string | null;
  text: string | null;
  level: ReturnType<typeof vacancyLevel>;
  format: ReturnType<typeof vacancyFormat>;
  specs: ReturnType<typeof vacancySpecs>;
};

// Общий файл случаев с php-proxy/vacancy_facets.php (tests/vacancy_facets_test.php
// читает тот же файл) — паритет TS/PHP держится на одной таблице примеров,
// а не на двух написанных порознь.
const cases: FacetCase[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/vacancy_facets_cases.json'), 'utf8'),
);

// Уровень и формат вычисляются из текста, и ошибка тут тихая: фильтр
// «Senior» просто молча не покажет половину вакансий. Поэтому под тестом.

test('уровень по названию: латиница и кириллица', () => {
  assert.equal(vacancyLevel('Senior Go-разработчик'), 'senior');
  assert.equal(vacancyLevel('Старший аналитик данных'), 'senior');
  assert.equal(vacancyLevel('Junior QA'), 'junior');
  assert.equal(vacancyLevel('Младший специалист поддержки'), 'junior');
  assert.equal(vacancyLevel('Middle Frontend Developer'), 'middle');
  assert.equal(vacancyLevel('Стажёр-аналитик'), 'intern');
  assert.equal(vacancyLevel('Стажер в команду бэкенда'), 'intern');
  assert.equal(vacancyLevel('Data Science Intern'), 'intern');
  assert.equal(vacancyLevel('Ведущий инженер DevOps'), 'lead');
  assert.equal(vacancyLevel('Team Lead Android'), 'lead');
  assert.equal(vacancyLevel('Head of Product'), 'head');
  assert.equal(vacancyLevel('Руководитель отдела разработки'), 'head');
});

test('старший уровень побеждает: лид над сеньором, хед над лидом', () => {
  assert.equal(vacancyLevel('Senior Team Lead'), 'lead');
  assert.equal(vacancyLevel('Head of Engineering, Lead'), 'head');
});

test('нет признака — нет уровня, а не выдуманный', () => {
  assert.equal(vacancyLevel('Бэкенд-разработчик'), null);
  assert.equal(vacancyLevel(''), null);
  assert.equal(vacancyLevel(undefined), null);
  // Части слов не считаются: «ведущий» внутри другого слова, «head» в «headhunter».
  assert.equal(vacancyLevel('Headhunter / рекрутер'), null);
  assert.equal(vacancyLevel('Специалист по хранению'), null);
});

test('формат: график главнее текста, гибрид главнее офиса', () => {
  assert.equal(vacancyFormat('Гибридный'), 'hybrid');
  assert.equal(vacancyFormat('Удалённо'), 'remote');
  assert.equal(vacancyFormat('удаленная работа'), 'remote');
  assert.equal(vacancyFormat('Офис'), 'office');
  assert.equal(vacancyFormat('гибрид: 3 дня в офисе'), 'hybrid');
  assert.equal(vacancyFormat('5/2', 'Работа в офисе у метро Белорусская'), 'office');
  assert.equal(vacancyFormat('', 'Возможна удалённая работа'), 'remote');
  assert.equal(vacancyFormat('Полный день', 'Хорошая команда'), null);
  assert.equal(vacancyFormat(null, null), null);
});

test('специализация: первое совпавшее правило побеждает', () => {
  assert.deepEqual(vacancySpecs('Java QA Automation'), ['qa']);
  assert.deepEqual(vacancySpecs('Android-разработчик (Kotlin)'), ['mobile']);
  assert.deepEqual(vacancySpecs('Аналитик данных'), ['analytics']);
  assert.deepEqual(vacancySpecs('Data Engineer (Python)'), ['data']);
  assert.deepEqual(vacancySpecs('Fullstack-разработчик (JS/React)'), ['frontend', 'backend']);
});

test('специализация: неизвестное название — пустой список, а не выдуманный бэкенд', () => {
  assert.deepEqual(vacancySpecs('Разработчик программного обеспечения'), []);
  assert.deepEqual(vacancySpecs('Программист'), []);
  assert.deepEqual(vacancySpecs(''), []);
  assert.deepEqual(vacancySpecs(undefined), []);
});

// Общая таблица случаев с PHP-зеркалом (php-proxy/vacancy_facets.php) — если
// paritet разошёлся, упадёт здесь или в tests/vacancy_facets_test.php.
test('паритет с php-proxy/vacancy_facets.php по общему файлу случаев', () => {
  for (const c of cases) {
    assert.equal(vacancyLevel(c.title), c.level, `level: ${c.title}`);
    assert.equal(vacancyFormat(c.schedule, c.text), c.format, `format: ${c.title}`);
    assert.deepEqual(vacancySpecs(c.title), c.specs, `specs: ${c.title}`);
  }
});
