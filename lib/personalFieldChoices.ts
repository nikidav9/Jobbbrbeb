import type { PersonalDetails } from '@/constants/types';

/**
 * Справочник полей вкладки «Личные»: подписи, варианты выбора, плейсхолдеры.
 *
 * Отдельный модуль, а не локальные константы `app/(tabs)/profile.tsx` —
 * нужен и экрану (модалка редактирования), и `components/profile/PersonalTabContent.tsx`
 * (отображение значений). Импорт из файла маршрута создал бы циклическую
 * зависимость, поэтому справочник переехал сюда общим для обоих.
 */

export type PersonalFieldKey = keyof PersonalDetails;

export const PERSONAL_FIELD_LABELS: Record<PersonalFieldKey, string> = {
  middleName: 'Отчество',
  preferredName: 'Как к вам обращаться',
  // Legacy-поле из старой US-анкеты. Сохраняем совместимость с данными,
  // но отдельный пункт «Обращение» в русской анкете больше не показываем.
  title: 'Форма обращения',
  contactEmail: 'Email',
  links: 'Ссылки',
  citizenship: 'Гражданство',
  workAuthorization: 'Статус разрешения на работу',
  location: 'Местоположение',
  workAvailability: 'Когда вы готовы работать',
  relocation: 'Готовы к переезду?',
  driversLicense: 'Есть водительские права?',
  employmentRestrictions: 'Ограничения по трудоустройству',
  // Новые структурные поля — экраны docs/design/profile-edit/personal/*.html
  // (lib/profileEdit.ts). Подписи здесь не показываются напрямую (экраны
  // используют свои заголовки), но нужны для полноты Record<PersonalFieldKey>.
  showAge: 'Показывать возраст',
  showPhone: 'Показывать номер телефона',
  workAuthorizationCountries: 'Где можете работать без визы',
  metroStations: 'Станции метро',
  employmentTypes: 'Занятость',
  workFormats: 'Формат работы',
  schedule: 'График работы',
  linksList: 'Ссылки',
  relocationCities: 'Города для переезда',
  drivingCategories: 'Категории водительских прав',
  hasOwnCar: 'Есть личный автомобиль',
  hasEmploymentRestrictions: 'Есть ограничения по трудоустройству',
  applyAnswers: 'Ответы для откликов',
  applyAnswersPromptDismissed: 'Карточка «Ответьте один раз» закрыта',
};

export const PERSONAL_MULTILINE = new Set<PersonalFieldKey>([
  'links',
  'employmentRestrictions',
]);

type PersonalChoice = { label: string; value: string };

export const PERSONAL_FIELD_CHOICES: Partial<Record<PersonalFieldKey, PersonalChoice[]>> = {
  workAuthorization: [
    { label: 'Есть разрешение', value: 'Есть разрешение' },
    { label: 'Не требуется', value: 'Не требуется' },
    { label: 'Нет', value: 'Нет' },
  ],
  relocation: [
    { label: 'Да', value: 'Да' },
    { label: 'Нет', value: 'Нет' },
    { label: 'Готов(а) рассмотреть', value: 'Готов(а) рассмотреть' },
  ],
  driversLicense: [
    { label: 'Да', value: 'Да' },
    { label: 'Нет', value: 'Нет' },
  ],
};

export const PERSONAL_FIELD_PLACEHOLDERS: Partial<Record<PersonalFieldKey, string>> = {
  middleName: 'Например, Сергеевич',
  preferredName: 'Например, Никита',
  contactEmail: 'name@example.com',
  links: 'Ссылка на портфолио, сайт или профиль',
  citizenship: 'Например, Россия',
  location: 'Например, Москва',
  workAvailability: 'Например, полная занятость, будни',
  employmentRestrictions: 'Опишите ограничение, если оно есть',
};

export function normalizePersonalChoiceValue(field: PersonalFieldKey, value?: string): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (['yes', 'true'].includes(v)) return 'Да';
  if (['no', 'false'].includes(v)) return 'Нет';
  return value;
}
