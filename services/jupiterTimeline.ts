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

function stateStatus(state: JupiterApplicationState): JupiterStatus {
  switch (state) {
    case 'ready_to_submit': return { label: 'Анкета заполнена · не отправлена', ...WAIT };
    case 'submitted': return { label: 'Отправлено', ...DONE };
    case 'action_required': return { label: 'Нужно ваше участие', ...WAIT };
    case 'submission_unknown': return { label: 'Отправка не подтверждена', ...WAIT };
    case 'failed': return { label: 'Не удалось заполнить', ...FAIL };
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
  if (a.reasonCode === 'UNSUPPORTED_SCRIPT') return { label: 'Нужен браузер · отклик не отправлен', ...WAIT };
  if (a.reasonCode === 'SITE_NOT_VERIFIED') return { label: 'Сайт ещё подключаем · отклик сохранён', ...INFO };
  if (a.state === 'submitted' && a.reasonCode === 'MANUAL_WEBVIEW') return { label: 'Отправлено вами', ...DONE };
  return stateStatus(a.state);
}

export type JupiterBadge = { label: string; tone: 'sent' | 'needs_you' | 'failed' | 'working' | 'closed' };

/** Метка строки списка — как у Sorce: ОТПРАВЛЕНО / НУЖНЫ ВЫ / НЕ ПОЛУЧИЛОСЬ / В РАБОТЕ. */
export function jupiterBadge(a: JupiterApplication): JupiterBadge {
  if (a.state === 'submitted' || a.state === 'duplicate') return { label: 'ОТПРАВЛЕНО', tone: 'sent' };
  if (jupiterVacancyClosed(a)) return { label: 'ЗАКРЫТА', tone: 'closed' };
  if (a.state === 'failed') return { label: 'НЕ ПОЛУЧИЛОСЬ', tone: 'failed' };
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
    case 'failed': return 'Не получилось заполнить анкету';
    case 'retryable_failed': return 'Не получилось — Юпитер попробует ещё раз';
    case 'ready_to_submit': return a.submissionAuthorizedAt
      ? 'Анкета заполнена, ждёт отправки'
      : 'Анкета заполнена — включите автоотклик';
    case 'submission_unknown': return 'Сайт не подтвердил отправку';
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

export type TimelineStep = {
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
  SITE_NOT_VERIFIED: 'Сайт ещё подключаем — отклик можно отправить самому',
  CONSENT_REQUIRED: 'Работодатель просит согласие на обработку данных',
  UNSUPPORTED_SCRIPT: 'Сайту нужен браузер — отправьте сами',
  MISSING_PROFILE_FIELD: 'На сайте есть вопрос, ответа на который нет в профиле',
  LIVE_AUTHORIZATION_REVOKED: 'Автоотклик выключен — отклик не отправлен',
};

function stepFor(e: JupiterEvent): TimelineStep | null {
  const at = e.created_at;
  switch (e.kind) {
    case 'created': return { title: 'Вы откликнулись', at, tone: 'done' };
    case 'consent': return { title: 'Вы дали согласие работодателю', at, tone: 'done' };
    case 'queued': return { title: 'В очереди Юпитера', at, tone: 'info' };
    case 'ready_to_submit': return { title: 'Анкета заполнена, ждёт отправки', note: fillNote(e.detail), at, tone: 'wait' };
    case 'submitted':
      return e.reason_code === 'MANUAL_WEBVIEW'
        ? { title: 'Вы отправили отклик', at, tone: 'done' }
        : { title: 'Юпитер отправил отклик', note: fillNote(e.detail), at, tone: 'done' };
    case 'action_required':
      return {
        title: 'Нужны вы',
        note: ACTION_REASONS[e.reason_code ?? ''] ?? 'Юпитер не смог закончить сам',
        at, tone: 'wait',
      };
    case 'duplicate': return { title: 'Вы уже откликались на эту вакансию', at, tone: 'info' };
    case 'submission_unknown': return { title: 'Сайт не подтвердил отправку', at, tone: 'wait' };
    case 'retryable_failed': return { title: 'Не получилось — Юпитер попробует ещё раз', at, tone: 'wait' };
    case 'failed': return { title: 'Не получилось отправить', at, tone: 'fail' };
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
