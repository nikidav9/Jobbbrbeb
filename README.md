# JobToo — сервис поиска работы и подработки

**JobToo** — мобильное приложение (iOS + Android) и веб-сервис для быстрого поиска подработок и постоянной работы в Москве. Работники находят смены рядом с домом, работодатели — нужных сотрудников. Матчинг, чат и уведомления — всё внутри одного приложения.

**Оператор:** Давыдов Никита Сергеевич (ИНН: 773423983287)  
**Контакт:** support@jobtoo.ru  
**Веб-версия:** [jobtoo.ru](https://jobtoo.ru)

---

## Содержание

- [Функционал](#функционал)
- [Технологии](#технологии)
- [Архитектура](#архитектура)
- [База данных](#база-данных)
- [Запуск локально](#запуск-локально)
- [Деплой](#деплой)
- [Структура проекта](#структура-проекта)

---

## Функционал

### Для работников
- **Лента подработок** — свайп-карточки по дате и станции метро (♥ / ✕)
- **Лента постоянной работы** — фильтрация по зарплате, типу, метро; отклик в один тап
- **Матчинг** — взаимный лайк создаёт мэтч и открывает чат
- **Чат** — переписка с работодателем, системные сообщения
- **Уведомления** — колокольчик с историей, пометка прочитанных, удаление
- **Сохранённые вакансии** — избранное для подработок и постоянных вакансий
- **Профиль** — аватар, рейтинг, история откликов
- **Оценки** — рейтинг после завершения смены

### Для работодателей
- **Создание вакансий** — подработка (смена по дате) или постоянная работа
- **Лента откликов** — просмотр кандидатов, лайк / отказ
- **Управление сменами** — статус набора, подтверждение выхода
- **Чат с кандидатами**
- **Аналитика** — статистика откликов, матчей, рейтинг

### Для администраторов (Dashboard)
- Управление пользователями (блокировка, удаление)
- Модерация вакансий и жалоб
- Аналитика платформы (графики, KPI)
- Рассылка push-уведомлений
- Управление тикетами и отзывами

---

## Технологии

| Слой | Технология |
|---|---|
| Мобильное приложение | React Native + Expo SDK 53 |
| Навигация | expo-router v5 (file-based) |
| Язык | TypeScript |
| Состояние | React Context (AppContext) |
| База данных | Supabase (PostgreSQL) |
| API | PHP-прокси (`jobtoo.ru/api/db.php`) — единственный путь к базе |
| Push-уведомления | Expo Push API + Supabase Edge Functions |
| Admin Dashboard | Next.js 14 + Tailwind CSS |
| Сборка | EAS Build (Android APK / AAB, iOS IPA) |
| OTA-обновления | expo-updates (EAS Update) |
| Веб-деплой | GitHub Actions → релиз с `dist.tar.gz` → забирает self-hosted сервер (Москва) |
| Бэкенд | self-hosted Supabase-стек (Postgres/PostgREST/Realtime/Storage) на сервере в Москве, `infra/` |
| CI/CD | GitHub Actions |

---

## Архитектура

```
┌─────────────────────────────────────────────────┐
│           Мобильное приложение (RN/Expo)         │
│  Worker UI          Employer UI         Admin UI │
│   feed, matches,     feed, create-vac,  dashboard│
│   chats, profile     candidates, chats           │
└────────────────────┬────────────────────────────┘
                     │ HTTP POST { fn, args }
                     │
              ┌──────▼──────┐
              │  PHP-прокси  │
              │ jobtoo.ru/  │
              │ api/db.php  │
              └──────┬──────┘
                     │ сервисный ключ, наружу не уходит
           ┌─────────▼──────────┐
           │  Supabase (Postgres)│
           │  jm_users           │
           │  jm_vacancies       │
           │  jm_perm_vacancies  │
           │  jm_likes           │
           │  jm_chats           │
           │  jm_messages        │
           │  jm_notifications   │
           │  jm_ratings         │
           │  jm_saved / perm    │
           │  jm_complaints      │
           └─────────────────────┘
```

**Почему два прокси?**  
Прямой доступ к Supabase из браузера заблокирован в России, поэтому в нативном приложении и на `jobtoo.ru` используется PHP-прокси. Vercel-функция используется как запасной вариант для PWA-режима за рубежом.

**Паттерн вызова БД:**  
Все функции в `services/db.ts` имеют единообразный интерфейс. В нативном режиме (`IS_NATIVE = true`) они вызывают `proxy(fnName, args)`, в веб-режиме — напрямую через Supabase JS SDK.

---

## База данных

| Таблица | Назначение |
|---|---|
| `jm_users` | Профили работников и работодателей |
| `jm_vacancies` | Подработки (смены по дате) |
| `jm_perm_vacancies` | Постоянные вакансии |
| `jm_likes` | Отклики и матчи (worker_liked + employer_liked → is_match) |
| `jm_chats` | Чаты (worker_id + employer_id + vacancy_id) |
| `jm_messages` | Сообщения чатов |
| `jm_saved` | Сохранённые подработки |
| `jm_perm_saved` | Сохранённые постоянные вакансии |
| `jm_perm_applications` | Отклики на постоянные вакансии |
| `jm_notifications` | Внутренние уведомления (is_read, title, body) |
| `jm_ratings` | Оценки после смены (от 1 до 5, avg хранится в jm_users) |
| `jm_complaints` | Жалобы на пользователей |

Миграции — в папке `supabase/migrations/`.

---

## Запуск локально

```bash
# Установить зависимости
npm install

# Запустить Expo Dev Server
npm run start

# Android (через Expo Go или Dev Client)
npm run android

# iOS (только macOS)
npm run ios

# Веб (браузер)
npm run web
```

**Переменные окружения** (`.env.local`):
```
# Бэкенд self-hosted в Москве (РФ). Клиент ходит на свой домен —
# nginx проксирует /rest, /realtime, /storage в контейнеры (infra/docker-compose.yml).
EXPO_PUBLIC_SUPABASE_URL=https://jobtoo.ru
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_API_URL=https://jobtoo.ru
```

**Admin Dashboard:**
```bash
cd dashboard
npm install
npm run dev   # http://localhost:3000
```

---

## Деплой

### Android APK/AAB (EAS Build)
```bash
EXPO_TOKEN=<токен> npx eas-cli build --platform android --profile production
```
Runtime version: политика `appVersion` в `app.json` — берётся автоматически из
поля `version` (сейчас `1.4.0`), отдельно не задаётся

**Перед первой сборкой** заведите на expo.dev (Project → Environment variables)
переменные `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_SECRET` и
`EXPO_PUBLIC_YANDEX_MAPS_KEY`. В `eas.json` их значений больше нет: файл лежит
в открытом репозитории, и ключ из него пережил бы любую смену секретов. Для
обновлений по воздуху это неважно — там значения приходят из GitHub Secrets,
— но собранный без них бинарник останется без живого чата, загрузки файлов и
карты. Список всех переменных с пояснениями — в `.env.example`.

### OTA-обновление (без пересборки)
```bash
EXPO_TOKEN=<токен> npx eas-cli update --branch production --message "описание"
```
Работает только если runtime version не изменился.

### Веб на jobtoo.ru
Домен переехал с хостинга Reg.ru на собственный сервер в Москве (17 августа
2026); FTP-деплоя на Reg.ru больше нет. Автоматически при пуше в `main` —
GitHub Actions (`deploy-regru.yml`):
1. `npx expo export --platform web` → папка `dist/`
2. Сборка упаковывается в `dist.tar.gz` и публикуется GitHub-релизом (`web`)
3. Московский сервер раз в минуту забирает изменения из репозитория и релиз
   со сборкой (`infra/bootstrap.sh` → `docker compose up -d` → `nginx reload`)

PHP-прокси (`php-proxy/*.php`) на сервер тоже не заливается по FTP — сервер
берёт файлы прямо из репозитория при каждом `git pull` (см. `infra/README.md`).

### Admin Dashboard
Дашборд переехал с Vercel на тот же московский сервер (`admin.jobtoo.ru`).
Автоматически при пуше в `main`, если менялась папка `dashboard/` —
GitHub Actions (`build-dashboard.yml`) собирает standalone-сборку Next.js,
публикует её GitHub-релизом (`dashboard`), сервер забирает релиз и
разворачивает через blue-green (`docker compose --profile dashboard`).

---

## Структура проекта

```
JobMatch/
├── app/                      # Экраны (expo-router, file-based routing)
│   ├── (tabs)/               # Основные вкладки (таб-бар)
│   │   ├── _layout.tsx       # Конфигурация таб-бара
│   │   ├── feed.tsx          # Лента (подработки + постоянная работа)
│   │   ├── matches.tsx       # Матчи и кандидаты
│   │   ├── chats.tsx         # Список чатов
│   │   ├── saved.tsx         # Сохранённые вакансии
│   │   └── profile.tsx       # Профиль пользователя
│   ├── _layout.tsx           # Корневой layout (AppContext, Toast)
│   ├── login.tsx             # Авторизация
│   ├── register-worker.tsx   # Регистрация работника
│   ├── register-employer.tsx # Регистрация работодателя
│   ├── chat-room.tsx         # Экран переписки
│   ├── match.tsx             # Экран мэтча (анимация)
│   ├── create-vacancy.tsx    # Создание подработки
│   ├── create-perm-vacancy.tsx # Создание постоянной вакансии
│   ├── candidates.tsx        # Кандидаты на смену
│   ├── perm-applications.tsx # Отклики на постоянную вакансию
│   ├── perm-vacancy-detail.tsx # Детальная страница вакансии
│   ├── user-profile.tsx      # Профиль другого пользователя
│   ├── analytics.tsx         # Аналитика работодателя
│   ├── rate.tsx              # Оценка после смены
│   ├── admin.tsx             # Панель администратора (в приложении)
│   ├── legal.tsx             # Политика и соглашения
│   └── api/db+api.ts         # Expo API route (веб-прокси)
│
├── components/
│   ├── ui/                   # Базовые UI-компоненты
│   │   ├── AppInput.tsx      # Поле ввода
│   │   ├── Chip.tsx          # Тэг/чип
│   │   ├── PrimaryButton.tsx # Основная кнопка
│   │   ├── Toast.tsx         # Уведомление-тост
│   │   ├── ToastLayer.tsx    # Слой для тостов
│   │   ├── ConfirmDialog.tsx # Диалог подтверждения
│   │   └── NotifBell.tsx     # Колокольчик уведомлений
│   └── feature/              # Бизнес-компоненты
│       ├── MetroPicker.tsx   # Выбор станции метро
│       ├── WorkTypeSelector.tsx # Выбор типа работы
│       ├── PhoneInput.tsx    # Ввод телефона
│       └── VacancyDetailModal.tsx # Модалка деталей вакансии
│
├── contexts/
│   └── AppContext.tsx        # Глобальное состояние (пользователь, вакансии, чаты)
│
├── hooks/
│   └── useApp.ts             # Хук для доступа к AppContext
│
├── services/
│   ├── db.ts                 # Все функции работы с БД (→ proxy или Supabase)
│   ├── notifications.ts      # Отправка push-уведомлений
│   └── storage.ts            # Утилиты (форматирование, цвета, инициалы)
│
├── constants/
│   ├── types.ts              # TypeScript типы (User, Vacancy, Like, PermVacancy…)
│   ├── theme.ts              # Цвета, отступы, тени (Colors, Radius, Shadow)
│   └── metro.ts              # Список линий и станций московского метро
│
├── lib/
│   ├── supabase.ts           # Supabase клиент (для web-режима)
│
├── api/
│   └── db.ts                 # Vercel serverless handler
│
├── template/                 # Переиспользуемый core (Supabase клиент, AlertProvider)
│
├── php-proxy/
│   └── db.php                # PHP-прокси для российских пользователей
│
├── dashboard/                # Admin Dashboard (Next.js 14 + Tailwind)
│   ├── app/                  # Страницы (users, vacancies, chats, analytics…)
│   ├── components/           # Shell, Sidebar, Charts, KPI-карточки
│   └── lib/                  # Запросы к Supabase, auth, экспорт CSV
│
├── supabase/
│   ├── migrations/           # SQL-миграции
│   └── functions/            # Edge Functions (push-notify)
│
├── assets/                   # Шрифты, иконки, изображения персонажей
├── public/                   # PWA-манифест, favicon, deep-link файлы
│
├── .github/workflows/
│   ├── deploy-regru.yml      # Сборка веба и доставка на self-hosted сервер (Москва) при пуше в main
│   ├── build-dashboard.yml   # Сборка Admin Dashboard и доставка на тот же сервер (при изменениях в dashboard/)
│   ├── eas-update.yml        # Авто OTA-обновление при пуше в main
│   └── keep-alive.yml        # Ping для поддержания активности сервиса
│
├── app.json                  # Конфиг Expo (bundleId, version, plugins)
├── eas.json                  # Профили EAS Build
└── package.json
```

---

## Лицензия

Проект закрытый. Все права защищены.  
По вопросам сотрудничества: support@jobtoo.ru
