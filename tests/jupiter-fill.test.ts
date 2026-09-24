import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILL_CORE, buildFillScript, fillHostFor } from '../services/jupiterFill.ts';

// jtKeyForField живёт как текст JS (Hermes не отдаёт исходник функции через
// toString), поэтому тестируем её так же, как её соберёт инжектируемый
// скрипт: new Function собирает функцию из FILL_CORE и запускает.
const jtKeyForField = new Function(`${FILL_CORE}; return jtKeyForField;`)();

test('составное имя — обе/все части подписи дают full_name', () => {
  assert.equal(jtKeyForField('Фамилия имя и отчество'), 'full_name');
  assert.equal(jtKeyForField('Фамилия и Имя'), 'full_name');
  assert.equal(jtKeyForField('Имя, фамилия'), 'full_name');
});

test('одиночная часть ФИО — свой ключ', () => {
  assert.equal(jtKeyForField('Фамилия'), 'last_name');
  assert.equal(jtKeyForField('Имя'), 'first_name');
});

test('составное имя поля РАЗДЕЛ[ПОЛЕ]: смысл берётся по внутреннему имени', () => {
  assert.equal(jtKeyForField('Имя', undefined, 'VACANCY[NAME]'), 'first_name');
});

test('биографические разделы (опыт, образование) не выдумываем', () => {
  assert.equal(jtKeyForField('Должность', undefined, 'WORK[POSITION][]'), null);
  assert.equal(jtKeyForField('Год', undefined, 'EDUCATION[YEAR][]'), null);
});

test('тип поля побеждает подпись', () => {
  assert.equal(jtKeyForField('', 'tel'), 'phone');
  assert.equal(jtKeyForField('', 'email'), 'email');
});

test('капча не заполняется', () => {
  assert.equal(jtKeyForField('Введите код с картинки (captcha)'), null);
});

const PROFILE = {
  first_name: 'Иван', last_name: 'Иванов', patronymic: 'Иванович', full_name: 'Иванов Иван Иванович',
  phone: '+79990001122', email: 'ivan@example.com', city: 'Москва', desired_role: 'Курьер',
  citizenship: 'РФ',
};

test('buildFillScript не нажимает кнопки и не ставит галочки согласия', () => {
  const script = buildFillScript(PROFILE as any, 'employer.example');
  assert.equal(script.includes('click('), false);
  assert.equal(/\.checked\s*=\s*true/.test(script), false);
  assert.equal(/checked\s*:\s*true/.test(script), false);
});

test('buildFillScript не падает на профиле без даты рождения и сопроводительного письма', () => {
  // birth_date и cover_letter убраны из JupiterFillProfile (минимизация ПДн и
  // отсутствие модели сопроводительного письма) — jtKeyForField всё ещё может
  // вернуть эти ключи для поля формы, но профиль их просто не содержит.
  const script = buildFillScript(PROFILE as any, 'employer.example');
  assert.equal(typeof script, 'string');
  assert.ok(script.trim().endsWith('true;'));
});

test('мессенджер, компания, ИНН и рекомендатель не заполняются', () => {
  assert.equal(jtKeyForField('Telegram', undefined, 'telegram'), null);
  assert.equal(jtKeyForField('Телеграм, чтобы с вами было проще связаться'), null);
  assert.equal(jtKeyForField('Компания'), null);
  assert.equal(jtKeyForField('ИНН*'), null);
  assert.equal(jtKeyForField('Имя рекомендателя', undefined, 'referrer_name'), null);
  assert.equal(jtKeyForField('Контроль качества'), null);
});

test('скрипт собирается в валидный JavaScript', () => {
  const script = buildFillScript({
    first_name: 'Иван', last_name: 'Петров', patronymic: null, full_name: 'Петров Иван',
    phone: '+79990000000', email: 'i@example.com', city: 'Москва', citizenship: null, desired_role: null,
  }, 'employer.example');
  assert.doesNotThrow(() => new Function(script));
  // \b внутри шаблонной строки TS легко превращается в символ backspace.
  assert.ok(!script.includes('\u0008'));
});

test('данные вписываются только на сайте вакансии', () => {
  const script = buildFillScript({
    first_name: 'Иван', last_name: null, patronymic: null, full_name: null,
    phone: '+79990000000', email: null, city: null, citizenship: null, desired_role: null,
  }, fillHostFor('https://www.career.example.ru/vacancy/1') as string);
  const run = (href: string) => {
    const url = new URL(href);
    let queried = false;
    const document = { querySelectorAll: () => { queried = true; return []; }, querySelector: () => null, body: {} };
    const window = { ReactNativeWebView: { postMessage: () => {} }, getComputedStyle: () => ({}) };
    class MutationObserver { observe() {} }
    new Function('location', 'document', 'window', 'MutationObserver', script)(
      { hostname: url.hostname, protocol: url.protocol }, document, window, MutationObserver);
    return queried;
  };
  assert.equal(run('https://career.example.ru/vacancy/1'), true);
  assert.equal(run('https://apply.career.example.ru/form'), true);
  assert.equal(run('https://evil.example/phish'), false);
  assert.equal(run('https://career.example.ru.evil.example/'), false);
  assert.equal(run('http://career.example.ru/vacancy/1'), false);
});
