export type WorkerCohortUser = {
  id?: string | null
  role?: string | null
  created_at?: string | null
}

export type WorkerCohortLike = {
  worker_id?: string | null
  worker_liked?: boolean | null
  is_match?: boolean | null
  worker_confirmed?: boolean | null
  employer_confirmed?: boolean | null
  shift_completed?: boolean | null
  outcome?: string | null
}

const DAY = 86_400_000

export function buildWorkerShiftCohort(
  users: WorkerCohortUser[],
  likes: WorkerCohortLike[],
  now = new Date(),
) {
  const from = new Date(now.getTime() - 37 * DAY)
  const to = new Date(now.getTime() - 7 * DAY)
  const workers = new Set(
    users
      .filter(user => {
        const created = user.created_at ? new Date(user.created_at) : null
        return user.role === 'worker'
          && !!user.id
          && !!created
          && !Number.isNaN(created.getTime())
          && created >= from
          && created < to
      })
      .map(user => user.id as string),
  )

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

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    steps: [
      { name: 'Новые работники', value: workers.size },
      { name: 'Откликнулись на смену', value: applied.size },
      { name: 'Получили совпадение', value: matched.size },
      { name: 'Подтвердили', value: confirmed.size },
      { name: 'Вышли на смену', value: worked.size },
    ],
  }
}
