/**
 * Дневной запас откликов — «молнии» в шапке ленты.
 *
 * Единицу стоит отклик (свайп вправо или кнопка «♥»). Пропуск бесплатный —
 * решение владельца 26.09: молния — цена отклика, а не просмотра. Запас
 * даётся раз в сутки и НЕ копится: вчерашний остаток сгорает. Это временная
 * мера, пока нет монетизации: она ограничивает не деньгами, а вниманием —
 * сорок откликов в день человек ещё отправляет осмысленно, четыреста уже нет.
 *
 * Здесь только чистая логика, без хранилища: хранение в AsyncStorage лежит в
 * hooks/useEnergy.ts. Разделено ради проверки — правило «не копится» ломается
 * молча, и тест на него (tests/energy.test.ts) запускается в обычном node,
 * куда нативные модули не тянутся.
 */

/** Сколько откликов даётся на сутки. */
export const DAILY_ENERGY = 40;

export interface EnergyState {
  /** День, за который выдан запас, в местном времени. */
  day: string;
  /** Сколько свайпов осталось. */
  left: number;
}

/**
 * Ключ дня по МЕСТНОМУ времени.
 *
 * toISOString() здесь был бы ошибкой: он отдаёт UTC, и у московского
 * пользователя запас обновлялся бы в три часа ночи, а с трёх до полуночи
 * первого числа сутки считались бы уже следующими.
 */
export function energyDay(d: Date = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Что должно лежать в хранилище на указанный день.
 *
 * Другой день или пусто — полный запас заново. Остаток прошлого дня не
 * переносится: в этом и смысл «не копится».
 */
export function rollover(stored: EnergyState | null | undefined, day: string): EnergyState {
  if (!stored || stored.day !== day) return { day, left: DAILY_ENERGY };
  // Подстраховка от испорченной записи: в хранилище лежит то, что туда
  // положили, а положить туда могли что угодно — вплоть до правки руками.
  const left = Number.isFinite(stored.left) ? Math.floor(stored.left) : DAILY_ENERGY;
  return { day, left: Math.max(0, Math.min(DAILY_ENERGY, left)) };
}

/** Списать свайп. Ниже нуля не уходим. */
export function spend(s: EnergyState, n = 1): EnergyState {
  return { day: s.day, left: Math.max(0, s.left - n) };
}

/**
 * Вернуть свайп — это делает кнопка возврата вакансии.
 *
 * Выше дневного запаса не поднимаем: иначе «свайпнул — вернул» по кругу
 * печатало бы энергию из воздуха.
 */
export function refund(s: EnergyState, n = 1): EnergyState {
  return { day: s.day, left: Math.min(DAILY_ENERGY, s.left + n) };
}

/** Разбор записи из хранилища. Мусор — как будто записи нет. */
export function parseEnergy(raw: string | null): EnergyState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return null;
    const { day, left } = v as Partial<EnergyState>;
    if (typeof day !== 'string' || typeof left !== 'number') return null;
    return { day, left };
  } catch {
    return null;
  }
}
