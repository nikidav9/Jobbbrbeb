import { Like, PermApplication, Vacancy } from '@/constants/types';

/**
 * Счётчики раздела «Мэтчи» — в одном месте для экрана и для значка на вкладке.
 *
 * Раньше их считали дважды: экран в matches.tsx, значок в (tabs)/_layout.tsx.
 * Формулы разошлись, и значок показывал 4 там, где на экране было 2. Лишнее
 * он набирал из «Завершено»: приплюсовывал смены, которые ещё не оценили,
 * а у работника — ещё и вкладку «Отказ».
 *
 * Это не просто расхождение в числе. Ни отказ, ни неоценённая смена сами
 * никуда не деваются, поэтому значок горел бы всегда — а значок, который
 * горит всегда, ничего не сообщает.
 *
 * Поэтому правило: значок считает только то, что ждёт действия и пропадает,
 * когда действие сделано. У работника это «Активные», у работодателя —
 * «Отклики» и «Мэтчи». Завершённое и отказы не в счёт.
 */

// ─── Работник ────────────────────────────────────────────────────────────────

function workerLikes(likes: Like[], userId: string): Like[] {
  return likes.filter(l => l.workerId === userId && l.workerLiked);
}

const workerActive = (my: Like[]): Like[] =>
  my.filter(l => !l.shiftCompleted && !l.cancelled && l.employerLiked !== false);

// ─── Работодатель ────────────────────────────────────────────────────────────

export function employerLikes(likes: Like[], vacancies: Vacancy[], userId: string): Like[] {
  const myVacIds = vacancies.filter(v => v.employerId === userId).map(v => v.id);
  return likes.filter(l => myVacIds.includes(l.vacancyId) && l.workerLiked);
}

export const employerPending = (all: Like[]): Like[] =>
  all.filter(l => !l.isMatch && l.employerLiked !== false);

export const employerMatched = (all: Like[]): Like[] =>
  all.filter(l => l.isMatch && !l.shiftCompleted && !l.cancelled);

export const employerCompleted = (all: Like[]): Like[] =>
  all.filter(l => l.isMatch && (l.shiftCompleted || l.cancelled));

export function employerPermApps(apps: PermApplication[], userId: string): PermApplication[] {
  return apps.filter(a => a.employerId === userId);
}

// ─── Значок на вкладке ───────────────────────────────────────────────────────

export function matchBadgeCount(args: {
  role: 'worker' | 'employer';
  userId: string;
  likes: Like[];
  vacancies: Vacancy[];
  permApplications: PermApplication[];
}): number {
  const { role, userId, likes, vacancies, permApplications } = args;

  if (role === 'worker') {
    return workerActive(workerLikes(likes, userId)).length;
  }

  const all = employerLikes(likes, vacancies, userId);
  const perm = employerPermApps(permApplications, userId);
  // Отклики на постоянные вакансии значок раньше не учитывал вовсе — на
  // экране они есть, а в значке их не было.
  const permWaiting = perm.filter(a => a.status === 'pending' || a.status === 'approved').length;
  return employerPending(all).length + employerMatched(all).length + permWaiting;
}
