'use client'

/**
 * Каркас панели.
 *
 * Раскладка — TailAdmin: меню закреплено слева и само сдвигает содержимое,
 * сверху шапка. Прежний вариант (grid из двух колонок плюс отдельное нижнее
 * меню для телефона) убран: на узком экране меню теперь выезжает поверх
 * страницы, как во всей остальной панели TailAdmin, и второй список разделов
 * больше не нужен — а именно он раньше молча расходился с боковым.
 *
 * Что осталось прежним: проверка входа и адрес, который её не проходит —
 * страница входа.
 */

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { isAuthed } from '@/lib/auth'
import { SidebarProvider, useSidebar } from '@/context/SidebarContext'
import { ThemeProvider } from '@/context/ThemeContext'
import AppSidebar from './layout/AppSidebar'
import AppHeader from './layout/AppHeader'
import Backdrop from './layout/Backdrop'

function getBase(): string {
  if (typeof window === 'undefined') return ''
  return window.location.pathname.startsWith('/JobToo') ? '/JobToo' : ''
}

function isOnLoginPage(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname.replace(/\/$/, '').endsWith('/login')
}

/** Содержимое сдвигается ровно на ширину меню — иначе оно уедет под него. */
function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar()
  const margin = isMobileOpen
    ? 'ml-0'
    : isExpanded || isHovered
      ? 'lg:ml-[290px]'
      : 'lg:ml-[90px]'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AppSidebar />
      <Backdrop />
      <div className={`flex min-h-screen flex-1 flex-col transition-all duration-300 ease-in-out ${margin}`}>
        <AppHeader />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null)
  // Адрес берётся хуком, а не из window: window на сервере нет, там любая
  // проверка по нему ложна. Если решать по ней, сервер нарисует заглушку, а
  // браузер — саму страницу, и React ругается на несовпадение разметки.
  // Проверки по window остаются рядом — они нужны для варианта, когда панель
  // открыта в подкаталоге /JobToo, где путь из хука не совпадает с адресом.
  const rawPath = usePathname()
  const path = rawPath.replace(/\/$/, '') || '/'
  const outsidePanel = path === '/login'

  useEffect(() => {
    if (outsidePanel || isOnLoginPage()) {
      setAuthed(true)
      return
    }
    if (isAuthed()) {
      setAuthed(true)
    } else {
      window.location.replace(getBase() + '/login/')
    }
  }, [outsidePanel])

  if (outsidePanel || isOnLoginPage()) {
    return <>{children}</>
  }

  if (authed === null) {
    return <div className="min-h-screen bg-gray-50 dark:bg-gray-950" />
  }

  return (
    <ThemeProvider>
      <SidebarProvider>
        <AdminLayout>{children}</AdminLayout>
      </SidebarProvider>
    </ThemeProvider>
  )
}
