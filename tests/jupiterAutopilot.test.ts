import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOPILOT_CORE, SUBMIT_BY_USER_SCRIPT, buildAutopilotScript, rerunAutopilotScript,
} from '../services/jupiterAutopilot.ts';

// Решения автопилота живут строкой (Hermes не отдаёт исходник функций), поэтому
// собираем их тем же текстом, что уйдёт в страницу, — как tests/jupiter-fill.test.ts.
const core = new Function(`${AUTOPILOT_CORE}; return { jtConsentDecision, jtIsApplyButton, jtIsSubmitButton, jtSuccessText };`)();

test('согласие на обработку ПДн ставится только по поручению', () => {
  const text = 'Я даю согласие на обработку персональных данных';
  assert.equal(core.jtConsentDecision(text, true).action, 'check');
  assert.equal(core.jtConsentDecision(text, false).action, 'ask');
});

test('реклама, кадровый резерв, третьи лица, трансграничная передача — никогда', () => {
  for (const text of [
    'Согласен получать рекламные рассылки',
    'Включите меня в кадровый резерв',
    'Согласен на передачу данных третьим лицам',
    'Согласен на трансграничную передачу',
    'Согласен на обработку биометрических данных',
  ]) {
    assert.notEqual(core.jtConsentDecision(text, true).action, 'check', text);
  }
});

test('смешанная галочка (данные + реклама) — всегда к человеку', () => {
  assert.equal(
    core.jtConsentDecision('Согласен на обработку персональных данных и на рекламные рассылки', true).action,
    'ask');
});

test('подтверждение достоверности — по поручению; обычный вопрос — не согласие', () => {
  assert.equal(core.jtConsentDecision('Подтверждаю достоверность указанных данных', true).action, 'check');
  assert.equal(core.jtConsentDecision('Готов к командировкам', true).action, 'none');
});

test('кнопки: «Откликнуться» открывает анкету, «Подписаться» не отправка', () => {
  assert.equal(core.jtIsApplyButton('Откликнуться'), true);
  assert.equal(core.jtIsApplyButton('Откликнуться на вакансию'), true);
  assert.equal(core.jtIsApplyButton('Заполнить анкету'), true);
  assert.equal(core.jtIsApplyButton('Хочу работать'), true);
  assert.equal(core.jtIsApplyButton('Все вакансии'), false);
  assert.equal(core.jtIsSubmitButton('Отправить'), true);
  assert.equal(core.jtIsSubmitButton('Отправить резюме'), true);
  assert.equal(core.jtIsSubmitButton('Оставить заявку'), true);
  assert.equal(core.jtIsSubmitButton('Подписаться на рассылку'), false);
  assert.equal(core.jtIsSubmitButton('Найти'), false);
});

test('подтверждение приёма узнаётся, обычный текст страницы — нет', () => {
  assert.equal(core.jtSuccessText('Спасибо за отклик! Мы свяжемся с вами.'), true);
  assert.equal(core.jtSuccessText('Ваша заявка успешно отправлена'), true);
  assert.equal(core.jtSuccessText('Отправьте резюме, и мы рассмотрим его'), false);
});

test('сухой режим: скрипт сам не отправляет, отправку зовёт только человек', () => {
  const script = buildAutopilotScript({ first_name: 'Тест' } as never, 'example.ru',
    { submit: false, delegated: true });
  assert.match(script, /"submit":false/);
  assert.match(script, /if \(!CFG\.submit\) \{ finish\('ready', 'dry_run'\); return; \}/);
  assert.match(script, /if \(!CFG\.submit\) window\.__jtSubmit = function/);
  assert.equal(SUBMIT_BY_USER_SCRIPT, 'window.__jtSubmit && window.__jtSubmit(); true;');
  assert.ok(rerunAutopilotScript(script).startsWith('window.__jtAutopilot = false; '));
});

test('скрипт работает только на хосте вакансии и по https', () => {
  const script = buildAutopilotScript({} as never, 'example.ru', { submit: false, delegated: false });
  assert.match(script, /location\.protocol !== 'https:'/);
  assert.match(script, /"host":"example\.ru"/);
});

test('ссылка на резюме в страницу не попадает — только содержимое файла', () => {
  const script = buildAutopilotScript({ first_name: 'Тест' } as never, 'example.ru',
    { submit: false, delegated: false, resumeBase64: 'JVBERi0=', resumeName: 'cv.pdf' });
  assert.match(script, /"b64":"JVBERi0="/);
  assert.doesNotMatch(script, /resume_url/);
});

test('собранный скрипт разбирается целиком (одна ошибка экранирования ломает все сайты)', () => {
  // 27.09.2026: «\\s» в шаблонной строке превратился в «s», и регэксп маски
  // телефона стал недопустимым — скрипт не запускался ни на одном сайте.
  for (const submit of [false, true]) {
    const script = buildAutopilotScript({ first_name: 'Тест' } as never, 'example.ru',
      { submit, delegated: true, resumeBase64: 'JVBERi0=', resumeName: 'cv.pdf' });
    assert.doesNotThrow(() => new Function(script), `submit=${submit}`);
  }
});

