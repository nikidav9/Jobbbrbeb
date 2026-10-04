# Дрейф токенов бренда: сводка (03.10.2026)

Только справка. Код цветов не менялся: смена оттенка видна пользователю и
остаётся решением владельца.

## Таблица: набор, токен, hex, где определён, где используется

Счётчик «использований» — число обращений `Набор.токен` в `app`, `components`,
`constants`, `lib`, `hooks`, `contexts`, `template` (без литералов hex).

| Набор | Токен | Hex | Где определён | Использований |
|---|---|---|---|---|
| `JT` | `accent` | `#FF6B1A` | `constants/jt.ts:7` | 77 |
| `JT` | `ink` | `#141414` | `constants/jt.ts:8` | 360 |
| `JT` | `background` | `#F5EFE6` | `constants/jt.ts:9` | 56 |
| `Colors` | `primary` | `#FF6B1A` | `constants/theme.ts:2` | 202 |
| `EditColors` | `accent` | `#FF6B1A` | `constants/profileEditTheme.ts:13` | 17 |
| `EditColors` | `ink` | `#141414` | `constants/profileEditTheme.ts:14` | 101 |
| `EditColors` | `bg` | `#F5EFE6` | `constants/profileEditTheme.ts:15` | 11 |
| `ProfileColors` | `accent` | `#FF6A1F` | `constants/profileTheme.ts:15` | 20 |
| `ProfileColors` | `ink` | `#151413` | `constants/profileTheme.ts:14` | 121 |
| `ProfileColors` | `bg` | `#F4EEE5` | `constants/profileTheme.ts:12` | 5 |
| `ProfileColors` | `subtleBg` | `#F4EEE5` | `constants/profileTheme.ts:23` | 3 |

Файлов `constants/theme*.ts` кроме `theme.ts` и `components/profile/profileTheme*.ts`
нет: тема профиля лежит в `constants/profileTheme.ts`.

### Литералы hex мимо наборов

| Hex | Где | Заметка |
|---|---|---|
| `#FF6B1A` | `components/SplashLoader.tsx:160` (`ACCENT`), `app/index.tsx:29` (локальный набор), `components/ui/Chip.tsx:20,24`, `app/+html.tsx` (CSS заставки), `constants/landing.ts:75` (CSS-переменная), `services/storage.ts:119`, `app/analytics.tsx:34` (палитры аватаров и графиков) | совпадает с `JT.accent` |
| `#141414` | `components/SplashLoader.tsx:159` (`INK`), `app/index.tsx:30`, `app/+html.tsx`, `constants/landing.ts:75,449,578`, `lib/mailHtml.ts:15` | совпадает с `JT.ink` |
| `#F5EFE6` | `components/EntryTransition.tsx:82`, `components/SplashLoader.tsx:269`, `app/index.tsx:31`, `app/+html.tsx:30,98,265`, `constants/landing.ts:75` | совпадает с `JT.background` |

`app/index.tsx:29-31` держит собственные `accent/ink/background` с теми же
значениями, что `JT` (локальная копия набора).

## Расхождения

Два семейства значений одного бренда:

| Роль | Семейство A (JT-design, 27.09) | Семейство B (дизайн профиля) | Разница |
|---|---|---|---|
| Акцент | `#FF6B1A` | `#FF6A1F` | G: 6B против 6A, B: 1A против 1F (R одинаков); на глаз неразличимо |
| Чернила | `#141414` | `#151413` | R/G/B отличаются на 1 единицу; визуально идентичны |
| Фон | `#F5EFE6` | `#F4EEE5` | на 1 единицу по каждому каналу |

Семейство A: `JT`, `EditColors`, `Colors.primary` (только акцент), заставка,
лендинг, письма. Семейство B: только `ProfileColors` (вкладка «Профиль»,
`docs/design/profile/README.md`, решение владельца 27.09). Документ
`docs/design/profile-edit/README.md` (экраны редактирования) использует A, так
что внутри профиля уже два оттенка: вкладка (B) и редактирование (A).

Сторонние расхождения: `Colors.textPrimary` `#111111` против чернил `#141414`
(`Colors` — старый набор, не бренд-чернила; на старых экранах), `ProfileColors.subtleBg`
дублирует `bg` (`#F4EEE5`).

## Предложение единых значений

Взять семейство A как единое (по таблице выше на него приходится подавляющее
большинство обращений, его же задают README дизайна, кроме `profile`):

- акцент `#FF6B1A`
- чернила `#141414`
- фон `#F5EFE6`

Шаги, если владелец согласится (каждый — видимое, пусть и почти неразличимое,
изменение):

1. В `constants/profileTheme.ts` заменить `#FF6A1F`, `#151413`, `#F4EEE5` на
   значения A, а в `docs/design/profile/README.md` поправить таблицу токенов.
2. `constants/profileEditTheme.ts` и `app/index.tsx` собрать из `JT`
   (`accent: JT.accent` и т. д.) вместо копий.
3. `SplashLoader.tsx`, `EntryTransition.tsx`, `Chip.tsx` перевести литералы на `JT`.
   CSS в `app/+html.tsx` и `constants/landing.ts` остаётся строкой, но сверять
   с `JT` тестом.
4. `Colors.primary` сделать ссылкой на `JT.accent` (одно значение, два имени).

Отдельное решение: оставлять ли профиль на B. Тогда в README профиля надо
записать, что расхождение намеренное.
