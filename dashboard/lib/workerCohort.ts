export type WorkerCohortUser = {
  id?: string | null
  role?: string | null
  created_at?: string | null
  first_name?: string | null
  last_name?: string | null
  metro_station?: string | null
  work_types?: unknown
}

export type WorkerCohortLike = {
  worker_id?: string | null
  worker_liked?: boolean | null
  is_match?: boolean | null
  worker_confirmed?: boolean | null
  employer_confirmed?: boolean | null
  shift_completed?: boolean | null
  outcome?: string | null
  created_at?: string | null
}

export type WorkerCohortPermApplication = {
  worker_id?: string | null
  status?: string | null
  created_at?: string | null
}

export type WorkerCohortView = {
  worker_id?: string | null
  viewed_at?: string | null
}

const DAY = 86_400_000

function matureWorkerEntries(users: WorkerCohortUser[], now: Date) {
  const from = new Date(now.getTime() - 37 * DAY)
  const to = new Date(now.getTime() - 7 * DAY)
  const workers = users.filter(user => {
    const created = user.created_at ? new Date(user.created_at) : null
    return user.role === 'worker'
      && !!user.id
      && !!created
      && !Number.isNaN(created.getTime())
      && created >= from
      && created < to
  })
  return { from, to, workers }
}

function biggestDrop(steps: { name: string; value: number }[]) {
  return steps.slice(1).map((step, index) => {
    const previous = steps[index]
    const lost = Math.max(0, previous.value - step.value)
    return {
      from: previous.name,
      to: step.name,
      lost,
      rate: previous.value > 0 ? Math.round(lost * 100 / previous.value) : 0,
    }
  }).sort((a, b) => b.rate - a.rate || b.lost - a.lost)[0] ?? null
}

function coreProfileReady(user: WorkerCohortUser): boolean {
  const workTypes = Array.isArray(user.work_types) ? user.work_types : []
  return Boolean(
    String(user.first_name ?? '').trim()
    && String(user.last_name ?? '').trim()
    && String(user.metro_station ?? '').trim()
    && workTypes.length > 0
  )
}

/**
 * Полная продуктовая воронка одной дозревшей когорты работников.
 *
 * Все шаги считают одних и тех же людей: регистрации за 30 дней, которым уже
 * исполнилось минимум семь дней. Поэтому свежие регистрации не занижают
 * поздние шаги, а знаменатель не меняется от карточки к карточке.
 *
 * Историческая телеметрия просмотров неполная, поэтому поздний факт имеет
 * право доказывать ранний: отклик означает, что вакансию видели; одобрение
 * означает, что был отклик; завершённая смена означает одобрение/отклик/просмотр.
 * Профиль таким способом не восстанавливаем: если у старой строки не хватает
 * обязательных полей, это отдельная аномалия данных, а не «готовый профиль».
 */
export function buildWorkerActivationCohort(
  users: WorkerCohortUser[],
  likes: WorkerCohortLike[],
  permApplications: WorkerCohortPermApplication[],
  shiftViews: WorkerCohortView[],
  permViews: WorkerCohortView[],
  now = new Date(),
) {
  const { from, to, workers } = matureWorkerEntries(users, now)
  const workerIds = new Set(workers.map(user => user.id as string))
  const profileReady = new Set(
    workers.filter(coreProfileReady).map(user => user.id as string),
  )
  const registeredAt = new Map(
    workers.map(user => [user.id as string, new Date(user.created_at as string).getTime()]),
  )

  const explicitViewed = new Set<string>()
  const appliedRaw = new Set<string>()
  const acceptedRaw = new Set<string>()
  const workedRaw = new Set<string>()
  const firstApplicationAt = new Map<string, number>()

  for (const view of [...shiftViews, ...permViews]) {
    const workerId = view.worker_id
    if (workerId && workerIds.has(workerId)) explicitViewed.add(workerId)
  }

  const rememberApplication = (workerId: string, rawDate?: string | null) => {
    if (!rawDate) return
    const at = new Date(rawDate).getTime()
    if (Number.isNaN(at)) return
    const previous = firstApplicationAt.get(workerId)
    if (previous === undefined || at < previous) firstApplicationAt.set(workerId, at)
  }

  for (const like of likes) {
    const workerId = like.worker_id
    if (!workerId || !workerIds.has(workerId)) continue

    const didWork = like.outcome === 'worked' || like.shift_completed === true
    const didConfirm = didWork || (like.worker_confirmed === true && like.employer_confirmed === true)
    const didAccept = didConfirm || like.is_match === true
    const didApply = didAccept || like.worker_liked === true

    if (didApply) {
      appliedRaw.add(workerId)
      rememberApplication(workerId, like.created_at)
    }
    if (didAccept) acceptedRaw.add(workerId)
    if (didWork) workedRaw.add(workerId)
  }

  for (const application of permApplications) {
    const workerId = application.worker_id
    if (!workerId || !workerIds.has(workerId)) continue
    appliedRaw.add(workerId)
    rememberApplication(workerId, application.created_at)
    if (application.status === 'approved' || application.status === 'hired') {
      acceptedRaw.add(workerId)
    }
  }

  // Поздние факты восстанавливают ранние события, но только для работников с
  // валидным профилем. Так старая неполная запись не раздувает строгую воронку.
  const viewed = new Set<string>()
  const applied = new Set<string>()
  const accepted = new Set<string>()
  const worked = new Set<string>()
  for (const workerId of profileReady) {
    const didWork = workedRaw.has(workerId)
    const didAccept = didWork || acceptedRaw.has(workerId)
    const didApply = didAccept || appliedRaw.has(workerId)
    const didView = didApply || explicitViewed.has(workerId)
    if (didView) viewed.add(workerId)
    if (didApply) applied.add(workerId)
    if (didAccept) accepted.add(workerId)
    if (didWork) worked.add(workerId)
  }

  const downstreamRaw = new Set([
    ...explicitViewed,
    ...appliedRaw,
    ...acceptedRaw,
    ...workedRaw,
  ])
  const legacyProfileAnomalies = [...downstreamRaw]
    .filter(workerId => workerIds.has(workerId) && !profileReady.has(workerId)).length

  let appliedWithin7d = 0
  for (const workerId of profileReady) {
    const registered = registeredAt.get(workerId)
    const firstApplication = firstApplicationAt.get(workerId)
    if (registered === undefined || firstApplication === undefined) continue
    const elapsed = firstApplication - registered
    if (elapsed >= 0 && elapsed <= 7 * DAY) appliedWithin7d++
  }

  const steps = [
    { name: 'Зарегистрировались', value: workerIds.size },
    { name: 'Профиль готов', value: profileReady.size },
    { name: 'Посмотрели вакансию', value: viewed.size },
    { name: 'Откликнулись', value: applied.size },
    { name: 'Получили одобрение', value: accepted.size },
    { name: 'Вышли на смену', value: worked.size },
  ]

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    steps,
    biggestDrop: biggestDrop(steps),
    appliedWithin7d,
    legacyProfileAnomalies,
  }
}

export function buildWorkerShiftCohort(
  users: WorkerCohortUser[],
  likes: WorkerCohortLike[],
  now = new Date(),
) {
  const { from, to, workers: matureWorkers } = matureWorkerEntries(users, now)
  const workers = new Set(matureWorkers.map(user => user.id as string))

  const applied = new Set<string>()
  const matched = new Set<string>()
  const confirmed = new Set<string>()
  const worked = new Set<string>()

  for (const like of likes) {
    const workerId = like.worker_id
    if (!workerId || !workers.has(workerId)) continue

    const didWork = like.outcome === 'worked' || like.shift_completed === true
    const didConfirm = didWork || (like.worker_confirmed === true && like.employer_confirmed === true)
    const didMatch = didConfirm || like.is_match === true
    const didApply = didMatch || like.worker_liked === true

    if (didApply) applied.add(workerId)
    if (didMatch) matched.add(workerId)
    if (didConfirm) confirmed.add(workerId)
    if (didWork) worked.add(workerId)
  }

  const steps = [
    { name: 'Новые работники', value: workers.size },
    { name: 'Откликнулись на смену', value: applied.size },
    { name: 'Получили совпадение', value: matched.size },
    { name: 'Подтвердили', value: confirmed.size },
    { name: 'Вышли на смену', value: worked.size },
  ]

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    steps,
    biggestDrop: biggestDrop(steps),
  }
}
