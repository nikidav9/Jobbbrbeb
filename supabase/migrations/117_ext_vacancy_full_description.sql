-- Полное описание вакансии со страницы, отдельно от короткого анонса.
--
-- ingest.php перезаписывает jm_ext_vacancies целиком на каждом заходе (раз в
-- шесть часов): описание там — короткая карточка из списка вакансий (у
-- четверти строк её вообще нет). Полный разбор страницы со структурой
-- (php-proxy/vacancy_text.php, vt_extract) — отдельный, более медленный шаг:
-- ходить за ним на каждую вакансию во время самого ingest значило бы не
-- уложиться в бюджет обхода. Поэтому колонка своя, и ingest её не трогает —
-- upsert посылает только те поля, что сам строит (php-proxy/describe.php
-- заполняет description_full отдельным проходом).
--
-- Явные begin/commit — стиль 110–113: infra/migrate.sh гоняет psql БЕЗ
-- --single-transaction, каждый оператор фиксируется сам по себе. Без обёртки
-- падение посередине оставило бы базу наполовину применённой.
begin;

alter table public.jm_ext_vacancies add column if not exists description_full text;
-- Когда в последний раз пытались дочитать полное описание — успешно или нет.
-- Ставим её и при неудаче (страница не открылась, текста мало), иначе
-- describe.php долбил бы одну и ту же неудачную страницу на каждом заходе.
alter table public.jm_ext_vacancies add column if not exists described_at timestamptz;

-- Очередь дозагрузки: активные вакансии, которым ещё не выбирали описание,
-- в первую очередь свежие. Дозревшие (described_at старше 30 дней) в этот
-- частичный индекс не попадают — их выбор описан в describe.php.
create index if not exists jm_ext_vac_undescribed_idx
  on public.jm_ext_vacancies (first_seen_at desc)
  where active and described_at is null;

commit;
