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
  { href: '/users',       label: 'Пользователи',         short: 'Люди',     icon: 'users',   group: 'Люди' },
  { href: '/dormant',     label: 'Ни разу не заходили',  short: 'Спящие',   icon: 'clock',   group: 'Люди' },
  { href: '/vacancies',   label: 'Вакансии',                                icon: 'jobs',    group: 'Работа' },
  { href: '/external',    label: 'Внешние вакансии',     short: 'Внешние',  icon: 'jobs',    group: 'Работа' },
  { href: '/jupiter',     label: 'Юпитер',                                  icon: 'funnel',  group: 'Работа' },
  { href: '/support',     label: 'Поддержка',                               icon: 'ticket',  group: 'Общение' },
  { href: '/broadcast',   label: 'Рассылка',                                icon: 'bell',    group: 'Общение' },
  { href: '/health',      label: 'Доступность',          short: 'Аптайм',   icon: 'pulse',   group: 'Система' },
  { href: '/api-keys',    label: 'Ключи API',            short: 'API',      icon: 'shield',  group: 'Система' },
  { href: '/funnel',      label: 'Воронка',                                 icon: 'funnel',  group: 'Аналитика' },
]

/** Название раздела по адресу — для заголовка страницы. */
export function labelFor(path: string): string {
  const p = path.replace(/\/$/, '') || '/'
  return NAV.find(n => n.href === p)?.label ?? p
}
