import { useEffect, useState } from 'react';
import { dbSignMedia } from '@/services/db';

/**
 * Ссылка на файл из переписки.
 *
 * Файлы чатов лежат в закрытом бакете, и прямой ссылки на них нет — есть
 * подписанная, которая живёт час. Поэтому перед показом её надо получить,
 * а через час, если экран всё ещё открыт, получить заново.
 *
 * Кэш общий на всё приложение: в переписке один и тот же файл рисуется в
 * списке и в самом чате, а иногда и по нескольку раз при перерисовке
 * списка. Без кэша каждая из них ходила бы на сервер за своей подписью.
 *
 * Старые сообщения хранят не путь, а полную публичную ссылку — так писали
 * до перехода на закрытый бакет. Их сюда можно передавать как есть: сервер
 * сам достанет путь, а если файл ещё не переехал, вернёт прежнюю ссылку.
 */

type Entry = { url: string; until: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();

/** На минуту меньше часа: чтобы ссылка не протухла ровно в момент показа. */
const TTL = 59 * 60 * 1000;
const MAX_TRANSIENT_RETRIES = 3;
const RETRY_DELAY_MS = 1_200;

async function resolve(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.url;

  const running = inflight.get(key);
  if (running) return running;

  // Сетевую ошибку не превращаем в честный null. null означает, что сервер
  // ответил «ссылки нет», а rejected Promise — что ответа вообще не получили.
  // Hook ниже повторит только второй случай, поэтому временный обрыв связи не
  // оставит вложение серым до следующего открытия чата.
  const p = dbSignMedia(key)
    .then(url => {
      if (url) cache.set(key, { url, until: Date.now() + TTL });
      return url;
    })
    .finally(() => { inflight.delete(key); });

  inflight.set(key, p);
  return p;
}

export function useSignedMedia(pathOrUrl: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!pathOrUrl) return null;
    const hit = cache.get(pathOrUrl);
    return hit && hit.until > Date.now() ? hit.url : null;
  });

  useEffect(() => {
    if (!pathOrUrl) { setUrl(null); return; }

    let alive = true;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // При смене сообщения не оставляем на месте ссылку от предыдущего файла.
    const hit = cache.get(pathOrUrl);
    setUrl(hit && hit.until > Date.now() ? hit.url : null);

    const load = () => {
      resolve(pathOrUrl)
        .then(nextUrl => {
          if (alive) setUrl(nextUrl);
        })
        .catch(() => {
          if (!alive) return;
          attempts += 1;
          if (attempts < MAX_TRANSIENT_RETRIES) {
            retryTimer = setTimeout(load, RETRY_DELAY_MS * attempts);
          }
        });
    };

    load();
    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [pathOrUrl]);

  return url;
}
