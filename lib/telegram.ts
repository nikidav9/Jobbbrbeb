import { Platform } from 'react-native';

// ─── Mini App shell helpers ──────────────────────────────────────────────────
// JobToo does not authenticate or link accounts through the host messenger.
// The SDK is loaded only to prepare the embedded viewport and read a non-personal
// start parameter for vacancy/referral deep links. User profile/initData is not
// exposed to the application code or sent to our server.

let sdkPromise: Promise<void> | null = null;

function hasTelegramLaunchData(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const url = window.location.href;
  return url.includes('tgWebAppData=') || url.includes('tgWebAppVersion=');
}

/**
 * Load the Telegram SDK only inside a real Mini App launch.
 *
 * A global <script defer> still participates in the deferred-script queue.
 * When telegram.org took 15–20 seconds to answer, Safari kept JobToo's own
 * bundle behind it. A normal browser/PWA does not need this SDK at all.
 */
export async function waitForTelegramMiniApp(timeoutMs = 1_500): Promise<boolean> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  if (getWebApp()) return true;
  if (!hasTelegramLaunchData()) return false;

  if (!sdkPromise) {
    sdkPromise = new Promise<void>((resolve) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-jobtoo-telegram-sdk]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => resolve(), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-web-app.js';
      script.async = true;
      script.dataset.jobtooTelegramSdk = '1';
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }

  await Promise.race([
    sdkPromise,
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
  ]);
  return getWebApp() !== null;
}

function getWebApp(): any | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const wa = (window as any).Telegram?.WebApp;
  // initData is empty when the page is opened in a normal browser
  if (!wa || !wa.initData) return null;
  return wa;
}

export function isTelegramMiniApp(): boolean {
  return getWebApp() !== null;
}

/** start_param from t.me/<bot>/<app>?startapp=... deep links */
export function getTelegramStartParam(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const direct = url.searchParams.get('tgWebAppStartParam')
      || new URLSearchParams(url.hash.replace(/^#/, '')).get('tgWebAppStartParam');
    if (direct) return direct;
  } catch {}
  return getWebApp()?.initDataUnsafe?.start_param ?? null;
}

/** Prepare the Mini App viewport: full height, ready signal, closing guard */
export function initTelegramMiniApp(): void {
  const wa = getWebApp();
  if (!wa) return;
  try {
    wa.ready();
    wa.expand();
    // Avoid accidental closes while scrolling feeds
    wa.isClosingConfirmationEnabled = true;
    if (typeof wa.disableVerticalSwipes === 'function') wa.disableVerticalSwipes();
    if (typeof wa.setHeaderColor === 'function') wa.setHeaderColor('#FFFFFF');
    if (typeof wa.setBackgroundColor === 'function') wa.setBackgroundColor('#FFFFFF');
  } catch {}
}

export function telegramHapticFeedback(type: 'light' | 'success' = 'light'): void {
  const wa = getWebApp();
  if (!wa?.HapticFeedback) return;
  try {
    if (type === 'success') wa.HapticFeedback.notificationOccurred('success');
    else wa.HapticFeedback.impactOccurred('light');
  } catch {}
}
