from pathlib import Path

QUERIES = Path('dashboard/lib/queries.ts')
PAGE = Path('dashboard/app/funnel/page.tsx')
PLAN = Path('docs/план-разработки.md')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


q = QUERIES.read_text()
q = replace_once(
    q,
    "import { buildWorkerShiftCohort } from './workerCohort'",
    "import { buildWorkerActivationCohort, buildWorkerShiftCohort } from './workerCohort'",
    'activation import',
)

q = replace_once(
    q,
    """  const [
    { data: users },
    { data: likes },
    { data: permApps },
    { data: guestEvents },
    cohortUsers,
    cohortLikes,
  ] = await Promise.all([
    supabase.from('jm_users').select('id,role,created_at'),
    supabase.from('jm_likes').select('id,worker_id,is_match,worker_liked,worker_confirmed,employer_confirmed,shift_completed,created_at'),
    supabase.from('jm_perm_applications').select('id,worker_id,status,created_at'),
    supabase.from('jm_guest_events').select('anon_id,event_type,vacancy_kind,campaign_id,channel,occurred_at'),
    selectAllBetween('jm_users', 'id,role,created_at', 'created_at', cohortFrom, cohortTo),
    selectAllBetween(
      'jm_likes',
      'worker_id,worker_liked,is_match,worker_confirmed,employer_confirmed,shift_completed,outcome,created_at',
      'created_at',
      cohortFrom,
      funnelNow.toISOString(),
    ),
  ])""",
    """  const [
    { data: users },
    { data: likes },
    { data: permApps },
    { data: guestEvents },
    cohortUsers,
    cohortLikes,
    cohortPermApps,
    cohortShiftViews,
    cohortPermViews,
  ] = await Promise.all([
    supabase.from('jm_users').select('id,role,created_at'),
    supabase.from('jm_likes').select('id,worker_id,is_match,worker_liked,worker_confirmed,employer_confirmed,shift_completed,created_at'),
    supabase.from('jm_perm_applications').select('id,worker_id,status,created_at'),
    supabase.from('jm_guest_events').select('anon_id,event_type,vacancy_kind,campaign_id,channel,occurred_at'),
    selectAllBetween(
      'jm_users',
      'id,role,created_at,first_name,last_name,metro_station,work_types',
      'created_at',
      cohortFrom,
      cohortTo,
    ),
    selectAllBetween(
      'jm_likes',
      'worker_id,worker_liked,is_match,worker_confirmed,employer_confirmed,shift_completed,outcome,created_at',
      'created_at',
      cohortFrom,
      funnelNow.toISOString(),
    ),
    selectAllBetween(
      'jm_perm_applications',
      'worker_id,status,created_at',
      'created_at',
      cohortFrom,
      funnelNow.toISOString(),
    ),
    selectAllBetween(
      'jm_vacancy_views',
      'worker_id,viewed_at',
      'viewed_at',
      cohortFrom,
      funnelNow.toISOString(),
    ),
    selectAllBetween(
      'jm_perm_vacancy_views',
      'worker_id,viewed_at',
      'viewed_at',
      cohortFrom,
      funnelNow.toISOString(),
    ),
  ])""",
    'funnel cohort queries',
)

q = replace_once(
    q,
    """  const cohortColors = [PALETTE.blue, PALETTE.cyan, PALETTE.purple, PALETTE.orange, PALETTE.green]
  const workerCohort = buildWorkerShiftCohort(cohortUsers, cohortLikes, funnelNow)
  const mainFunnel = workerCohort.steps
    .map((step, index) => ({ ...step, fill: cohortColors[index] }))
  const [cohortWorkers, cohortApplied, cohortMatched, cohortConfirmed, cohortWorked] =
    workerCohort.steps.map(step => step.value)""",
    """  const cohortColors = [
    PALETTE.blue, PALETTE.cyan, PALETTE.purple,
    PALETTE.orange, PALETTE.amber, PALETTE.green,
  ]
  const workerActivation = buildWorkerActivationCohort(
    cohortUsers,
    cohortLikes,
    cohortPermApps,
    cohortShiftViews,
    cohortPermViews,
    funnelNow,
  )
  const mainFunnel = workerActivation.steps
    .map((step, index) => ({ ...step, fill: cohortColors[index] }))
  const [
    cohortWorkers,
    cohortProfileReady,
    cohortViewed,
    cohortApplied,
    cohortAccepted,
    cohortWorked,
  ] = workerActivation.steps.map(step => step.value)""",
    'full activation builder',
)

q = replace_once(
    q,
    """      cohortWorkers,
      cohortApplied,
      cohortMatched,
      cohortConfirmed,
      cohortWorked,
      cohortApplyRate: pct(cohortApplied, cohortWorkers),
      cohortMatchRate: pct(cohortMatched, cohortApplied),
      cohortConfirmRate: pct(cohortConfirmed, cohortMatched),
      cohortWorkRate: pct(cohortWorked, cohortWorkers),
      cohortBiggestDrop: workerCohort.biggestDrop,""",
    """      cohortWorkers,
      cohortProfileReady,
      cohortViewed,
      cohortApplied,
      cohortAccepted,
      cohortWorked,
      cohortProfileRate: pct(cohortProfileReady, cohortWorkers),
      cohortViewRate: pct(cohortViewed, cohortProfileReady),
      cohortApplyRate: pct(cohortApplied, cohortProfileReady),
      cohortAcceptRate: pct(cohortAccepted, cohortApplied),
      cohortWorkRate: pct(cohortWorked, cohortWorkers),
      cohortAppliedWithin7d: workerActivation.appliedWithin7d,
      cohortAppliedWithin7dRate: pct(workerActivation.appliedWithin7d, cohortProfileReady),
      cohortProfileAnomalies: workerActivation.legacyProfileAnomalies,
      cohortBiggestDrop: workerActivation.biggestDrop,""",
    'activation kpis',
)
QUERIES.write_text(q)

p = PAGE.read_text()
p = replace_once(
    p,
    """        <div className=\"g-4\">
          <KpiCard label=\"Работники в когорте\" value={d.kpi.cohortWorkers}
            sub=\"30 дней · последние 7 дней исключены\" sparkColor={PALETTE.blue} />
          <KpiCard label=\"Откликнулись на смену\" value={d.kpi.cohortApplied}
            sub={`${d.kpi.cohortApplyRate} от когорты`} sparkColor={PALETTE.cyan} />
          <KpiCard label=\"Получили совпадение\" value={d.kpi.cohortMatched}
            sub={`${d.kpi.cohortMatchRate} от откликнувшихся`} sparkColor={PALETTE.purple} />
          <KpiCard label=\"Вышли на смену\" value={d.kpi.cohortWorked}
            sub={`${d.kpi.cohortWorkRate} от когорты`} sparkColor={PALETTE.green} />
        </div>""",
    """        <div className=\"g-4\">
          <KpiCard label=\"Работники в когорте\" value={d.kpi.cohortWorkers}
            sub=\"30 дней · последние 7 дней исключены\" sparkColor={PALETTE.blue} />
          <KpiCard label=\"Профиль готов\" value={d.kpi.cohortProfileReady}
            sub={`${d.kpi.cohortProfileRate} от когорты`} sparkColor={PALETTE.cyan} />
          <KpiCard label=\"Посмотрели вакансию\" value={d.kpi.cohortViewed}
            sub={`${d.kpi.cohortViewRate} от готовых профилей`} sparkColor={PALETTE.purple} />
          <KpiCard label=\"Откликнулись\" value={d.kpi.cohortApplied}
            sub={`${d.kpi.cohortApplyRate} от готовых профилей`} sparkColor={PALETTE.orange} />
        </div>
        <div className=\"g-4\">
          <KpiCard label=\"Получили одобрение\" value={d.kpi.cohortAccepted}
            sub={`${d.kpi.cohortAcceptRate} от откликнувшихся`} sparkColor={PALETTE.amber} />
          <KpiCard label=\"Вышли на смену\" value={d.kpi.cohortWorked}
            sub={`${d.kpi.cohortWorkRate} от когорты`} sparkColor={PALETTE.green} />
          <KpiCard label=\"Отклик за 7 дней\" value={d.kpi.cohortAppliedWithin7d}
            sub={`${d.kpi.cohortAppliedWithin7dRate} от готовых профилей`} sparkColor={PALETTE.blue} />
          <KpiCard label=\"Старые неполные профили\" value={d.kpi.cohortProfileAnomalies}
            sub=\"есть активность, но не хватает обязательных полей\" sparkColor={PALETTE.gray} />
        </div>""",
    'activation cards',
)
p = replace_once(
    p,
    '<ChartCard title="Когорта выхода на смену" sub="Регистрации за 30 дней · последние 7 дней дозревают">',
    '<ChartCard title="Полная активация одной когорты" sub="Профиль → просмотр → отклик → одобрение → выход · последние 7 дней дозревают">',
    'activation chart title',
)
PAGE.write_text(p)

plan = PLAN.read_text()
plan = replace_once(
    plan,
    '1. Полная активационная воронка работника от профиля до завершённой смены.\n2. ~~Безопасный аудит npm-зависимостей~~',
    '1. ~~Полная активационная воронка работника от профиля до завершённой смены~~ — **сделано 15.09**. Одна дозревшая когорта проходит через профиль → просмотр → отклик → одобрение → выход; постоянные вакансии учитываются вместе со сменами, отдельно видны отклики за первые 7 дней и старые неполные профили.\n2. ~~Безопасный аудит npm-зависимостей~~',
    'development plan item',
)
PLAN.write_text(plan)
