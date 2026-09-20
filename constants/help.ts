/**
 * Рабочие часы живой поддержки.
 *
 * База вопросов и ответов больше не дублируется в клиентском bundle:
 * актуальные статьи живут в jm_support_knowledge и приходят через
 * авторизованный PHP-прокси. Так помощник, FAQ и дашборд не расходятся.
 */
export const SUPPORT_FROM_HOUR = 10;
export const SUPPORT_TO_HOUR = 21;

/** Работает ли живой оператор прямо сейчас (по Москве). */
export function supportIsOpen(now: Date = new Date()): boolean {
  const mskHour = (now.getUTCHours() + 3) % 24;
  return mskHour >= SUPPORT_FROM_HOUR && mskHour < SUPPORT_TO_HOUR;
}
