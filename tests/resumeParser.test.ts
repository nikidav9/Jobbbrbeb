import assert from 'node:assert/strict';
import test from 'node:test';
import { inferWorkTypes, parseResumeIdentity, parseResumeText } from '../lib/resumeParser.ts';

const hhResume = `
Давыдов Никита Сергеевич
Мужчина, 24 года, родился 2 октября 2001
+7 (993) 3431523 — предпочитаемый способ связи
nikidav23@gmail.com
Проживает: Москва
Гражданство: Россия, есть разрешение на работу: Россия
Готов работать удалённо, не готов к командировкам
Желаемая должность и зарплата
Региональный менеджер 140 000 ₽ на руки
Специализации:
— Директор магазина, директор сети магазинов
— Супервайзер
Тип занятости: полная занятость
Формат работы: удалённо
Опыт работы — 5 лет 1 месяц
Август 2022 —
ООО «Яндекс Лавка»
настоящее время
4 года 2 месяца Супервайзер
- Организация работы склада. Управление процессами приемки, хранения и отгрузки товаров.
- Управление запасами. Мониторинг остатков, проведение инвентаризаций.
Сентябрь 2021 —
ООО «Яндекс лавка»
Июль 2022
11 месяцев Директор склада
Управлять коллективом Лавки и обучать команду.
Работать в Excel, WMS и с терминалом сбора данных (ТСД)
Образование
Уровень Среднее образование
Навыки
Знание языков Русский — Родной
Английский — A2 — Элементарный
Немецкий — A1 — Начальный
Навыки Деловая переписка Деловое общение Урегулирование конфликтов
MS Excel Обучение персонала Управление командой Управление персоналом
Ответственность Стрессоустойчивость
`;

test('резюме hh распределяется по разделам профиля', () => {
  const resume = parseResumeText(hhResume, 'resume.pdf', new Date('2026-09-20T10:00:00.000Z'));
  assert.equal(resume.desiredPosition, 'Региональный менеджер');
  assert.equal(resume.salary, '140 000 ₽ на руки');
  assert.deepEqual(resume.specializations, ['Директор магазина, директор сети магазинов', 'Супервайзер']);
  assert.equal(resume.city, 'Москва');
  assert.equal(resume.email, 'nikidav23@gmail.com');
  assert.equal(resume.experience.length, 2);
  assert.equal(resume.experience[0].position, 'Супервайзер');
  assert.equal(resume.experience[0].company, 'ООО «Яндекс Лавка»');
  assert.equal(resume.experience[1].position, 'Директор склада');
  assert.equal(resume.education[0].level, 'Среднее образование');
  assert.ok(resume.skills.includes('MS Excel'));
  assert.ok(resume.skills.includes('Управление персоналом'));
  assert.deepEqual(resume.languages.map(item => item.name), ['Русский', 'Английский', 'Немецкий']);
  assert.ok(inferWorkTypes(resume).includes('shift_supervisor'));
  assert.ok(inferWorkTypes(resume).includes('stocker'));
});

test('ФИО и возраст извлекаются отдельно от публичного резюме', () => {
  assert.deepEqual(parseResumeIdentity(hhResume), {
    lastName: 'Давыдов',
    firstName: 'Никита',
    middleName: 'Сергеевич',
    age: 24,
  });
});

test('неполное резюме не создаёт выдуманные разделы', () => {
  const resume = parseResumeText('Желаемая должность и зарплата\nПовар', 'short.pdf');
  assert.equal(resume.desiredPosition, 'Повар');
  assert.equal(resume.experience.length, 0);
  assert.equal(resume.education.length, 0);
  assert.equal(resume.skills.length, 0);
  assert.equal(resume.projects.length, 0);
  assert.equal(resume.exams.length, 0);
  assert.equal(resume.interests.length, 0);
  assert.equal(resume.certifications.length, 0);
  assert.equal(resume.awards.length, 0);
  assert.equal(resume.coursework.length, 0);
  assert.deepEqual(inferWorkTypes(resume), ['cook']);
});


test('дополнительные разделы резюме сохраняются структурированно', () => {
  const text = `
Иванов Иван Иванович
Желаемая должность и зарплата
Руководитель склада 180 000 ₽
Образование
Московский государственный университет
Специальность: Логистика
2020 — 2024
Проекты
• Переезд склада — Руководитель проекта — Запустил новую WMS
Экзамены
IELTS — 7.5 — 2025
Языки
Русский — Родной
English — B2
Навыки
SQL; MS Excel; WMS
Интересы
Бег; Автоматизация
Лицензии и сертификаты
Охрана труда — Учебный центр — 2026
Награды
Лучший руководитель — Компания — 2025
Курсы
Управление командой — Корпоративный университет — 2024
Обо мне
Руковожу складскими командами и автоматизирую процессы.
`;

  const resume = parseResumeText(text, 'full.pdf');

  assert.equal(resume.education[0].institution, 'Московский государственный университет');
  assert.equal(resume.education[0].specialty, 'Логистика');
  assert.equal(resume.projects[0].name, 'Переезд склада');
  assert.equal(resume.projects[0].role, 'Руководитель проекта');
  assert.equal(resume.exams[0].name, 'IELTS');
  assert.equal(resume.exams[0].score, '7.5');
  assert.deepEqual(resume.languages.map(item => item.name), ['Русский', 'English']);
  assert.ok(resume.skills.includes('SQL'));
  assert.ok(resume.interests.includes('Бег'));
  assert.equal(resume.certifications[0].issuer, 'Учебный центр');
  assert.equal(resume.awards[0].name, 'Лучший руководитель');
  assert.equal(resume.coursework[0].institution, 'Корпоративный университет');
  assert.equal(resume.summary, 'Руковожу складскими командами и автоматизирую процессы.');
});
