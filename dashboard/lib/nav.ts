import type { ComponentType } from 'react'

/**
 * Разделы панели — одним списком.
 *
 * До этого их было два: свой в боковом меню и свой в нижнем, для телефона.
 * Списки разошлись молча — новые разделы («Ни разу не заходили», «Ключи API»)
 * появились в одном и не появились в другом, и с телефона их просто не
 * существовало. Заметить такое можно только случайно.
 *
 * Теперь список один. Добавили строку — раздел появился везде.
 */
export type NavItem = {
  href: string
  label: string
  /** Короткая подпись для нижнего меню на телефоне, где места мало. */
  short?: string
  icon: string
  /** Группа в боковом меню. Двадцать два пункта подряд не читаются. */
  group: Group
  /** Раздел виден в меню, но недоступен до запуска монетизации. */
  locked?: boolean
}

export type Group = 'Обзор' | 'Люди' | 'Работа' | 'Общение' | 'Аналитика' | 'Система'

export const GROUPS: Group[] = ['Обзор', 'Люди', 'Работа', 'Общение', 'Аналитика', 'Система']

export const NAV: NavItem[] = [
  { href: '/',            label: 'Обзор',                short: 'Обзор',    icon: 'grid',    group: 'Обзор' },
  { href: '/summary',     label: 'Сводка',                                  icon: 'summary', group: 'Обзор' },
  { href: '/users',       label: 'Пользователи',         short: 'Люди',     icon: 'users',   group: 'Люди' },
  { href: '/last-seen',   label: 'Последний вход',       short: 'Входы',    icon: 'clock',   group: 'Люди' },
  { href: '/dormant',     label: 'Ни разу не заходили',  short: 'Спящие',   icon: 'clock',   group: 'Люди' },
  { href: '/vacancies',   label: 'Вакансии',                                icon: 'jobs',    group: 'Работа' },
  { href: '/jupiter',     label: 'Юпитер',                                  icon: 'funnel',  group: 'Работа' },
  { href: '/outreach',    label: 'Обзвон',                                  icon: 'phone',   group: 'Люди' },
  { href: '/support',     label: 'Поддержка',                               icon: 'ticket',  group: 'Общение' },
  { href: '/matching',    label: 'Совпадения',           short: 'Матчи',    icon: 'match',   group: 'Работа' },
  { href: '/engagement',  label: 'Активность',                              icon: 'pulse',   group: 'Аналитика' },
  { href: '/quality',     label: 'Качество',                                icon: 'star',    group: 'Работа' },
  { href: '/chats',       label: 'Переписки',            short: 'Чаты',     icon: 'chat',    group: 'Общение' },
  { href: '/reviews',     label: 'Отзывы',                                  icon: 'review',  group: 'Работа' },
  { href: '/moderation',  label: 'Модерация',                               icon: 'shield',  group: 'Работа' },
  { href: '/tickets',     label: 'Тикеты',                                  icon: 'ticket',  group: 'Общение' },
  { href: '/broadcast',   label: 'Рассылка',                                icon: 'bell',    group: 'Общение' },
  { href: '/health',      label: 'Доступность',          short: 'Аптайм',   icon: 'pulse',   group: 'Система' },
  { href: '/api-keys',    label: 'Ключи API',            short: 'API',      icon: 'shield',  group: 'Система' },
  { href: '/billing',     label: 'К счёту',              short: 'Счёт',     icon: 'summary', group: 'Аналитика', locked: true },
  { href: '/funnel',      label: 'Воронка',                                 icon: 'funnel',  group: 'Аналитика' },
  { href: '/cohorts',     label: 'Когорты',                                 icon: 'cohort',  group: 'Аналитика' },
  { href: '/geo',         label: 'Гео',                                     icon: 'geo',     group: 'Аналитика' },
  { href: '/activity',    label: 'Лог действий',         short: 'Лог',      icon: 'pulse',   group: 'Аналитика' },
]

/** Название раздела по адресу — для заголовка страницы. */
export function labelFor(path: string): string {
  const p = path.replace(/\/$/, '') || '/'
  return NAV.find(n => n.href === p)?.label ?? p
}
