import type { WorkType } from './types';

// Разделы ленты. Правила «название → раздел» живут на сервере
// (php-proxy/job_sections.php); здесь только подписи и порядок показа.
// Идентификаторы обязаны совпадать — это проверяет tests/job_sections_test.php.
export type JobSection =
  | 'it' | 'warehouse' | 'delivery' | 'transport' | 'retail' | 'food'
  | 'production' | 'service' | 'sales' | 'finance' | 'office'
  | 'marketing' | 'medical' | 'engineering' | 'other';

export const JOB_SECTIONS: { id: JobSection; label: string }[] = [
  { id: 'it', label: 'IT и разработка' },
  { id: 'warehouse', label: 'Склад и логистика' },
  { id: 'delivery', label: 'Курьеры и доставка' },
  { id: 'transport', label: 'Водители и транспорт' },
  { id: 'retail', label: 'Магазины и торговый зал' },
  { id: 'food', label: 'Кафе и рестораны' },
  { id: 'production', label: 'Производство и рабочие' },
  { id: 'service', label: 'Уборка, охрана, сервис' },
  { id: 'sales', label: 'Продажи и клиенты' },
  { id: 'finance', label: 'Финансы и бухгалтерия' },
  { id: 'office', label: 'Офис, HR и юристы' },
  { id: 'marketing', label: 'Маркетинг и дизайн' },
  { id: 'medical', label: 'Медицина и аптеки' },
  { id: 'engineering', label: 'Инженеры и стройка' },
  { id: 'other', label: 'Другое' },
];

/** Свои вакансии JobToo: раздел по виду работ, который выбрал работодатель. */
export const SECTION_BY_WORK_TYPE: Record<WorkType, JobSection> = {
  stocker: 'warehouse',
  picker: 'warehouse',
  shift_supervisor: 'warehouse',
  cook: 'food',
};
