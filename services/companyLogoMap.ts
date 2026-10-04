import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dbCompanyLogos } from '@/services/db';

// Логотипы компаний из базы (02.10.2026): карта загружается один раз за
// запуск и лежит в AsyncStorage — до ответа сервера карточки берут прошлую
// карту, а не мигают инициалами. Нет сети — работает встроенный набор
// (constants/companyLogos.ts), за ним инициалы.

const STORE_KEY = 'jt_company_logos_v1';
let map: Record<string, string> = {};
let started = false;
const listeners = new Set<() => void>();

function publish(next: Record<string, string>) {
  map = next;
  listeners.forEach(l => l());
}

/** Ключ компании — как на сервере (jt_company_logo_key). */
export function companyLogoKey(name?: string | null): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function remoteLogoFor(name: string | null | undefined, from: Record<string, string> = map): string | null {
  const key = companyLogoKey(name);
  return key ? from[key] ?? null : null;
}

function loadCompanyLogos(): void {
  if (started) return;
  started = true;
  (async () => {
    try {
      const saved = await AsyncStorage.getItem(STORE_KEY);
      if (saved && !Object.keys(map).length) publish(JSON.parse(saved));
    } catch { /* нет кэша — ждём сервер */ }
    try {
      const fresh = await dbCompanyLogos();
      if (Object.keys(fresh).length) {
        publish(fresh);
        AsyncStorage.setItem(STORE_KEY, JSON.stringify(fresh)).catch(() => {});
      }
    } catch {
      started = false; // повторим при следующем показе знака
    }
  })();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Вся карта — для экранов, где знак рисуется в цикле (хук там не вызвать). */
export function useCompanyLogoMap(): Record<string, string> {
  loadCompanyLogos();
  return useSyncExternalStore(subscribe, () => map, () => map);
}

/** Ссылка на логотип из базы или null; первый вызов запускает загрузку. */
export function useRemoteCompanyLogo(name?: string | null): string | null {
  return remoteLogoFor(name, useCompanyLogoMap());
}
