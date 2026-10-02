'use client'

/**
 * Боковое меню — раскладка и поведение TailAdmin, разделы наши.
 *
 * Список берётся из lib/nav.ts, а не переписывается здесь: это единственный
 * источник разделов, и добавленная там строка появляется в меню сама. Группы
 * оттуда же — двадцать девять пунктов подряд глаз перебирает по одному,
 * шесть групп по три-пять просматриваются целиком.
 *
 * Свёрнутое состояние (90px) показывает только значки, развёрнутое (290px) —
 * значки с подписями; при наведении на свёрнутое меню оно временно
 * разворачивается. На узком экране меню уезжает за край и открывается
 * кнопкой в шапке, затемняя страницу (Backdrop).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSidebar } from '@/context/SidebarContext'
import { NAV, GROUPS } from '@/lib/nav'
import { navIcon, IconLock } from './navIcons'

export default function AppSidebar() {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar()
  const rawPath = usePathname()
  const path = rawPath.replace(/\/$/, '') || '/'

  // Подписи видны, когда меню развёрнуто, открыто на телефоне или под курсором.
  const wide = isExpanded || isMobileOpen || isHovered

  return (
    <aside
      className={`fixed top-0 left-0 z-50 flex h-screen flex-col border-r-2 border-gray-900 bg-white px-5 text-gray-900 transition-all duration-300 ease-in-out dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100
        ${wide ? 'w-[290px]' : 'w-[90px]'}
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={`flex items-center gap-3 py-6 ${wide ? 'justify-start' : 'justify-center'}`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border-2 border-gray-900 bg-[#ff6b1a] font-display text-sm font-bold text-gray-900 shadow-sticker-sm">
          J
        </span>
        {wide ? (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">JobToo</span>
            <span className="block truncate text-theme-xs text-gray-500 dark:text-gray-400">Панель управления</span>
          </span>
        ) : null}
      </div>

      {/* Прокручивается только список: меню остаётся на месте, когда листают таблицу. */}
      <nav className="flex-1 overflow-y-auto overscroll-contain pb-6">
        {GROUPS.map(group => {
          const items = NAV.filter(n => n.group === group)
          if (!items.length) return null
          return (
            <div key={group} className="mb-4">
              <h3
                className={`mb-2 text-theme-xs uppercase tracking-wider text-gray-400 ${
                  wide ? 'px-3 text-left' : 'text-center'
                }`}
              >
                {wide ? group : '•••'}
              </h3>
              <ul className="flex flex-col gap-1">
                {items.map(item => {
                  const Icon = navIcon(item.icon)
                  const active = path === item.href

                  if (item.locked) {
                    return (
                      <li key={item.href}>
                        <span
                          aria-disabled="true"
                          title="Раздел станет доступен после запуска оплаты"
                          className="menu-item menu-item-inactive cursor-not-allowed opacity-60"
                        >
                          <span className="relative grid place-items-center">
                            <Icon className="h-5 w-5" />
                            <IconLock className="absolute -right-1 -top-1 h-3 w-3" />
                          </span>
                          {wide ? <span className="truncate">{item.label}</span> : null}
                        </span>
                      </li>
                    )
                  }

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`menu-item group ${active ? 'menu-item-active' : 'menu-item-inactive'} ${
                          wide ? '' : 'justify-center'
                        }`}
                      >
                        <Icon
                          className={`h-5 w-5 shrink-0 ${
                            active ? 'menu-item-icon-active' : 'menu-item-icon-inactive'
                          }`}
                        />
                        {wide ? <span className="truncate">{item.label}</span> : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
