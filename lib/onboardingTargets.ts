// Реестр реальных позиций UI-элементов для подсветки в онбординге.
// Элементы регистрируют свою измеренную геометрию (measureInWindow),
// оверлей читает её и рисует точную рамку — без угадывания координат.
export type TargetRect = { x: number; y: number; w: number; h: number };

const targets: Record<string, TargetRect> = {};
const subs = new Set<() => void>();

export function setOnboardingTarget(key: string, rect: TargetRect) {
  const prev = targets[key];
  if (prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h) return;
  targets[key] = rect;
  subs.forEach(fn => fn());
}

export function getOnboardingTarget(key: string): TargetRect | undefined {
  return targets[key];
}

export function clearOnboardingTarget(key: string) {
  if (!targets[key]) return;
  delete targets[key];
  subs.forEach(fn => fn());
}

export function subscribeOnboardingTargets(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

// Булевы флаги состояния экрана (например, есть ли реальная карточка смены)
const flags: Record<string, boolean> = {};

export function setOnboardingFlag(key: string, val: boolean) {
  if (flags[key] === val) return;
  flags[key] = val;
  subs.forEach(fn => fn());
}

export function getOnboardingFlag(key: string): boolean | undefined {
  return flags[key];
}

// ── Перемер по требованию ────────────────────────────────────────────────────
//
// Одного onLayout мало. На iOS первый замер нередко возвращает нули, и тогда
// цель не регистрируется вовсе — а второй попытки не было. Так и вышло с
// вкладкой «Мэтчи» и с кнопкой «+»: подсветка рисовалась по запасным
// координатам, то есть мимо, а когда запасные убрали — не рисовалась совсем.
//
// Теперь элемент оставляет здесь способ измерить себя, а оверлей просит
// перемерить в тот момент, когда собирается рисовать.

const measurers: Record<string, () => void> = {};

export function registerOnboardingMeasurer(key: string, fn: () => void): () => void {
  measurers[key] = fn;
  return () => { if (measurers[key] === fn) delete measurers[key]; };
}

export function measureOnboardingTargets(): void {
  Object.values(measurers).forEach(fn => { try { fn(); } catch {} });
}
