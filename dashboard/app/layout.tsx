import type { Metadata, Viewport } from 'next'
// Шрифты — из пакета, а не из Google.
//
// В globals.css стоял @import с fonts.googleapis.com: браузер шёл за
// шрифтом при каждом открытии страницы. Из России этот адрес отвечает
// через раз, и дашборд то грузился долго, то показывался без оформления —
// а понять причину по внешнему виду невозможно.
//
// Плюс это была лишняя зарубежная зависимость: при каждом заходе адрес
// того, кто открыл дашборд, уходил в Google.
//
// Пакет geist кладёт те же самые шрифты рядом со сборкой, и они
// отдаются с нашего сервера. Вид не меняется.
import './globals.css'
import Shell from '@/components/Shell'
import SwRegister from '@/components/SwRegister'

export const metadata: Metadata = {
  title: 'JobToo — Аналитика',
  description: 'Аналитический дашборд JobToo',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'JobToo',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: '/icon-192.svg',
    apple: '/icon-192.svg',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Тот же серый, что у фона панели (--bg → gray-50 из палитры TailAdmin):
  // этим цветом браузер красит свою полосу вокруг страницы.
  themeColor: '#f5efe6',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Shell>{children}</Shell>
        <SwRegister />
      </body>
    </html>
  )
}
