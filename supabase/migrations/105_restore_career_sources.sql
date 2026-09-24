-- Карьерные страницы работодателей возвращаются как источник вакансий.
--
-- Миграция 096 снесла всю ветку внешних источников целиком: и партнёрский
-- шлюз с биллингом, и hh/SuperJob/Arbihunter, и карьерные сайты. Решение
-- владельца изменилось только в одной части: карьерные страницы нужны снова,
-- потому что на них подаёт заявки Jupiter (`jupiter/`, таблица
-- `jm_jupiter_applications`, миграция 104). Остальное остаётся снесённым и
-- здесь НЕ воскрешается: ни jm_partner_*, ни jm_superjob_*, ни счётчики
-- переходов jm_ext_clicks/jm_ext_events. Переходов больше нет — в этом весь
-- смысл Jupiter: человек не уходит на чужой сайт, заявку подают за него.
--
-- Поэтому таблицы создаются не в том виде, в каком их застала 096, а в
-- карьерном подмножестве. Чего сознательно нет из прежних колонок:
--   * integration_mode, webhook_secret — двусторонний партнёрский коннектор;
--   * environment/notifications_enabled и вся песочница (миграция 046) —
--     песочница заводилась ради партнёрских тестов, партнёров нет;
--   * политика RLS, открывавшая чтение anon/authenticated (тоже 046).
-- Последнее — не мелочь. С тех пор проект пришёл к одному правилу: RLS
-- включён, политик нет, ходят только сервисным ключом через php-proxy/db.php.
-- Вернуть публичную политику значило бы завести единственную таблицу,
-- живущую по старым правилам, — и сторож infra/verify-rls.sh об этом молчал
-- бы, потому что RLS формально включён.
--
-- Явные begin/commit: infra/migrate.sh гоняет psql БЕЗ --single-transaction,
-- каждый оператор фиксируется сам по себе. Без обёртки падение посередине
-- оставило бы базу наполовину восстановленной.
begin;

-- Откуда тянем. Строкой на источник, чтобы включение нового не требовало
-- выкладки. Сам перечень карьерных сайтов здесь НЕ лежит: его держит
-- scripts/career-sites.tsv и заливает infra/sync-career-catalog.sh. Так
-- разведка и боевой коннектор читают один и тот же список и не расходятся —
-- это решение миграции 088, и оно себя оправдало.
create table if not exists jm_ext_sources (
    id            text primary key,
    name          text not null,
    -- Адрес фида. Для карьерных источников это наша же точка входа
    -- /api/career.php?source=…: она превращает чужую страницу в общий формат,
    -- а ingest.php не знает, откуда пришли вакансии, и знать не должен.
    url           text not null,
    auth_header   text,
    auth_value    text,
    -- Заводим выключенным осознанно: сначала владелец смотрит глазами, что
    -- отдают страницы, и только потом включает. career.php это проверяет.
    enabled       boolean not null default false,
    period_min    integer not null default 360,
    -- 'career' — единственный вид, который остался. Колонка сохранена, потому
    -- что её читает career.php: источник не своего вида он обслуживать
    -- отказывается, и это защита от того, чтобы открытая точка входа пошла
    -- по адресам чужого коннектора.
    connector_kind text not null default 'career',
    -- Адреса разделов и карты полей, найденные разведкой. Формат разбирает
    -- career.php: pages[] — страницы с разметкой JobPosting, endpoints[] —
    -- JSON API, страницы со ссылками и встроенное состояние.
    connector_config jsonb not null default '{}'::jsonb,
    last_run_at   timestamptz,
    last_status   text,
    last_count    integer,
    -- Операционное здоровье источника: отличает случайную ошибку от сломанной
    -- интеграции. Читает дашборд.
    last_success_at      timestamptz,
    consecutive_failures integer not null default 0,
    last_duration_ms     integer,
    last_pages           integer,
    last_skipped         integer,
    last_deactivated     integer,
    created_at    timestamptz not null default now()
);

do $$ begin
  alter table jm_ext_sources add constraint jm_ext_sources_kind_chk
    check (connector_kind = 'career');
exception when duplicate_object then null; end $$;

-- Чужие вакансии отдельной таблицей, а не колонкой «источник» в jm_vacancies.
-- Довод тот же, что был в миграции 031, и он не устарел: наши вакансии живые —
-- на них откликаются, по ним идёт переписка. Смешать их значит в каждом
-- запросе помнить, что половина строк «не совсем настоящие», и один забытый
-- фильтр приводит к отклику на объявление, которого у нас нет. Второе:
-- обновление фида переписывает чужие строки целиком, и ошибка в разборе
-- задевала бы вакансии наших работодателей.
create table if not exists jm_ext_vacancies (
    id            text primary key,
    source_id     text not null,
    -- Идентификатор у источника: по нему узнаём ту же вакансию при следующем
    -- заходе. Без него каждый заход плодил бы дубли самой себя.
    external_id   text not null,
    title         text not null,
    company       text,
    metro_station text,
    -- Станция из нашего справочника, либо null, если разобрать не вышло.
    -- Исходное написание остаётся рядом: разбор ошибётся — по нему видно, что
    -- именно прислал источник, а не только то, во что мы это превратили.
    metro_station_norm text,
    metro_line_id      text,
    work_type     text,
    address       text,
    lat           double precision,
    lng           double precision,
    -- Карьерные страницы дают только постоянную работу. Подработка закрыта
    -- 17.09.2026, новых смен не создать, и чужих в том числе.
    kind          text not null default 'permanent',
    date          text,
    time_start    text,
    time_end      text,
    salary        numeric,
    pay_period    text default 'month',
    schedule      text,
    description   text,
    -- Адрес самой вакансии у работодателя. Теперь это не «куда увести
    -- человека», а «куда пойдёт Jupiter»: отсюда берётся canonical_url заявки.
    url           text not null,
    dedupe_key    text,
    active        boolean not null default true,
    first_seen_at timestamptz not null default now(),
    last_seen_at  timestamptz not null default now(),
    unique (source_id, external_id)
);

create index if not exists jm_ext_vac_active_idx on jm_ext_vacancies (active, last_seen_at desc);
create index if not exists jm_ext_vac_metro_idx  on jm_ext_vacancies (metro_station) where active;
create index if not exists jm_ext_vac_metro_norm_idx on jm_ext_vacancies (metro_station_norm) where active;
create index if not exists jm_ext_vac_worktype_idx on jm_ext_vacancies (work_type) where active;
create index if not exists jm_ext_vac_dedupe_idx on jm_ext_vacancies (dedupe_key) where active;

-- Журнал заходов. Нужен, чтобы отличить «источник молчит» от «источник
-- сломался»: у первого заходы успешные и пустые, у второго их нет вовсе.
create table if not exists jm_ext_ingest_runs (
    id          text primary key,
    source_id   text not null,
    success     boolean not null,
    received    integer not null default 0,
    status      text not null,
    ran_at      timestamptz not null default now(),
    duration_ms integer,
    pages       integer,
    skipped     integer,
    deactivated integer
);

create index if not exists jm_ext_ingest_runs_source_time_idx
  on jm_ext_ingest_runs (source_id, ran_at desc);
create index if not exists jm_ext_ingest_runs_success_time_idx
  on jm_ext_ingest_runs (success, ran_at desc);

-- Доступ: как у всего остального в проекте. RLS включён, политик нет,
-- прямые гранты отозваны — значит через PostgREST не пройти ни анониму, ни
-- вошедшему, и остаётся единственная дверь: сервисный ключ в php-proxy/db.php.
-- В jm_ext_sources лежат заголовки доступа к чужим API, и отдавать их в
-- браузер нельзя тем более.
alter table jm_ext_sources enable row level security;
alter table jm_ext_vacancies enable row level security;
alter table jm_ext_ingest_runs enable row level security;

revoke all on jm_ext_sources     from anon;
revoke all on jm_ext_sources     from authenticated;
revoke all on jm_ext_vacancies   from anon;
revoke all on jm_ext_vacancies   from authenticated;
revoke all on jm_ext_ingest_runs from anon;
revoke all on jm_ext_ingest_runs from authenticated;

grant all on jm_ext_sources     to service_role;
grant all on jm_ext_vacancies   to service_role;
grant all on jm_ext_ingest_runs to service_role;

-- Единственная строка источника. Каталог в неё зальёт sync-career-catalog.sh;
-- до этого она выключена и пуста, то есть обход её не тронет.
insert into jm_ext_sources (id, name, url, enabled, period_min, connector_kind)
values (
    'career_owner',
    'Карьерные сайты — полный каталог',
    'https://jobtoo.ru/api/career.php?source=career_owner',
    false,
    360,
    'career'
)
on conflict (id) do nothing;

-- Три чужие таблицы, попавшие сюда не случайно.
--
-- Сторож infra/verify-rls.sh выводил список охраняемых таблиц регуляркой,
-- которая не понимала записи `alter table public.jm_… enable row level
-- security`, — а именно так их пишут миграции 033, 064 и 100. В итоге
-- jm_guest_events, jm_referral_rewards и jm_resume_files не проверялись
-- вообще, а у jm_referral_rewards прямые гранты не снимались ни разу: таблица
-- заведена миграцией 064, то есть уже после общего запрета в 013, и под него
-- не попала. RLS их закрывает, утечки нет — но второй эшелон отсутствовал.
--
-- Правка сторожа без этих строк сломала бы выкладку: он требовал бы состояния,
-- которого в базе нет. Поэтому список и запрет едут одним срезом.
revoke all on public.jm_guest_events     from anon;
revoke all on public.jm_guest_events     from authenticated;
revoke all on public.jm_referral_rewards from anon;
revoke all on public.jm_referral_rewards from authenticated;
revoke all on public.jm_resume_files     from anon;
revoke all on public.jm_resume_files     from authenticated;

commit;

notify pgrst, 'reload schema';
