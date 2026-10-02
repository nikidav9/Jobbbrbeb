'use client'

/**
 * Шапка панели: кнопка меню, название раздела, переключатель темы и выход.
 *
 * Про тему. Прежняя система темы не имела вовсе — панель была только светлой,
 * и это было решением: с ней работают днём с одного рабочего места. TailAdmin
 * приносит обе, поэтому светлая осталась значением по умолчанию, а тёмная —
 * выбором того, кто смотрит. Выбор запоминается в браузере.
 */

import { usePathname } from 'next/navigation'
import { useSidebar } from '@/context/SidebarContext'
import { labelFor } from '@/lib/nav'
import { clearAuth } from '../AuthGuard'

export default function AppHeader() {
  const { isMobileOpen, toggleSidebar, toggleMobileSidebar } = useSidebar()
  const path = usePathname()

  return (
    <header className="sticky top-0 z-40 flex w-full border-b-2 border-gray-900 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            aria-label="Меню"
            onClick={() => {
              // На узком экране меню выезжает поверх страницы, на широком —
              // сворачивается до значков. Кнопка одна, поведение разное.
              if (window.innerWidth < 1024) toggleMobileSidebar()
              else toggleSidebar()
            }}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-gray-900 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5"
          >
            {isMobileOpen ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>

          <h1 className="truncate font-display text-sm font-bold text-gray-900 dark:text-white/90">
            {labelFor(path)}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => { clearAuth(); window.location.replace('/login/') }}
            className="rounded-full border-2 border-gray-900 px-3 py-2 text-theme-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Выйти
          </button>
        </div>
      </div>
    </header>
  )
}
