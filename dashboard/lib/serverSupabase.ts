import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Клиент для серверных маршрутов дашборда (app/api/*). Этот код выполняется
// только на сервере и в браузер не попадает, поэтому сервисный ключ допустим —
// но только под именем без приставки NEXT_PUBLIC_, иначе Next вшил бы его
// в бандл и ключ снова оказался бы у всех на виду.
//
// Раньше тут был запасной вариант с публичным ключом. После включения RLS он
// молча возвращал бы пустоту вместо данных, и поломку было бы не видно —
// поэтому теперь при отсутствии ключа сразу говорим об этом вслух.

export function serverSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('SUPABASE_URL не задан')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY не задан на сервере')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
