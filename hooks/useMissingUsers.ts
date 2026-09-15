import { useEffect, useRef, useState } from 'react';
import { User } from '@/constants/types';
import { dbGetUserById } from '@/services/db';

const MAX_TRANSIENT_RETRIES = 3;
const RETRY_DELAY_MS = 1_200;

/**
 * Догружает пользователей, которых ещё нет в общем списке.
 *
 * Общий список приходит не мгновенно, и в первые секунды карточки показывали
 * «Работник» вместо имени. Показывать заглушку вместо имени — полбеды; хуже,
 * что в чате на её месте подставлялось название компании, и работодателю
 * казалось, будто он переписывается с «Лавкой».
 *
 * Поэтому недостающих запрашиваем поимённо — так же, как это давно делает
 * экран чата. Успешно проверенные id помним, чтобы не дёргать сервер по кругу.
 * Сетевой сбой — другое дело: раньше такой id тоже навсегда попадал в asked,
 * поэтому секундный обрыв оставлял заглушку до ухода с экрана. Для ошибок
 * связи делаем несколько отложенных повторов; настоящий ответ «нет такого
 * пользователя» повторять не нужно.
 */
export function useMissingUsers(users: User[], neededIds: string[]) {
  const [extra, setExtra] = useState<Record<string, User>>({});
  const [retryTick, setRetryTick] = useState(0);
  const asked = useRef<Set<string>>(new Set());
  const retryCounts = useRef<Map<string, number>>(new Map());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  useEffect(() => {
    const missing = neededIds.filter(
      id => id && !asked.current.has(id) && !users.some(u => u.id === id),
    );
    if (missing.length === 0) return;

    missing.forEach(id => asked.current.add(id));

    void Promise.all(
      missing.map(async id => {
        try {
          const user = await dbGetUserById(id);
          return { id, user, failed: false } as const;
        } catch {
          return { id, user: null, failed: true } as const;
        }
      }),
    ).then(results => {
      if (!mounted.current) return;

      const add: Record<string, User> = {};
      let retryNeeded = false;

      results.forEach(({ id, user, failed }) => {
        if (failed) {
          const attempts = (retryCounts.current.get(id) ?? 0) + 1;
          retryCounts.current.set(id, attempts);
          if (attempts < MAX_TRANSIENT_RETRIES) {
            // Разрешаем следующему проходу действительно запросить id снова.
            asked.current.delete(id);
            retryNeeded = true;
          }
          return;
        }

        // Сервер ответил: и найденный пользователь, и честный null — уже не
        // сетевая неопределённость, поэтому больше этот id не повторяем.
        retryCounts.current.delete(id);
        if (user) add[id] = user;
      });

      if (Object.keys(add).length) setExtra(prev => ({ ...prev, ...add }));

      if (retryNeeded && retryTimer.current === null) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          if (mounted.current) setRetryTick(tick => tick + 1);
        }, RETRY_DELAY_MS);
      }
    });
  }, [users, neededIds.join(','), retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ищет сначала в общем списке, потом среди догруженных. */
  return (id: string): User | undefined =>
    users.find(u => u.id === id) ?? extra[id];
}
