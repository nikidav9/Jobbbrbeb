/**
 * Фильтры ленты — общие для ленты и экранов фильтров (app/filters/*, макет
 * «JT-filters», 27.09.2026: отдельные полноэкранные экраны, а не шторки).
 *
 * `applied` — то, по чему лента выбирает вакансии. `draft` — черновик экрана
 * «Все фильтры»: там можно поправить несколько разделов и только потом нажать
 * «Показать N вакансий». Экраны 02–04 открываются из ленты (правят `applied`)
 * или из «Всех фильтров» (правят `draft`) — куда писать, решает параметр `from`.
 */
import { useSyncExternalStore } from 'react';
import { EMPTY_FEED_FILTERS, type FeedFilters } from '@/services/feedFilters';

let applied: FeedFilters = EMPTY_FEED_FILTERS;
let draft: FeedFilters = EMPTY_FEED_FILTERS;
const listeners = new Set<() => void>();

function emit() { listeners.forEach(l => l()); }
function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function getAppliedFilters(): FeedFilters { return applied; }

export function setAppliedFilters(next: FeedFilters | ((f: FeedFilters) => FeedFilters)): void {
  applied = typeof next === 'function' ? next(applied) : next;
  emit();
}

export function useAppliedFilters(): FeedFilters {
  return useSyncExternalStore(subscribe, () => applied, () => applied);
}

/** Открыли «Все фильтры» — черновик начинается с того, что сейчас в ленте. */
export function beginDraft(): void { draft = applied; emit(); }

export function getDraft(): FeedFilters { return draft; }

export function setDraft(next: FeedFilters | ((f: FeedFilters) => FeedFilters)): void {
  draft = typeof next === 'function' ? next(draft) : next;
  emit();
}

export function useDraft(): FeedFilters {
  return useSyncExternalStore(subscribe, () => draft, () => draft);
}

/** «Показать N вакансий» — черновик становится фильтром ленты. */
export function commitDraft(): void { applied = draft; emit(); }

export type FilterOrigin = 'feed' | 'all';

/** Откуда открыт экран 02–04: оттуда берём исходный выбор и туда же пишем. */
export function filtersFor(from: FilterOrigin): FeedFilters { return from === 'all' ? draft : applied; }

export function applyFor(from: FilterOrigin, patch: Partial<FeedFilters>): void {
  if (from === 'all') setDraft(f => ({ ...f, ...patch }));
  else setAppliedFilters(f => ({ ...f, ...patch }));
}

// Поиск «Вакансия или стек» живёт в шапке ленты; экран фильтров учитывает его
// в «Показать N вакансий», чтобы число совпало с тем, что покажет лента.
let feedQuery = '';
export function setFeedQuery(q: string): void { feedQuery = q; }
export function getFeedQuery(): string { return feedQuery; }
