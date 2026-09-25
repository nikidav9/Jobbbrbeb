// Официальные логотипы работодателей из каталога карьерных сайтов.
//
// Каждый файл взят с сайта самой компании (иконка сайта, apple-touch-icon)
// и приведён к 128×128 PNG; источники — ниже. Картинки лежат в сборке, а не
// тянутся с чужих сайтов при показе: так карточка не ходит к работодателю
// при каждом свайпе и не зависит от его доступности. Нет логотипа —
// CompanyMark рисует инициалы, как раньше.
//
// Источники (25.09.2026):
//   amoCRM: https://www.amocrm.ru/favicon.ico
//   Bell Integrator: https://bellintegrator.ru/themes/bell-bootstrap/bellbootstrap/favicon.ico
//   IBS: https://ibs.ru/favicon.png?2022
//   Inline Group: https://inlinegroup.ru/favicon.ico
//   Just AI: https://just-ai.com/wp-content/themes/justai_ru/img/favicon/apple-touch-icon-114x114.png
//   Kaspersky: https://www.kaspersky.ru/favicon.ico
//   kokos group: https://kokocgroup.ru/static/core/img/favicon.png
//   Koronatech: https://koronatech.ru/resources/browser/apple-touch-icon.png
//   Lesta Games: https://lesta.ru/favicon.ico
//   METRO: https://www.metro-cc.ru/favicon.ico
//   Mish: https://mish.design/favicon/apple-touch-icon.png
//   Navio: https://navio.auto/images/favicon.png
//   Orion soft: https://www.orionsoft.ru/img/favicons/apple-touch-icon-152x152.png
//   X5 Tech: https://x5.tech/_next/static/media/faviconName.fb892b5f.png
//   Авито: https://www.avito.ru/apple-touch-icon.png
//   ВкусВилл: https://vkusvill.ru/apple-touch-icon.png?v=1
//   Контур: https://s.kontur.ru/common-v2/icons-products/kontur/favicon/kontur-favicon-180.png
//   Магнит: https://magnit.ru/apple-touch-icon.png
//   Норникель: https://nornickel.ru/images/icons/apple-touch-icon.png
//   Островок: https://f.worldota.net/ostrota/theme/ostrovok_v2/favicon-20240322165030.png
//   Петрович: https://petrovichjob.ru/favicon.ico
//   Сбер: https://rabota.sber.ru/favicon/icon180.png
//   Селектел: https://selectel.ru/apple-touch-icon.png
//   Техвилл: https://techvill.ru/icon.jpg

const LOGOS: Record<string, number> = {
  "amocrm": require('@/assets/logos/amocrm.png'),
  "bell integrator": require('@/assets/logos/bell-integrator.png'),
  "ibs": require('@/assets/logos/ibs.png'),
  "inline group": require('@/assets/logos/inline-group.png'),
  "just ai": require('@/assets/logos/just-ai.png'),
  "kaspersky": require('@/assets/logos/kaspersky.png'),
  "kokos group": require('@/assets/logos/kokos-group.png'),
  "koronatech": require('@/assets/logos/koronatech.png'),
  "lesta games": require('@/assets/logos/lesta-games.png'),
  "metro": require('@/assets/logos/metro.png'),
  "mish": require('@/assets/logos/mish.png'),
  "navio": require('@/assets/logos/navio.png'),
  "orion soft": require('@/assets/logos/orion-soft.png'),
  "x5 tech": require('@/assets/logos/x5-tech.png'),
  "авито": require('@/assets/logos/avito.png'),
  "вкусвилл": require('@/assets/logos/vkusvill.png'),
  "контур": require('@/assets/logos/kontur.png'),
  "магнит": require('@/assets/logos/magnit.png'),
  "норникель": require('@/assets/logos/nornickel.png'),
  "островок": require('@/assets/logos/ostrovok.png'),
  "петрович": require('@/assets/logos/petrovich.png'),
  "сбер": require('@/assets/logos/sber.png'),
  "селектел": require('@/assets/logos/selectel.png'),
  "техвилл": require('@/assets/logos/techvill.png'),
};

export function companyLogo(company?: string | null): number | null {
  if (!company) return null;
  return LOGOS[company.trim().toLowerCase()] ?? null;
}
