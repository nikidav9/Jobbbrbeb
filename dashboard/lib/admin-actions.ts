import { supabaseAdmin } from './supabase'
import { logActivity } from './activity-log'
import { getToken } from './adminApi'

// ─── Users ────────────────────────────────────────────────────────────────────

/**
 * Смена роли: человек зарегистрировался не тем, кем собирался.
 *
 * Роль у нас не просто подпись — от неё зависит, что человек видит и что
 * может. Поэтому мало переписать поле: у бывшего работодателя остаются
 * вакансии, и если их не закрыть, соискатели продолжат откликаться на
 * объявления человека, который больше не работодатель.
 *
 * Чего намеренно НЕ трогаем — переписки и отклики. Это история: там живые
 * сообщения и договорённости, и стирать их из-за смены роли нельзя. Они
 * просто остаются как были.
 */
export async function changeRole(
  userId: string,
  newRole: 'worker' | 'employer',
  userName?: string
): Promise<{ closedVacancies: number }> {
  let closedVacancies = 0

  if (newRole === 'worker') {
    // Закрываем открытые вакансии: висеть в ленте они не должны.
    for (const table of ['jm_vacancies', 'jm_perm_vacancies']) {
      const { data } = await supabaseAdmin
        .from(table)
        .update({ status: 'closed' })
        .eq('employer_id', userId)
        .eq('status', 'open')
        .select('id')
      closedVacancies += (data ?? []).length
    }
  }

  const patch: Record<string, unknown> = { role: newRole }
  // Компания у соискателя ни к чему, а виды работ — у работодателя.
  if (newRole === 'worker') patch.company = null
  else patch.work_types = []

  const { error } = await supabaseAdmin.from('jm_users').update(patch).eq('id', userId)
  if (error) throw new Error(error.message)

  logActivity(
    'Смена роли',
    `${newRole === 'worker' ? 'Работодатель → работник' : 'Работник → работодатель'}` +
      (closedVacancies ? `, закрыто вакансий: ${closedVacancies}` : ''),
    userId,
    userName
  )
  return { closedVacancies }
}

/**
 * Удалить пользователя из панели.
 *
 * Раньше здесь было полтора десятка запросов подряд, и они делали не то же
 * самое, что кнопка в приложении: панель сносила чаты, сообщения, отзывы и
 * вакансии целиком, а приложение — одну строку (точнее, не сносило ничего,
 * см. миграцию 032). Две разные правды об одном действии.
 *
 * Теперь оба конца зовут одну функцию в базе: своё стирается, чужое
 * обезличивается. Переписка у собеседника остаётся читаемой, рейтинг
 * работодателя не рассыпается из-за чужого ухода, а имени и телефона
 * не остаётся нигде.
 */
export async function deleteUser(userId: string, role: string, userName?: string) {
  const { data, error } = await supabaseAdmin.rpc('jm_delete_account', { uid: userId })
  if (error) throw new Error(error.message)
  logActivity('Удалён пользователь', `ID: ${userId}, роль: ${role}`, userId, userName)
  return data
}

export async function blockUser(userId: string, block: boolean, userName?: string) {
  const { error } = await supabaseAdmin
    .from('jm_users')
    .update({ is_blocked: block })
    .eq('id', userId)
  if (error) throw new Error(error.message)
  logActivity(block ? 'Заблокирован' : 'Разблокирован', `ID: ${userId}`, userId, userName)
}

export async function resetPassword(userId: string): Promise<string> {
  const res = await fetch('/api/admin/reset-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': getToken(),
    },
    body: JSON.stringify({ userId }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error ?? 'Ошибка сброса пароля')
  return data.password as string
}

// ─── Vacancies ────────────────────────────────────────────────────────────────

export async function setPermVacancyStatus(id: string, status: 'open' | 'closed') {
  const { error } = await supabaseAdmin
    .from('jm_perm_vacancies')
    .update({ status })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deletePermVacancy(id: string) {
  const { error } = await supabaseAdmin
    .from('jm_perm_vacancies')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Broadcast push / in-app (via Supabase Edge Function) ────────────────────

export async function sendInAppToUser(userId: string, title: string, body: string) {
  const { data, error } = await supabaseAdmin.functions.invoke('push-notify', {
    body: { userId, title, body, mode: 'inapp' },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  logActivity('In-app уведомление', `Адресат: ${userId}, заголовок: "${title}"`, userId)
  await trySendWebPushToUser(userId, title, body)
}

async function trySendWebPushToUser(userId: string, title: string, body: string) {
  try {
    const { data: sub } = await supabaseAdmin
      .from('jm_web_push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', userId)
      .maybeSingle()
    if (!sub) return
    await fetch('/api/webpush/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': getToken(),
      },
      body: JSON.stringify({
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        title, body,
      }),
    })
  } catch { /* never crash due to web push failure */ }
}

export async function broadcastBoth(
  target: 'all' | 'workers' | 'employers' | 'metro',
  title: string,
  body: string,
  metro?: string,
) {
  const { data, error } = await supabaseAdmin.functions.invoke('push-notify', {
    body: { target, title, body, metro, mode: 'both' },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  logActivity('Рассылка (push+inapp)', `Цель: ${target}, заголовок: "${title}", push: ${data?.pushCount ?? 0}, inapp: ${data?.inappCount ?? 0}`)
  return { pushCount: (data?.pushCount ?? 0) as number, inappCount: (data?.inappCount ?? 0) as number }
}

export async function broadcastWebPush(title: string, body: string): Promise<{ sent: number; failed: number }> {
  const res = await fetch('/api/webpush/broadcast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': getToken(),
    },
    body: JSON.stringify({ title, body }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error ?? 'Ошибка web push рассылки')
  logActivity('Web Push рассылка (iPhone)', `Заголовок: "${title}", отправлено: ${data.sent}`)
  return { sent: data.sent as number, failed: data.failed as number }
}

export async function sendBothToUser(userId: string, title: string, body: string) {
  const { data, error } = await supabaseAdmin.functions.invoke('push-notify', {
    body: { userId, title, body, mode: 'both' },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  logActivity('Уведомление пользователю', `Адресат: ${userId}, заголовок: "${title}"`, userId)
  await trySendWebPushToUser(userId, title, body)
  return { pushCount: (data?.pushCount ?? 0) as number, inappCount: (data?.inappCount ?? 0) as number }
}

// ─── Vacancy editing ─────────────────────────────────────────────────────────

export async function updatePermVacancy(id: string, fields: {
  status?: 'open' | 'closed'
  title?: string
  salary?: number | null
  address?: string
  metro_station?: string
  schedule?: string
  description?: string
}) {
  const { error } = await supabaseAdmin.from('jm_perm_vacancies').update(fields).eq('id', id)
  if (error) throw new Error(error.message)
  logActivity('Вакансия (пост.) обновлена', `ID: ${id}, поля: ${Object.keys(fields).join(', ')}`)
}
