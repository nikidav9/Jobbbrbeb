/**
 * Связка ленты и экрана «Вакансия подробно» (app/ext-vacancy.tsx).
 *
 * Отдельной серверной функции «карьерная вакансия по id» нет, а карточка в
 * колоде уже держит всю вакансию — лента кладёт её сюда перед переходом.
 * Обратно экран отдаёт решение (✕ или ♥): по README макета действия на нём
 * работают так же, как свайпы, — лента забирает его при возврате фокуса и
 * смахивает ту же карточку, если она всё ещё сверху.
 */
import type { ExtVacancy } from '@/constants/types';

let opened: ExtVacancy | null = null;
let pending: { id: string; action: 'want' | 'skip' } | null = null;

export function openExtVacancy(v: ExtVacancy): void { opened = v; }

export function getOpenedExtVacancy(id?: string): ExtVacancy | null {
  return opened && (!id || opened.id === id) ? opened : null;
}

export function setDeckAction(id: string, action: 'want' | 'skip'): void { pending = { id, action }; }

/** Забрать решение один раз: второй вызов вернёт null. */
export function takeDeckAction(): { id: string; action: 'want' | 'skip' } | null {
  const p = pending;
  pending = null;
  return p;
}
