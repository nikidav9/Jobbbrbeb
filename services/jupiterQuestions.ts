// Чистая логика экрана «Вопросы работодателей» (app/jupiter-questions.tsx):
// без React Native, чтобы проверялась node:test.
import type { JupiterQuestion } from '@/services/db';

/** Дата через `days` дней в формате, который Юпитер вводит и в поле даты, и в текст. */
export function dateAfter(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** Черновик годится только тот, что сайт примет: у списка — один из вариантов. */
export function usableDraft(q: Pick<JupiterQuestion, 'type' | 'options' | 'draft'>): string {
  const draft = (q.draft ?? '').trim();
  if (!draft) return '';
  if (q.type === 'choice' && q.options.length > 0) {
    return q.options.some(o => o.label === draft) ? draft : '';
  }
  return draft;
}
