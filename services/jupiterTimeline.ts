// Статус и история отклика Юпитера — общие для списка «Откликов» и карточки
// отклика (app/jupiter-application.tsx). Чистый модуль: без React, чтобы
// тесты могли его импортировать напрямую.
import type { JupiterApplication, JupiterApplicationState } from '@/constants/types';

export type JupiterStatus = { label: string; fg: string; bg: string };

const WAIT = { fg: '#B45309', bg: '#FEF3C7' };
const DONE = { fg: '#047857', bg: '#D1FAE5' };
const INFO = { fg: '#1D4ED8', bg: '#DBEAFE' };
const FAIL = { fg: '#DC2626', bg: '#FEE2E2' };
const CLOSED = { fg: '#4B5563', bg: '#E5E7EB' };

/**
 * Работодатель закрыл вакансию, а отклик так и не ушёл. Отправленный отклик
 * закрытым не считаем: он дошёл, пока вакансия была открыта. Решение владельца
 * 26.09: такой отклик — «Вакансия закрыта», без кнопки отправки, не в «Ждут вас».
 */
export function jupiterVacancyClosed(a: JupiterApplication): boolean {
  return a.vacancyActive === false && a.state !== 'submitted' && a.state !== 'duplicate';
}

export function jupiterIsSber(a: Pick<JupiterApplication, 'vacancyUrl'>): boolean {
  return /^https:\/\/rabota\.sber\.ru(?:\/|$)/i.test(a.vacancyUrl);
}

export function jupiterNeedsSberConsent(a: JupiterApplication): boolean {
  return jupiterIsSber(a)
    && a.state === 'action_required'
    && ['CONSENT_REQUIRED', 'UNSUPPORTED_SCRIPT'].includes(a.reasonCode ?? '');
}

/**
 * Браузерный движок Юпитера упёрся в капчу и ждёт слово от человека: картинка
 * уже у нас, ответ вводится на экране /jupiter-captcha, и отклик уходит сразу.
 */
export function jupiterNeedsCaptcha(a: Pick<JupiterApplication, 'state' | 'reasonCode'>): boolean {
  return a.state === 'action_required' && a.reasonCode === 'CAPTCHA_HUMAN';
}

function stateStatus(state: JupiterApplicationState): JupiterStatus {
  switch (state) {
    case 'ready_to_submit': return { label: 'Анкета заполнена · не отправлена', ...WAIT };
    case 'submitted': return { label: 'Отправлено', ...DONE };
    case 'action_required': return { label: 'Нужно ваше участие', ...WAIT };
    // Честные исходы (решение владельца 01.10.2026): заявка ушла на сайт, но
    // он промолчал — «скорее всего, ушёл»; Юпитер споткнулся до отправки — «не ушёл».
    case 'submission_unknown': return { label: 'Скорее всего, ушёл', ...WAIT };
    case 'failed': return { label: 'Не ушёл', ...FAIL };
    case 'retryable_failed': return { label: 'Повторит позже', ...WAIT };
    case 'duplicate': return { label: 'Повтор не отправлен', ...DONE };
    default: return { label: 'Юпитер обрабатывает', ...INFO };
  }
}

/** Статус-плашка отклика: особые причины важнее общего состояния. */
export function jupiterStatus(a: JupiterApplication): JupiterStatus {
  if (jupiterVacancyClosed(a)) return { label: 'Вакансия закрыта работодателем', ...CLOSED };
  if (a.reasonCode === 'LIVE_AUTHORIZATION_REVOKED') return { label: 'Автоотклик выключен · не отправлено', ...WAIT };
  if (jupiterNeedsSberConsent(a)) return { label: 'Нужно согласие Сбера · не отправлено', ...WAIT };
  if (jupiterNeedsCaptcha(a)) return { label: 'Нужна проверка сайта', ...WAIT };
  if (a.reasonCode === 'UNSUPPORTED_SCRIPT') return { label: 'Нужен браузер · отклик не отправлен', ...WAIT };
  if (a.reasonCode === 'PHONE_FILL') return { label: 'Ждёт отправки · анкета заполнится сама', ...WAIT };
  if (a.reasonCode === 'SITE_NOT_VERIFIED') return { label: 'Сайт ещё подключаем · отклик сохранён', ...INFO };
  if (a.state === 'submitted' && a.reasonCode === 'MANUAL_WEBVIEW') return { label: 'Отправлено вами', ...DONE };
  return stateStatus(a.state);
}

export type JupiterBadge = { label: string; tone: 'sent' | 'needs_you' | 'failed' | 'working' | 'closed' };

/** Метка строки списка — как у Sorce: ОТПРАВЛЕНО / НУЖНЫ ВЫ / НЕ УШЁЛ / СКОРЕЕ ВСЕГО УШЁЛ / В РАБОТЕ. */
export function jupiterBadge(a: JupiterApplication): JupiterBadge {
  if (a.state === 'submitted' || a.state === 'duplicate') return { label: 'ОТПРАВЛЕНО', tone: 'sent' };
  if (jupiterVacancyClosed(a)) return { label: 'ЗАКРЫТА', tone: 'closed' };
  if (a.state === 'failed') return { label: 'НЕ УШЁЛ', tone: 'failed' };
  if (a.state === 'submission_unknown') return { label: 'СКОРЕЕ ВСЕГО УШЁЛ', tone: 'working' };
  if (a.state === 'action_required') return { label: 'НУЖНЫ ВЫ', tone: 'needs_you' };
  return { label: 'В РАБОТЕ', tone: 'working' };
}

/** Итог одной строкой: что сделано или чего не хватает, — для списка «Откликов». */
export function jupiterRowSummary(a: JupiterApplication): string {
  if (jupiterVacancyClosed(a)) return 'Работодатель закрыл вакансию — отклик не отправлен';
  if (a.reasonCode === 'LIVE_AUTHORIZATION_REVOKED') return 'Автоотклик выключен — отправьте сами';
  if (jupiterNeedsSberConsent(a)) return 'Нужно ваше согласие для Сбера';
  switch (a.state) {
    case 'submitted':
      return a.reasonCode === 'MANUAL_WEBVIEW' ? 'Вы отправили отклик сами' : 'Анкета заполнена и отправлена';
    case 'duplicate': return 'Вы уже откликались на эту вакансию';
    case 'failed': return 'Юпитер споткнулся до отправки — отправьте сами за минуту';
    case 'retryable_failed': return 'Не получилось — Юпитер попробует ещё раз';
    case 'ready_to_submit': return a.submissionAuthorizedAt
      ? 'Анкета заполнена, ждёт отправки'
      : 'Анкета заполнена — включите автоотклик';
    case 'submission_unknown': return 'Заявка ушла на сайт, но он не написал «отправлено». Ответ компании придёт в «Почту»';
    case 'action_required': return ACTION_REASONS[a.reasonCode ?? ''] ?? 'Юпитер не смог закончить сам';
    default: return 'Юпитер заполняет анкету';
  }
}

export type JupiterEvent = {
  kind: string;
  reason_code: string | null;
  detail: { fields?: number; keys?: string[]; resume?: boolean } | null;
  created_at: string;
};

/** Тип события базы — по нему экран выбирает кружок шага. */
export type TimelineKind =
  | 'created' | 'consent' | 'queued' | 'ready_to_submit' | 'submitted' | 'submitted_manual'
  | 'action_required' | 'duplicate' | 'submission_unknown' | 'retryable_failed' | 'failed';

export type TimelineStep = {
  kind: TimelineKind;
  title: string;
  note?: string;
  at: string;
  tone: 'done' | 'wait' | 'fail' | 'info';
};

// Смысл полей анкеты → по-человечески. Незнакомые ключи просто считаются.
const FIELD_LABELS: Record<string, string> = {
  full_name: 'ФИО', first_name: 'имя', last_name: 'фамилия', patronymic: 'отчество',
  phone: 'телефон', email: 'почта', city: 'город', citizenship: 'гражданство',
  desired_role: 'должность', personal_data_consent: 'согласие на обработку данных',
};

function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

/** «5 полей: имя, телефон, почта · резюме» — что Юпитер вписал в анкету. */
export function fillNote(detail: JupiterEvent['detail']): string | undefined {
  if (!detail || typeof detail.fields !== 'number') return undefined;
  const parts: string[] = [];
  if (detail.fields > 0) {
    const names = (detail.keys ?? []).map(k => FIELD_LABELS[k]).filter(Boolean);
    const count = `${detail.fields} ${plural(detail.fields, 'поле', 'поля', 'полей')}`;
    parts.push(names.length ? `${count}: ${names.join(', ')}` : count);
  }
  if (detail.resume) parts.push('резюме');
  return parts.length ? parts.join(' · ') : undefined;
}

const ACTION_REASONS: Record<string, string> = {
  CAPTCHA_REQUIRED: 'Сайт просит проверку «я не робот» — отправьте сами',
  CAPTCHA_HUMAN: 'Введите слово с картинки — отклик уйдёт сразу',
  PHONE_FILL: 'Анкету заполним за вас — останется нажать «Отправить»',
  SITE_NOT_VERIFIED: 'Сайт ещё подключаем — отклик можно отправить самому',
  CONSENT_REQUIRED: 'Работодатель просит согласие на обработку данных',
  UNSUPPORTED_SCRIPT: 'Сайту нужен браузер — отправьте сами',
  MISSING_PROFILE_FIELD: 'На сайте есть вопрос, ответа на который нет в профиле',
  NEEDS_ANSWERS: 'Работодатель задал вопросы — ответьте, и отклик уйдёт сам',
  LIVE_AUTHORIZATION_REVOKED: 'Автоотклик выключен — отклик не отправлен',
};

function stepFor(e: JupiterEvent): TimelineStep | null {
  const at = e.created_at;
  switch (e.kind) {
    case 'created': return { kind: 'created', title: 'Вы откликнулись', at, tone: 'done' };
    case 'consent': return { kind: 'consent', title: 'Вы дали согласие работодателю', at, tone: 'done' };
    case 'queued': return { kind: 'queued', title: 'В очереди Юпитера', at, tone: 'info' };
    case 'ready_to_submit': return { kind: 'ready_to_submit', title: 'Анкета заполнена, ждёт отправки', note: fillNote(e.detail), at, tone: 'wait' };
    case 'submitted':
      return e.reason_code === 'MANUAL_WEBVIEW'
        ? { kind: 'submitted_manual', title: 'Вы отправили отклик', at, tone: 'done' }
        : { kind: 'submitted', title: 'Юпитер отправил отклик', note: fillNote(e.detail), at, tone: 'done' };
    case 'action_required':
      return {
        kind: 'action_required',
        title: 'Нужны вы',
        note: ACTION_REASONS[e.reason_code ?? ''] ?? 'Юпитер не смог закончить сам',
        at, tone: 'wait',
      };
    case 'duplicate': return { kind: 'duplicate', title: 'Вы уже откликались на эту вакансию', at, tone: 'info' };
    case 'submission_unknown': return { kind: 'submission_unknown', title: 'Заявка ушла, сайт не написал «отправлено»', at, tone: 'wait' };
    case 'retryable_failed': return { kind: 'retryable_failed', title: 'Не получилось — Юпитер попробует ещё раз', at, tone: 'wait' };
    case 'failed': return { kind: 'failed', title: 'Не ушёл — Юпитер споткнулся до отправки', at, tone: 'fail' };
    default: return null;
  }
}

/** История сверху вниз: новое наверху, как у почты и у Sorce. */
export function buildTimeline(events: JupiterEvent[]): TimelineStep[] {
  return events
    .map(stepFor)
    .filter((s): s is TimelineStep => s !== null)
    .reverse();
}
