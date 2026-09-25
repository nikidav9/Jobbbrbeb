import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, fillNote, jupiterStatus, jupiterBadge, jupiterRowSummary } from '../services/jupiterTimeline.ts';

const app = (over: Record<string, unknown>) => ({
  id: 'a', vacancyUrl: 'https://career.example.ru/v/1', state: 'queued', reasonCode: null,
  createdAt: '', updatedAt: '', ...over,
}) as any;

test('что вписал Юпитер — по-человечески, без значений', () => {
  assert.equal(fillNote({ fields: 5, keys: ['first_name', 'phone', 'email', 'x_unknown'], resume: true }),
    '5 полей: имя, телефон, почта · резюме');
  assert.equal(fillNote({ fields: 1, keys: [], resume: false }), '1 поле');
  assert.equal(fillNote({ fields: 3, keys: ['a'], resume: false }), '3 поля');
  assert.equal(fillNote({ fields: 0, keys: [], resume: true }), 'резюме');
  assert.equal(fillNote(null), undefined);
});

test('история: новое сверху, внутренние шаги не показываются', () => {
  const steps = buildTimeline([
    { kind: 'created', reason_code: null, detail: null, created_at: '1' },
    { kind: 'queued', reason_code: null, detail: null, created_at: '2' },
    { kind: 'filling', reason_code: null, detail: null, created_at: '3' },
    { kind: 'submitted', reason_code: null, detail: { fields: 2, keys: ['phone'], resume: true }, created_at: '4' },
  ]);
  assert.deepEqual(steps.map(s => s.title), ['Юпитер отправил отклик', 'В очереди Юпитера', 'Вы откликнулись']);
  assert.equal(steps[0].note, '2 поля: телефон · резюме');
});

test('ручная отправка и причины «нужны вы»', () => {
  const [manual] = buildTimeline([{ kind: 'submitted', reason_code: 'MANUAL_WEBVIEW', detail: null, created_at: '1' }]);
  assert.equal(manual.title, 'Вы отправили отклик');
  const [captcha] = buildTimeline([{ kind: 'action_required', reason_code: 'CAPTCHA_REQUIRED', detail: null, created_at: '1' }]);
  assert.equal(captcha.tone, 'wait');
  assert.match(captcha.note ?? '', /не робот/);
  const [other] = buildTimeline([{ kind: 'action_required', reason_code: 'X', detail: null, created_at: '1' }]);
  assert.equal(other.note, 'Юпитер не смог закончить сам');
});

test('метка строки списка: ОТПРАВЛЕНО / НУЖНЫ ВЫ / НЕ ПОЛУЧИЛОСЬ / В РАБОТЕ', () => {
  assert.deepEqual(jupiterBadge(app({ state: 'submitted' })), { label: 'ОТПРАВЛЕНО', tone: 'sent' });
  assert.deepEqual(jupiterBadge(app({ state: 'duplicate' })), { label: 'ОТПРАВЛЕНО', tone: 'sent' });
  assert.deepEqual(jupiterBadge(app({ state: 'failed' })), { label: 'НЕ ПОЛУЧИЛОСЬ', tone: 'failed' });
  assert.deepEqual(jupiterBadge(app({ state: 'action_required', reasonCode: 'CAPTCHA_REQUIRED' })),
    { label: 'НУЖНЫ ВЫ', tone: 'needs_you' });
  assert.deepEqual(jupiterBadge(app({ state: 'filling' })), { label: 'В РАБОТЕ', tone: 'working' });
  assert.deepEqual(jupiterBadge(app({ state: 'ready_to_submit' })), { label: 'В РАБОТЕ', tone: 'working' });
});

test('итог строки — что сделано или чего не хватает', () => {
  assert.equal(jupiterRowSummary(app({ state: 'submitted' })), 'Анкета заполнена и отправлена');
  assert.equal(jupiterRowSummary(app({ state: 'submitted', reasonCode: 'MANUAL_WEBVIEW' })), 'Вы отправили отклик сами');
  assert.equal(jupiterRowSummary(app({ state: 'failed' })), 'Не получилось заполнить анкету');
  assert.equal(jupiterRowSummary(app({ state: 'filling' })), 'Юпитер заполняет анкету');
  assert.equal(jupiterRowSummary(app({ state: 'action_required', reasonCode: 'CAPTCHA_REQUIRED' })),
    'Сайт просит проверку «я не робот» — отправьте сами');
  assert.equal(jupiterRowSummary(app({
    vacancyUrl: 'https://rabota.sber.ru/search/1', state: 'action_required', reasonCode: 'CONSENT_REQUIRED',
  })), 'Нужно ваше согласие для Сбера');
  assert.equal(jupiterRowSummary(app({ state: 'action_required', reasonCode: 'LIVE_AUTHORIZATION_REVOKED' })),
    'Автоотклик выключен — отправьте сами');
});

test('статус: особые причины важнее состояния', () => {
  assert.equal(jupiterStatus(app({ state: 'submitted', reasonCode: 'MANUAL_WEBVIEW' })).label, 'Отправлено вами');
  assert.equal(jupiterStatus(app({ state: 'action_required', reasonCode: 'SITE_NOT_VERIFIED' })).label,
    'Сайт ещё подключаем · отклик сохранён');
  assert.equal(jupiterStatus(app({
    vacancyUrl: 'https://rabota.sber.ru/search/1', state: 'action_required', reasonCode: 'CONSENT_REQUIRED',
  })).label, 'Нужно согласие Сбера · не отправлено');
  assert.equal(jupiterStatus(app({ state: 'submitted' })).label, 'Отправлено');
  assert.equal(jupiterStatus(app({ state: 'filling' })).label, 'Юпитер обрабатывает');
});
