/**
 * «80 000 ₽/мес» (или «₽/ч», если период — 'hour'). Разделитель тысяч — от
 * toLocaleString('ru-RU'), как и было во всех экранах до выноса сюда.
 * Не путать с formatSalary в lib/profileEdit.ts: там обычный пробел и «на руки».
 */
export function formatRubPerPeriod(amount: number, period?: string | null): string {
  return `${amount.toLocaleString('ru-RU')} ₽/${period === 'hour' ? 'ч' : 'мес'}`;
}
