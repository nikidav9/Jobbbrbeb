/**
 * Отчёты о падениях приложения — Яндекс AppMetrica (решение владельца
 * 03.10.2026; сервис российский, как YandexGPT и Метрика на сайте).
 *
 * Только сбои: сессии, события, геолокация и рекламные идентификаторы
 * выключены, идентификатор человека в отчёт не кладём. Отчёты уходят только
 * пока человек принял документы (ConsentGate) — нет согласия, значит
 * `setDataSendingEnabled(false)`, SDK копит ничего не отправляя.
 *
 * Ключ приложения — `EXPO_PUBLIC_APPMETRICA_API_KEY` (переменная окружения
 * сборки). Нет ключа, веб, телеграм-мини-приложение — ничего не происходит.
 * Включать ключ можно только после того, как отчёты о падениях записаны в
 * Политику и Соглашение: см. CLAUDE.md, раздел про Jupiter и Яндекс.
 */
import { Platform } from 'react-native';

const API_KEY = (process.env.EXPO_PUBLIC_APPMETRICA_API_KEY ?? '').trim();

type Reporter = {
  activate(config: Record<string, unknown>): void;
  setDataSendingEnabled(enabled: boolean): void;
  reportUnhandledException(error: Error): void;
  reportError(id: string, message?: string, reason?: Error): void;
};

let reporter: Reporter | null = null;
let activated = false;

/** Подключён ли сбор вообще: нужен нативный запуск и ключ. */
function crashReportingAvailable(): boolean {
  return Platform.OS !== 'web' && API_KEY !== '';
}

function load(): Reporter | null {
  if (!crashReportingAvailable()) return null;
  if (reporter) return reporter;
  try {
    // require, а не import: модуль нативный, на вебе его трогать нельзя.
    reporter = require('@appmetrica/react-native-analytics').default as Reporter;
  } catch (e) {
    console.warn('[crash] AppMetrica недоступна', e);
  }
  return reporter;
}

/** Необработанная JS-ошибка — в отчёт, затем обычный обработчик React Native. */
function hookGlobalErrors(r: Reporter): void {
  const eu = (globalThis as { ErrorUtils?: {
    getGlobalHandler?: () => ((e: Error, fatal?: boolean) => void) | undefined;
    setGlobalHandler?: (h: (e: Error, fatal?: boolean) => void) => void;
  } }).ErrorUtils;
  const prev = eu?.getGlobalHandler?.();
  eu?.setGlobalHandler?.((error, fatal) => {
    try { r.reportUnhandledException(error); } catch {}
    prev?.(error, fatal);
  });
}

/**
 * Разрешить или запретить отправку отчётов. Первый раз с `true` запускает SDK.
 * Зовётся из ConsentGate: согласие есть — разрешить, нет — запретить.
 */
export function setCrashReportingAllowed(allowed: boolean): void {
  const r = load();
  if (!r) return;
  try {
    if (!activated) {
      if (!allowed) return;
      r.activate({
        apiKey: API_KEY,
        crashReporting: true,
        nativeCrashReporting: true,
        sessionsAutoTracking: false,
        appOpenTrackingEnabled: false,
        locationTracking: false,
        advIdentifiersTracking: false,
        logs: false,
      });
      hookGlobalErrors(r);
      activated = true;
    }
    r.setDataSendingEnabled(allowed);
  } catch (e) {
    console.warn('[crash] не удалось переключить отправку', e);
  }
}

/** Пойманная ошибка экрана (ErrorBoundary): тоже в отчёт, если сбор включён. */
export function reportCaughtError(where: string, error: Error): void {
  if (!activated || !reporter) return;
  try { reporter.reportError(where, error.message, error); } catch {}
}
