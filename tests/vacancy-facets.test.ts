import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vacancyLevel, vacancyFormat } from '../services/vacancyFacets.ts';

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
