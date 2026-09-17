import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef } from 'react';
import { Platform, AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { Stack, useRouter, usePathname } from 'expo-router';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { AlertProvider } from '@/template';
import { AppProvider, AppContext } from '@/contexts/AppContext';
import ConsentGate from '@/components/ConsentGate';
import CookieConsent from '@/components/CookieConsent';
import { ToastLayer } from '@/components/ui/ToastLayer';
import { setupAndroidChannels } from '@/services/notifications';
import { routeForNotification } from '@/services/notificationRoute';
import { hideWebSplash, markWebBundleMounted } from '@/lib/webSplash';
import { getSessionUser, savePendingReferral } from '@/services/storage';
import { dbRecordGuestEvent } from '@/services/db';
import { initTelegramMiniApp, isTelegramMiniApp, getTelegramStartParam, waitForTelegramMiniApp } from '@/lib/telegram';

// Keep the web/native splash visible until hideAsync() is called from the tabs layout or index screen.
// This prevents the white flash while expo-router navigates and hydrates the tabs route on web.
SplashScreen.preventAutoHideAsync().catch(() => {});

// The static HTML splash (web) stays up through the '/' boot flow and the tabs
// entry — those hide it once data is ready. Any other route (deep links like
// /perm-vacancy-detail, /login, …) should reveal the page immediately.
const ENTRY_PATHS = new Set(['/', '/feed', '/matches', '/chats', '/profile', '/saved']);

function WebSplashController() {
  const pathname = usePathname();

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!ENTRY_PATHS.has(pathname.replace(/\/$/, '') || '/')) {
      hideWebSplash();
    }
  }, [pathname]);

  return null;
}

// Telegram Mini App: viewport setup + startapp deep links
// (t.me/<bot>/<app>?startapp=vacancy_<id> opens that vacancy directly)
function TelegramMiniAppController() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;

    const init = async () => {
      if (!await waitForTelegramMiniApp() || cancelled || !isTelegramMiniApp()) return;
      initTelegramMiniApp();

      const startParam = getTelegramStartParam();

      // Приглашение по коду знакомого. Запоминаем ДО разбора остальных ссылок
      // и до любых переходов: между открытием ссылки и регистрацией человек
      // пройдёт несколько экранов, а мини-приложение может перезапуститься.
      // Сам код здесь никуда не отправляем — его применит регистрация, и
      // только она: приписать пригласившего тому, кто уже зарегистрирован,
      // сервер не даст.
      const refLink = startParam?.match(/^ref_([A-Za-z0-9]{8})$/);
      if (refLink) {
        void savePendingReferral(refLink[1].toUpperCase());
      }

      const campaignLink = startParam?.match(/^(?:(share)_)?(shift|perm)_(.+)_([a-f0-9]{16})$/);
      if (campaignLink) {
        const [, shareMarker, kind, vacancyId, campaignId] = campaignLink;
        void dbRecordGuestEvent('campaign_open', {
          vacancyId,
          vacancyKind: kind === 'perm' ? 'permanent' : 'shift',
          campaignId,
          channel: shareMarker ? 'user_share' : null,
        });
        setTimeout(() => {
          if (cancelled) return;
          if (kind === 'perm') {
            router.push({ pathname: '/perm-vacancy-detail', params: { vacancyId, campaignId } });
          } else {
            router.push({ pathname: '/feed', params: { vacancyId, campaignId } });
          }
        }, 300);
      } else if (startParam?.startsWith('vacancy_')) {
        // Старые опубликованные ссылки продолжают работать.
        const vacancyId = startParam.slice('vacancy_'.length);
        if (vacancyId) {
          setTimeout(() => {
            if (!cancelled) router.push({ pathname: '/perm-vacancy-detail', params: { vacancyId } });
          }, 300);
        }
      } else if (startParam?.startsWith('chat_')) {
        const chatId = startParam.slice('chat_'.length);
        if (chatId) {
          setTimeout(() => {
            if (!cancelled) router.push({ pathname: '/chat-room', params: { chatId } });
          }, 300);
        }
      }
    };
    init().catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return null;
}

function AuthGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const ctx = React.useContext(AppContext);

  const publicPaths = new Set(['/', '/login', '/register-worker', '/register-employer', '/legal', '/perm-vacancy-detail']);

  useEffect(() => {
    if (!ctx) return;
    if (ctx.loading) return;
    const isProtected = !publicPaths.has(pathname);
    if (!ctx.currentUser && isProtected) {
      router.replace('/');
    }
  }, [ctx?.currentUser?.id, ctx?.loading, pathname]);

  return null;
}

// Handles navigation when user taps a push notification
function NotificationHandler() {
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | undefined>(undefined);
  const responseListener = useRef<Notifications.EventSubscription | undefined>(undefined);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    // Foreground: notification received while app is open — no extra action needed,
    // Realtime subscriptions already update the UI.
    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      // UI updates handled by Realtime/polling in AppContext
    });

    // Куда вести по нажатию. Если в аккаунт никто не вошёл, внутрь приложения
    // идти нельзя: экран чата рассчитывает на вошедшего пользователя и падает.
    // Такое случается, когда человек вышел из аккаунта, но приложение оставил,
    // — раньше на это уведомление он получал ошибку.
    const openFromNotification = async (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const type = data?.type as string | undefined;
      const chatId = data?.chatId as string | undefined;

      const target = routeForNotification(type, { chatId });
      if (!target) return;

      const user = await getSessionUser().catch(() => null);
      router.push((user ? target : '/') as never);
    };

    // Background/terminated: user tapped the notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      openFromNotification(response).catch(() => {});
    });

    // Handle notification that launched the app from terminated state
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      setTimeout(() => { openFromNotification(response).catch(() => {}); }, 500);
    }).catch(() => {});

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  return null;
}

async function checkAndApplyUpdate() {
  if (__DEV__ || Platform.OS === 'web') return;
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // OTA check failed silently (server unavailable or no update)
  }
}

function useOTAUpdates() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    checkAndApplyUpdate();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAndApplyUpdate();
    });
    return () => sub.remove();
  }, []);
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ ...Ionicons.font });
  useOTAUpdates();

  useEffect(() => { markWebBundleMounted(); }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    setupAndroidChannels().catch(() => {});
    // Permission is requested from the NotificationPermissionSheet (tabs layout),
    // not automatically on boot — the sheet explains why before the OS dialog.
  }, []);

  return (
    <AlertProvider>
      {/* initialMetrics — чтобы безопасные отступы были известны сразу,
          иначе на первом кадре они нулевые и низ экрана дёргается */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <AppProvider>
          <StatusBar style="dark" />
          <WebSplashController />
          <TelegramMiniAppController />
          <AuthGuard />
          <NotificationHandler />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' } }}>
            <Stack.Screen name="index" options={{ animation: 'none' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
            <Stack.Screen name="register-worker" />
            <Stack.Screen name="register-employer" />
            <Stack.Screen name="login" options={{ presentation: 'modal' }} />
            <Stack.Screen name="legal" />
            <Stack.Screen name="candidates" />
            <Stack.Screen name="chat-room" />
            <Stack.Screen name="match" options={{ presentation: 'modal' }} />
            <Stack.Screen name="rate" options={{ presentation: 'modal' }} />
            <Stack.Screen name="admin" />
            <Stack.Screen name="user-profile" />
            <Stack.Screen name="create-perm-vacancy" />
            <Stack.Screen name="perm-vacancy-detail" />
            <Stack.Screen name="invite" />
            <Stack.Screen name="saved" />
            {/* Шторкой: тест — короткий заход из профиля, а не место, куда
                уходят насовсем. Закрыть крестиком и вернуться на прежний
                экран должно быть очевидно. */}
            <Stack.Screen name="skill-test" options={{ presentation: 'modal' }} />
          </Stack>
          {/* Поверх всего, но под всплывающими сообщениями: окно закрывает
              приложение до принятия документов, а сообщения о неудачной
              записи должны быть видны и над ним. */}
          <ConsentGate />
          {/* Баннер cookie/Метрики — только веб; грузит аналитику после согласия. */}
          <CookieConsent />
          <ToastLayer />
        </AppProvider>
      </SafeAreaProvider>
    </AlertProvider>
  );
}
