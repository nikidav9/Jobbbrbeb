import React, { createContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}
import { Platform, AppState, AppStateStatus } from 'react-native';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getSupabaseClient } from '@/template';
import { User, Vacancy, Like, Chat, PermVacancy, PermApplication } from '@/constants/types';
import {
  getSessionUser,
  saveSessionUser,
  clearSessionUser,
  extractPhoneDigits,
  loadCache,
  saveCache,
  CACHE_KEYS,
  getPendingReferral,
  clearPendingReferral,
} from '@/services/storage';
import {
  dbGetUsers,
  dbUpsertUser,
  dbLogin,
  dbRestoreSession,
  dbClearSession,
  dbGetVacancies,
  dbGetLikesForUser,
  dbGetVacancyStatsMap,
  dbResponsivenessMap,
  Responsiveness,
  dbGetPermVacancyViewsMap,
  dbGetChats,
  dbGetSaved,
  dbGetPermVacancies,
  dbGetPermVacanciesByEmployer,
  dbGetPermApplications,
  dbGetPermSaved,
  dbTouchLastSeen,
  dbLogOpen,
  dbWarmup,
  dbClearPushToken,
  dbDeleteWebPushSubscription,
  dbGetNotifications,
  dbMarkNotifRead,
  dbMarkAllNotifsRead,
  dbTelegramAuth,
  dbBindTelegram,
  dbAutoClosePastVacancies,
  dbRecordConsent,
  dbCompleteGuestRegistration,
  setSessionExpiredHandler,
} from '@/services/db';
import { LEGAL_STAMP, legalVersions } from '@/constants/legal';
import { registerForPushNotifications, releasePushTokenIfSignedOut } from '@/services/notifications';
import { isTelegramMiniApp, getTelegramInitData, waitForTelegramMiniApp } from '@/lib/telegram';
import { registerWebPush } from '@/lib/webPush';
import { setWebSplashProgress } from '@/lib/webSplash';

// Polling interval for native (Realtime is primary, polling is fallback)
const NATIVE_POLL_INTERVAL = 8_000;
// Отметку «был в сети» чаще обновлять незачем: в чате «в сети» держится
// три минуты, так что двух минут между отметками достаточно.
const LAST_SEEN_INTERVAL = 120_000;
// Список пользователей — имена, аватарки, рейтинги. Он тяжёлый: тянет всех
// разом, поэтому в общий опрос его класть нельзя. Но и застывать до конца
// сеанса он не должен — раньше его обновляла подписка, которая замолчала.
const USERS_REFRESH_INTERVAL = 300_000;
// Polling interval for web (Supabase realtime may be blocked in Russia)
const WEB_POLL_INTERVAL = 10_000;

export type ToastType = 'success' | 'error' | 'info' | 'match';
export interface ToastMessage { message: string; type: ToastType }

export interface VacancyStats { applicants: number; rejected: number; views: number }

function computeVacancyStatsMap(likes: Like[]): Record<string, VacancyStats> {
  const map: Record<string, VacancyStats> = {};
  for (const l of likes) {
    if (!l.vacancyId) continue;
    if (!map[l.vacancyId]) map[l.vacancyId] = { applicants: 0, rejected: 0, views: 0 };
    if (l.workerLiked && !l.isMatch && l.employerLiked !== false) map[l.vacancyId].applicants++;
    if (l.employerLiked === false || (l.workerLiked === false && l.workerSkipped === true)) map[l.vacancyId].rejected++;
  }
  return map;
}

export interface AppContextValue {
  currentUser: User | null;
  loading: boolean;
  vacanciesLoading: boolean;
  toast: ToastMessage | null;
  showToast: (message: string, type?: ToastType) => void;
  users: User[];
  vacancies: Vacancy[];
  likes: Like[];
  chats: Chat[];
  unreadCount: number;
  notifications: AppNotification[];
  unreadNotifCount: number;
  refreshNotifications: () => Promise<void>;
  markNotifRead: (id: string) => Promise<void>;
  markAllNotifsRead: () => Promise<void>;
  permVacancies: PermVacancy[];
  permApplications: PermApplication[];
  savedWorkers: User[];
  permSavedWorkers: User[];
  savedIds: string[];
  optimisticAddSaved: (vacancyId: string) => void;
  optimisticRemoveSaved: (vacancyId: string) => void;
  optimisticAddVacancy: (v: Vacancy) => void;
  optimisticUpdateVacancy: (v: Vacancy) => void;
  optimisticAddPermVacancy: (v: PermVacancy) => void;
  optimisticUpdatePermVacancy: (v: PermVacancy) => void;
  optimisticAddChat: (c: Chat) => void;
  optimisticUpdateChat: (c: Chat) => void;
  optimisticAddLike: (l: Like) => void;
  optimisticUpdateLike: (l: Like) => void;
  registerUser: (u: User) => Promise<void>;
  loginUser: (phone: string, password: string) => Promise<User | null>;
  logout: () => Promise<void>;
  /** Войти как гость (просмотр без регистрации) в роли соискателя. */
  enterGuest: () => void;
  /** Выйти из гостевого режима (перед переходом на регистрацию). */
  exitGuest: () => void;
  refreshUsers: () => Promise<void>;
  refreshVacancies: () => Promise<void>;
  refreshLikes: (u?: User) => Promise<void>;
  refreshChats: (u?: User) => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshSaved: (u?: User) => Promise<void>;
  permSavedIds: string[];
  optimisticAddPermSaved: (vacancyId: string) => void;
  optimisticRemovePermSaved: (vacancyId: string) => void;
  refreshPermVacancies: (u?: User) => Promise<void>;
  refreshPermApplications: (u?: User) => Promise<void>;
  refreshPermSaved: (u?: User) => Promise<void>;
  updateUser: (u: User) => Promise<void>;
  vacancyStatsMap: Record<string, VacancyStats>;
  responsivenessMap: Record<string, Responsiveness>;
  refreshVacancyStats: () => Promise<void>;
  permVacancyViewsMap: Record<string, number>;
  refreshPermVacancyViews: () => Promise<void>;
  /** true once the initial fresh-data fetch (vacancies, …) has completed */
  dataReady: boolean;
  /**
   * true, когда не принесли вакансии (сеть/маршрут упал). Приложение
   * показывает последние сохранённые данные, а экран — плашку «нет связи»,
   * чтобы пустой список не читался как «вакансий нет».
   *
   * Это признак ИМЕННО вакансий, а не сервера вообще. Экрану, который живёт
   * с другого списка, он не подходит: чаты могут не прийти, когда вакансии
   * пришли, и наоборот, — см. offline ниже.
   */
  backendOffline: boolean;
  /**
   * Какой именно список не принесли. Один общий признак врал бы в обе
   * стороны: сказал бы «нет связи» на экране, чей список пришёл, и промолчал
   * бы там, где не пришёл. Экран должен говорить о СВОЁМ списке.
   */
  offline: OfflineMap;
}

/** Списки, о доставке которых экраны спрашивают по отдельности. */
export type OfflineKey = 'vacancies' | 'permVacancies' | 'likes' | 'permApplications' | 'chats';
export type OfflineMap = Record<OfflineKey, boolean>;

export const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, _setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [offline, setOffline] = useState<OfflineMap>({
    vacancies: false, permVacancies: false, likes: false, permApplications: false, chats: false,
  });
  // Ссылочное равенство важно: признак читают экраны, и лишний объект на
  // каждом успешном обновлении перерисовывал бы их все.
  const markOffline = useCallback((key: OfflineKey, value: boolean) => {
    setOffline(prev => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);
  // Прежний общий признак. Значение то же, что и было: его поднимали и
  // снимали ровно эти два обновления, и экраны ленты с ними и работают.
  const backendOffline = offline.vacancies || offline.permVacancies;
  const [vacanciesLoading, setVacanciesLoading] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const [users, setUsers] = useState<User[]>([]);
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [likes, setLikes] = useState<Like[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [permVacancies, setPermVacancies] = useState<PermVacancy[]>([]);
  const [permApplications, setPermApplications] = useState<PermApplication[]>([]);
  const [savedWorkers] = useState<User[]>([]);
  const [permSavedWorkers] = useState<User[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [vacancyStatsMap, setVacancyStatsMap] = useState<Record<string, VacancyStats>>({});
  const [responsivenessMap, setResponsivenessMap] = useState<Record<string, Responsiveness>>({});
  const [permVacancyViewsMap, setPermVacancyViewsMap] = useState<Record<string, number>>({});

  const unreadNotifCount = notifications.filter(n => !n.isRead).length;

  const refreshNotifications = useCallback(async () => {
    const user = await getSessionUser();
    if (!user) return;
    try {
      const rows = await dbGetNotifications(user.id);
      const mapped = rows.map((n: any) => ({
        id: n.id, title: n.title, body: n.body,
        isRead: n.is_read, createdAt: n.created_at,
      }));
      setNotifications(mapped);
      saveCache(CACHE_KEYS.notifications(user.id), mapped).catch(() => {});
    } catch (e) {
      console.warn('[notifications] refreshNotifications error', e);
    }
  }, []);

  const markNotifRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    await dbMarkNotifRead(id).catch(() => {});
  }, []);

  const markAllNotifsRead = useCallback(async () => {
    const user = await getSessionUser();
    if (!user) return;
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    await dbMarkAllNotifsRead(user.id).catch(() => {});
  }, []);
  const [permSavedIds, setPermSavedIds] = useState<string[]>([]);

  const optimisticAddSaved = useCallback((vacancyId: string) => {
    setSavedIds(prev => prev.includes(vacancyId) ? prev : [...prev, vacancyId]);
  }, []);
  const optimisticRemoveSaved = useCallback((vacancyId: string) => {
    setSavedIds(prev => prev.filter(id => id !== vacancyId));
  }, []);
  const optimisticAddPermSaved = useCallback((vacancyId: string) => {
    setPermSavedIds(prev => prev.includes(vacancyId) ? prev : [...prev, vacancyId]);
  }, []);
  const optimisticRemovePermSaved = useCallback((vacancyId: string) => {
    setPermSavedIds(prev => prev.filter(id => id !== vacancyId));
  }, []);
  const optimisticAddVacancy = useCallback((v: Vacancy) => {
    setVacancies(prev => [v, ...prev.filter(x => x.id !== v.id)]);
  }, []);
  const optimisticUpdateVacancy = useCallback((v: Vacancy) => {
    setVacancies(prev => prev.map(x => x.id === v.id ? v : x));
  }, []);
  const optimisticAddPermVacancy = useCallback((v: PermVacancy) => {
    setPermVacancies(prev => [v, ...prev.filter(x => x.id !== v.id)]);
  }, []);
  const optimisticUpdatePermVacancy = useCallback((v: PermVacancy) => {
    setPermVacancies(prev => prev.map(x => x.id === v.id ? v : x));
  }, []);
  const optimisticAddChat = useCallback((c: Chat) => {
    setChats(prev => [c, ...prev.filter(x => x.id !== c.id)]);
  }, []);
  const optimisticUpdateChat = useCallback((c: Chat) => {
    setChats(prev => prev.map(x => x.id === c.id ? c : x));
  }, []);
  const optimisticAddLike = useCallback((l: Like) => {
    setLikes(prev => [l, ...prev.filter(x => x.id !== l.id)]);
  }, []);
  const optimisticUpdateLike = useCallback((l: Like) => {
    setLikes(prev => prev.map(x => x.id === l.id ? l : x));
  }, []);

  // ─── Boot ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      setWebSplashProgress(45);
      // Vacancies are public — start fetching immediately, before session/delay
      refreshVacancies(true).catch(() => {});
      // Close shifts that start within 30 min (or already passed), then re-fetch
      dbAutoClosePastVacancies()
        .then(() => { if (!cancelled) refreshVacancies().catch(() => {}); })
        .catch(() => {});

      try {
        // Читаем сессию сразу. На Android AsyncStorage изредка отдаёт null,
        // если прочитать слишком рано, — поэтому при промахе делаем несколько
        // коротких повторов вместо безусловной секундной паузы: иначе гость,
        // которому грузить нечего, зря смотрит на загрузочный экран.
        let sessionUser = await getSessionUser().catch(() => null);
        if (!sessionUser && Platform.OS === 'android') {
          for (let i = 0; i < 3 && !sessionUser; i++) {
            await new Promise<void>(r => setTimeout(r, 200));
            if (cancelled) return;
            sessionUser = await getSessionUser().catch(() => null);
          }
        }
        if (cancelled) return;
        setWebSplashProgress(55);

        // Кэш профиля сам по себе больше не считается входом. Проверяем
        // подписанную серверную сессию; старые установки без токена один раз
        // вернутся на экран входа, вместо доступа по подставленному user id.
        if (sessionUser && !sessionUser.isGuest) {
          try {
            const restored = await dbRestoreSession();
            if (restored && !restored.isBlocked) {
              sessionUser = restored;
              await saveSessionUser(restored).catch(() => {});
            } else {
              sessionUser = null;
              await clearSessionUser().catch(() => {});
            }
          } catch (e) {
            // При обновлении сайта/обрыве сети сохраняем локальный вход.
            // Выход делаем только после подтверждённо недействительной сессии.
            console.warn('[session] restore unavailable, keeping cached user', e);
            // Сессию не восстановили — сервер не ответил вовсе, а значит не
            // принесут ни один список. Помечаем все: каждый снимет свой
            // признак сам, когда его обновление пройдёт.
            (['vacancies', 'permVacancies', 'likes', 'permApplications', 'chats'] as OfflineKey[])
              .forEach(k => markOffline(k, true));
          }
        }

        // Telegram Mini App: auto-login via signed initData — no password needed
        if (!sessionUser) await waitForTelegramMiniApp();
        if (!sessionUser && isTelegramMiniApp()) {
          const initData = getTelegramInitData();
          if (initData) {
            const res = await dbTelegramAuth(initData).catch(() => null);
            if (res?.ok && res.user && !res.user.isBlocked) {
              sessionUser = res.user;
              await saveSessionUser(res.user).catch(() => {});
            }
          }
        }

        if (cancelled) return;

        // Событие «открыл приложение» (Фаза 1b). Один раз за холодный старт,
        // как только выяснили, кто открыл: role — в каком «мире» человек уже
        // (worker/employer), либо null, если он ещё гость и видит экран выбора
        // «Выберите, кто вы». Так виден и тот, кто установил и открыл, но так и
        // не завёл аккаунт (в last_seen_at его нет вообще). Fire-and-forget —
        // никогда не блокирует загрузку.
        {
          const platform =
            Platform.OS !== 'web'
              ? Platform.OS
              : isTelegramMiniApp()
              ? 'tg'
              : (typeof window !== 'undefined' &&
                  (window.matchMedia?.('(display-mode: standalone)')?.matches ||
                    (window.navigator as any)?.standalone))
              ? 'pwa'
              : 'web';
          dbLogOpen(sessionUser?.id ?? null, sessionUser?.role ?? null, platform);
        }

        // Открыли приложение, а входить некому — значит это устройство ни за
        // кем не числится. Снимаем с него токен: иначе уведомления так и
        // будут приходить за аккаунт, из которого человек давно вышел.
        if (!sessionUser) releasePushTokenIfSignedOut().catch(() => {});

        if (sessionUser) {
          _setCurrentUser(sessionUser);

          // Restore cached data instantly
          const [cachedVac, cachedLikes, cachedChats, cachedPermVac, cachedPermApps, cachedStats, cachedNotifs, cachedUsers] = await Promise.all([
            loadCache<Vacancy[]>(CACHE_KEYS.vacancies),
            loadCache<Like[]>(CACHE_KEYS.likes(sessionUser.id)),
            loadCache<Chat[]>(CACHE_KEYS.chats(sessionUser.id)),
            loadCache<PermVacancy[]>(CACHE_KEYS.permVac(sessionUser.id)),
            loadCache<PermApplication[]>(CACHE_KEYS.permApps(sessionUser.id)),
            loadCache<Record<string, VacancyStats>>(CACHE_KEYS.allVacancyStats),
            loadCache<AppNotification[]>(CACHE_KEYS.notifications(sessionUser.id)),
            loadCache<User[]>(CACHE_KEYS.users),
          ]);
          setWebSplashProgress(70);

          if (cancelled) return;
          if (cachedVac) setVacancies(cachedVac);
          if (cachedLikes) setLikes(cachedLikes);
          if (cachedChats) setChats(cachedChats);
          if (cachedPermVac) setPermVacancies(cachedPermVac);
          if (cachedPermApps) setPermApplications(cachedPermApps);
          if (cachedUsers) setUsers(cachedUsers);
          if (cachedStats) setVacancyStatsMap(cachedStats);
          if (cachedNotifs) setNotifications(cachedNotifs);

          // Quick retry for stats + notifications in case initial fetch is slow
          setTimeout(() => {
            if (cancelled) return;
            Promise.all([refreshVacancyStats(), refreshResponsiveness(), refreshNotifications()]).catch(() => {});
          }, 5000);

          // Refresh push token on every cold start — FCM token can change after APK reinstall
          setTimeout(() => { registerForPushNotifications(sessionUser.id).catch(() => {}); }, 2000);
          // Register web push for already-logged-in users (web/PWA)
          registerWebPush(sessionUser.id).catch(() => {});

          // Refresh user-specific data in background — vacancies already started above.
          // Загрузочный экран ждёт только то, без чего первый экран неполон:
          // остальное подтягивается в фоне, а кэш уже показан. Раньше экран
          // держался до конца всех двенадцати запросов и подолгу висел на 95 %.
          setTimeout(() => {
            if (cancelled) return;

            const critical = Promise.all([
              refreshUsers(),
              refreshLikes(sessionUser),
              refreshChats(sessionUser),
            ]).catch(() => {});
            // Потолок ожидания: даже при медленной сети не держим экран дольше
            const cap = new Promise<void>(r => setTimeout(r, 1200));
            setWebSplashProgress(80);
            Promise.race([critical, cap]).finally(() => {
              if (!cancelled) {
                // Данные готовы, но экран вкладок ещё может не быть смонтирован.
                // Особенно в установленной iOS PWA router иногда коммитит его
                // на несколько кадров позже. 100 % выставит уже отрисованный
                // экран, иначе splash исчезает над пустым белым root-view.
                setWebSplashProgress(95);
                setDataReady(true);
              }
            });

            // Фоновая догрузка — загрузочный экран её не ждёт
            Promise.all([
              refreshSaved(sessionUser),
              refreshPermVacancies(sessionUser),
              refreshPermApplications(sessionUser),
              refreshPermSaved(sessionUser),
              refreshNotifications(),
              refreshVacancyStats(),
        refreshResponsiveness(),
              refreshPermVacancyViews(),
            ]).catch(() => {});
          }, 100);

          // Register/refresh push token on every app open — catches users
          // who registered before push notifications were added.
          setTimeout(() => {
            if (cancelled) return;
            registerForPushNotifications(sessionUser.id).catch(() => {});
          }, 2000);
        } else {
          // Guest: nothing user-specific to load
          // Финальные 100 % выставляет index после первого отрисованного кадра.
          setWebSplashProgress(95);
          setDataReady(true);
        }
      } catch (e) {
        console.warn('[AppContext] boot error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Safety timeout — always unblock UI after 6 seconds
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 6000);

    boot().finally(() => clearTimeout(safetyTimer));

    return () => { cancelled = true; clearTimeout(safetyTimer); };
  }, []);

  // ─── Keep connection alive (web only) ─────────────────────────────────────

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // Через прокси: прямой запрос к таблице после закрытия базы получает
    // отказ, то есть прогрев перестал что-либо прогревать.
    const interval = setInterval(() => { dbWarmup(); }, 4 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ─── Realtime subscriptions ────────────────────────────────────────────────
  // Web: uses supabase-js directly.
  // Native: uses the singleton Supabase client from template/core/client.ts
  //         which has a stable WebSocket connection (bypasses the API proxy).

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!currentUser) return;
    if (!isSupabaseConfigured) return;

    const user = currentUser;
    const subs: ReturnType<typeof supabase.channel>[] = [];

    const safeSub = (ch: ReturnType<typeof supabase.channel>) => {
      try {
        subs.push(ch.subscribe());
      } catch (e) {
        console.warn('[AppContext] realtime subscription failed:', e);
      }
    };

    // Один канал сигналов вместо одиннадцати подписок на таблицы.
    //
    // Подписка на таблицу приносит строки, а значит требует права их читать.
    // Ключ приложения лежит в каждой установленной сборке, и выдать ему такие
    // права — то же самое, что открыть телефоны и переписку четырёхсот
    // человек любому, кто этот ключ оттуда достанет.
    //
    // Поэтому сервер шлёт только имя раздела — ни строчки данных, — а мы по
    // нему перечитываем нужное через прокси, где проверяется пропуск.
    // Сигналы расставлены в обёртках записи (php-proxy/db.php, rt_touch),
    // чтобы о них нельзя было забыть.
    const onChange: Record<string, () => void> = {
      vacancies: () => refreshVacancies(),
      chats: () => refreshChats(user),
      likes: () => refreshLikes(user),
      perm_vacancies: () => refreshPermVacancies(user),
      perm_applications: () => refreshPermApplications(user),
      users: () => refreshUsers(),
      saved: () => refreshSaved(user),
      perm_saved: () => refreshPermSaved(user),
      ratings: () => refreshUsers(),
      notifications: () => refreshNotifications(),
    };

    safeSub(
      supabase.channel('jt').on('broadcast', { event: 'changed' }, ({ payload }) => {
        // Ключ по-русски — такой же, как на стороне сервера: разбирать это
        // придётся вместе с php-proxy, и разные имена там и тут только мешают.
        const what = (payload as { что?: string } | undefined)?.что;
        if (what && onChange[what]) onChange[what]();
      })
    );

    return () => {
      subs.forEach(s => { try { s.unsubscribe(); } catch {} });
    };
  }, [currentUser?.id]);

  // ─── Polling fallback for web (Supabase realtime may be blocked in Russia) ──
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!currentUser) return;

    const user = currentUser;
    const poll = () => {
      Promise.all([
        refreshChats(user),
        refreshLikes(user),
        refreshVacancies(),
        refreshPermVacancies(user),
        refreshPermApplications(user),
        refreshNotifications(),
        refreshVacancyStats(),
        refreshResponsiveness(),
        refreshPermVacancyViews(),
        refreshSaved(user),
        refreshPermSaved(user),
      ]).catch(() => {});
    };
    // Immediate poll on mount so new data appears right after login
    poll();
    const interval = setInterval(poll, WEB_POLL_INTERVAL);

    // Отметка «был в сети». Раньше она стояла только в эффекте для нативных,
    // и у тех, кто заходит с сайта, last_seen_at не появлялся вообще никогда:
    // в шапке чата у них не было статуса, а в дашборде — последнего входа.
    const touch = () => { if (user.id && !user.isGuest) dbTouchLastSeen(user.id); };
    touch();
    const seenInterval = setInterval(touch, LAST_SEEN_INTERVAL);
    const usersInterval = setInterval(() => { refreshUsers().catch(() => {}); }, USERS_REFRESH_INTERVAL);

    // Возврат к вкладке — то же, что выход приложения из фона на телефоне.
    // Вкладку могут держать открытой сутками, поэтому без этого отметка
    // отставала бы на целый интервал.
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        poll(); touch();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    return () => {
      clearInterval(interval);
      clearInterval(seenInterval);
      clearInterval(usersInterval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [currentUser?.id]);

  // ─── Polling fallback for native (fires when app comes to foreground) ──────
  // Realtime covers live updates; polling ensures consistency after reconnect.

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!currentUser) return;

    const user = currentUser;

    const poll = () => {
      Promise.all([
        refreshChats(user),
        refreshVacancies(),
        refreshLikes(user),
        // Постоянные вакансии и отклики на них раньше держались на живых
        // подписках. Подписки замолчали, когда мы закрыли базу, а в опрос их
        // не добавили: работодатель не видел нового отклика до перезапуска
        // приложения. Запросы дешёвые — оба отфильтрованы по человеку.
        refreshPermVacancies(user),
        refreshPermApplications(user),
        refreshNotifications(),
        refreshVacancyStats(),
        refreshResponsiveness(),
        refreshPermVacancyViews(),
        refreshSaved(user),
        refreshPermSaved(user),
      ]).catch(() => {});
    };

    // Immediate poll on mount so new data appears right after login
    poll();
    // Poll on interval
    const interval = setInterval(poll, NATIVE_POLL_INTERVAL);

    // Отметка «был в сети»: при запуске, при возврате из фона и раз в
    // несколько минут, пока приложение открыто. Из неё собирается статус
    // в шапке чата и раздел активности в дашборде.
    const touch = () => { if (user?.id && !user.isGuest) dbTouchLastSeen(user.id); };
    touch();
    const seenInterval = setInterval(touch, LAST_SEEN_INTERVAL);
    const usersInterval = setInterval(() => { refreshUsers().catch(() => {}); }, USERS_REFRESH_INTERVAL);

    // Also poll immediately when app returns to foreground
    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') { poll(); touch(); }
    };
    const sub = AppState.addEventListener('change', handleAppState);

    return () => {
      clearInterval(interval);
      clearInterval(seenInterval);
      clearInterval(usersInterval);
      sub.remove();
    };
  }, [currentUser?.id]);

  // ─── Native realtime: instant notification badge update ───────────────────
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!currentUser) return;

    let ch: any = null;
    try {
      // Тот же канал сигналов, что и на вебе: подписка на таблицу требует
      // права её читать, а ключ приложения лежит в каждой сборке.
      //
      // Отбора по человеку здесь больше нет — сигнал общий. Значит уведомления
      // перечитает и тот, кому ничего не пришло: один дешёвый запрос вместо
      // права читать чужие уведомления. Обмен того стоит.
      const client = getSupabaseClient();
      ch = client
        .channel('jt')
        .on('broadcast', { event: 'changed' }, ({ payload }: { payload?: { что?: string } }) => {
          if (payload?.что === 'notifications') refreshNotifications();
        });
      ch.subscribe();
    } catch (e) {
      console.warn('[AppContext] native notif realtime failed:', e);
    }

    return () => {
      try { ch?.unsubscribe(); } catch {}
    };
  }, [currentUser?.id]);

  // ─── Auth actions ──────────────────────────────────────────────────────────

  const registerUser = async (u: User) => {
    // Приглашение, если человек пришёл по ссылке знакомого. Забираем ДО
    // записи и стираем СРАЗУ после: чужой код, оставшийся в хранилище, был бы
    // приписан следующему, кто зарегистрируется на этом телефоне.
    const referralCode = (await getPendingReferral()) ?? undefined;
    // Согласие передаём ТЕМ ЖЕ запросом. Отдельный вызов ниже оставлен для
    // совместимости со старым сервером и безвреден: запись перезаписывает ту
    // же строку, а не плодит вторую.
    await dbUpsertUser(u, referralCode, { stamp: LEGAL_STAMP, docs: legalVersions() });
    if (referralCode) void clearPendingReferral();
    // Если человек пришёл из гостевого просмотра, замыкаем анонимную
    // воронку. user_id не связываем с anon_id и в событие не передаём.
    void dbCompleteGuestRegistration();
    // Галочка на экране регистрации была переменной в памяти, и дальше
    // кнопки «Продолжить» о ней не знал никто. Теперь принятое остаётся
    // в базе — здесь, а не в двух экранах регистрации по отдельности:
    // забыть одно из двух мест куда проще, чем это одно.
    void dbRecordConsent(u.id, LEGAL_STAMP, legalVersions(), 'registration');
    _setCurrentUser(u);
    await saveSessionUser(u);
    // Inside the Telegram Mini App: link this Telegram account for auto-login
    if (isTelegramMiniApp()) {
      const initData = getTelegramInitData();
      if (initData) dbBindTelegram(u.id, initData).catch(() => {});
    }
    // Задержка нужна чтобы система успела обработать разрешения на уведомления
    setTimeout(() => { registerForPushNotifications(u.id).catch(() => {}); }, 2000);
    setTimeout(() => {
      Promise.all([
        refreshUsers(),
        refreshVacancies(),
        refreshLikes(u),
        refreshChats(u),
        refreshSaved(u),
        refreshPermVacancies(u),
        refreshPermApplications(u),
        refreshPermSaved(u),
      ]).catch(() => {}).finally(() => setDataReady(true));
    }, 300);
  };

  const loginUser = async (phone: string, password: string): Promise<User | null> => {
    const digits = extractPhoneDigits(phone);
    // Пароль сверяет сервер: сюда приходит либо профиль без пароля, либо null.
    const found = await dbLogin(digits, password);
    if (!found) return null;
    _setCurrentUser(found);
    await saveSessionUser(found);
    // Inside the Telegram Mini App: link this Telegram account for auto-login
    if (isTelegramMiniApp()) {
      const initData = getTelegramInitData();
      if (initData) dbBindTelegram(found.id, initData).catch(() => {});
    }
    registerForPushNotifications(found.id).catch(() => {});
    setTimeout(() => {
      Promise.all([
        refreshUsers(),
        refreshVacancies(),
        refreshLikes(found),
        refreshChats(found),
        refreshSaved(found),
        refreshPermVacancies(found),
        refreshPermApplications(found),
        refreshPermSaved(found),
      ]).catch(() => {}).finally(() => setDataReady(true));
    }, 300);
    return found;
  };

  const logout = async () => {
    // Отвязываем устройство от аккаунта. Пока токен лежал в строке
    // пользователя, сервер продолжал слать на телефон уведомления, хотя
    // человек уже вышел: приложение он не удалял. По нажатию такое
    // уведомление вело внутрь приложения, где входить уже некому.
    const leaving = currentUser;
    if (leaving) {
      if (Platform.OS === 'web') dbDeleteWebPushSubscription(leaving.id).catch(() => {});
      else dbClearPushToken(leaving.id).catch(() => {});
    }

    _setCurrentUser(null);
    await clearSessionUser();
    await dbClearSession();
    setUsers([]);
    setVacancies([]);
    setLikes([]);
    setChats([]);
    setPermVacancies([]);
    setPermApplications([]);
    setSavedIds([]);
    setPermSavedIds([]);
  };

  // Держим ссылку на актуальный logout: обработчик 401 регистрируется один раз
  // на монтировании, а сам logout пересоздаётся каждый рендер (замыкает свежее
  // состояние). Через ref обработчик всегда зовёт последнюю версию.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  // Протухла сессия (сервер ответил 401 на авторизованный вызов, например при
  // «Опубликовать»): выходим и возвращаемся на вход. db.ts уже почистил токен и
  // показал понятный текст; сброс currentUser поднимает гейт в app/_layout,
  // который уводит с защищённого экрана на «/».
  useEffect(() => {
    setSessionExpiredHandler(() => { logoutRef.current?.().catch(() => {}); });
    return () => setSessionExpiredHandler(null);
  }, []);

  const updateUser = async (u: User) => {
    // Профиль считаем изменённым только после подтверждения сервера. Раньше
    // UI и локальная сессия менялись первыми: при сетевой ошибке человек видел
    // новые данные, хотя после перезапуска сервер возвращал старые.
    await dbUpsertUser(u);
    _setCurrentUser(u);
    setUsers(prev => {
      const index = prev.findIndex(x => x.id === u.id);
      if (index < 0) return [...prev, u];
      const next = [...prev];
      next[index] = u;
      return next;
    });
    // Кэш сессии не является подтверждением операции: если локальное хранилище
    // недоступно, серверная запись всё равно уже состоялась.
    saveSessionUser(u).catch(e => console.warn('[AppContext] session cache update failed', e));
  };

  // ─── Гостевой просмотр без регистрации (Фаза 2) ────────────────────────────
  // Соискательская лента фильтрует и сортирует по currentUser (workTypes, метро,
  // скор), а без пользователя возвращает пустой список. Поэтому гость — это
  // синтетический соискатель со всеми типами работы (видит всё) и флагом
  // isGuest. Его НЕЛЬЗЯ сохранять в сессию и от его имени НЕЛЬЗЯ писать в базу:
  // и то и другое отсечено по isGuest (в touch, в опросах, в действиях ленты).
  const enterGuest = () => {
    _setCurrentUser({
      id: 'guest',
      role: 'worker',
      phone: '',
      firstName: 'Гость',
      lastName: '',
      workTypes: ['stocker', 'cook', 'shift_supervisor', 'picker'],
      createdAt: new Date().toISOString(),
      isGuest: true,
    });
  };
  const exitGuest = () => {
    _setCurrentUser(prev => (prev?.isGuest ? null : prev));
  };

  // ─── Refresh helpers ───────────────────────────────────────────────────────

  const refreshUsers = async () => {
    const data = await dbGetUsers();
    setUsers(data);
    saveCache(CACHE_KEYS.users, data).catch(() => {});
    _setCurrentUser(prev => {
      if (!prev) return prev;
      const fresh = data.find(u => u.id === prev.id);
      if (!fresh) return prev;
      saveSessionUser(fresh).catch(() => {});
      return fresh;
    });
  };

  const refreshVacancies = async (silent = false) => {
    if (!silent) setVacanciesLoading(true);
    try {
      const data = await dbGetVacancies();
      setVacancies(data);
      saveCache(CACHE_KEYS.vacancies, data).catch(() => {});
      markOffline('vacancies', false);
    } catch (e) {
      // Сеть/маршрут до сервера упал: список НЕ трогаем (остаются последние
      // данные из кэша), только помечаем, что связи нет. Ошибку пробрасываем —
      // вызывающие её и так глотают через .catch.
      markOffline('vacancies', true);
      throw e;
    } finally {
      if (!silent) setVacanciesLoading(false);
    }
  };

  const refreshLikes = async (u?: User) => {
    const user = u ?? currentUser;
    // Без вошедшего человека откликов нет и быть не может: операция требует
    // сессии. Прежде здесь звалась dbGetLikes(), отдававшая ВСЮ таблицу
    // откликов сервиса, — ветка и не работала бы, и просить такое незачем.
    if (!user) {
      setLikes([]);
      return;
    }
    // Тот же уговор, что и с вакансиями: сбой не затирает список, а поднимает
    // признак. Без него экран «Отклики» показывал бы «нет активных заявок» —
    // и только что откликнувшийся прочитал бы это как «мой отклик пропал».
    try {
      const data = await dbGetLikesForUser(user.id, user.role);
      setLikes(data);
      saveCache(CACHE_KEYS.likes(user.id), data).catch(() => {});
      markOffline('likes', false);
    } catch (e) {
      markOffline('likes', true);
      throw e;
    }
  };

  const refreshChats = async (u?: User) => {
    const user = u ?? currentUser;
    if (!user) return;
    try {
      const data = await dbGetChats(user.id, user.role);
      setChats(data);
      saveCache(CACHE_KEYS.chats(user.id), data).catch(() => {});
      markOffline('chats', false);
    } catch (e) {
      markOffline('chats', true);
      throw e;
    }
  };

  const refreshAll = useCallback(async () => {
    if (!currentUser) return;
    const user = currentUser;
    await Promise.all([
      refreshUsers(),
      refreshVacancies(),
      refreshLikes(user),
      refreshPermVacancies(user),
      // Отклики на постоянные вакансии не обновлялись даже здесь — человек
      // тянул экран вниз, а список оставался прежним.
      refreshPermApplications(user),
      refreshChats(user),
      refreshNotifications(),
      refreshVacancyStats(),
      refreshPermVacancyViews(),
      refreshSaved(user),
      refreshPermSaved(user),
    ]);
  }, [currentUser]);

  const refreshSaved = async (u?: User) => {
    const user = u ?? currentUser;
    if (!user) return;
    const ids = await dbGetSaved(user.id);
    setSavedIds(ids);
  };

  const refreshPermVacancies = async (u?: User) => {
    const user = u ?? currentUser;
    if (!user) return;
    try {
      const data = user.role === 'employer'
        ? await dbGetPermVacanciesByEmployer(user.id)
        : await dbGetPermVacancies();
      setPermVacancies(data);
      saveCache(CACHE_KEYS.permVac(user.id), data).catch(() => {});
      markOffline('permVacancies', false);
    } catch (e) {
      // Не затираем список при сбое сети — остаются последние данные.
      markOffline('permVacancies', true);
      throw e;
    }
  };

  const refreshPermApplications = async (u?: User) => {
    const user = u ?? currentUser;
    if (!user) return;
    try {
      const data = await dbGetPermApplications(user.id, user.role);
      setPermApplications(data);
      saveCache(CACHE_KEYS.permApps(user.id), data).catch(() => {});
      markOffline('permApplications', false);
    } catch (e) {
      markOffline('permApplications', true);
      throw e;
    }
  };

  const refreshPermSaved = async (u?: User) => {
    const user = u ?? currentUser;
    if (!user) return;
    const ids = await dbGetPermSaved(user.id);
    setPermSavedIds(ids);
  };

  const refreshVacancyStats = async () => {
    try {
      const map = await dbGetVacancyStatsMap();
      setVacancyStatsMap(map);
      saveCache(CACHE_KEYS.allVacancyStats, map).catch(() => {});
    } catch {}
  };

  // Отзывчивость директоров — одной картой на всех: на карточку в ленте
  // отдельным запросом ходить нельзя, лента превратится в слайд-шоу.
  const refreshResponsiveness = async () => {
    try {
      setResponsivenessMap(await dbResponsivenessMap());
    } catch {}
  };

  const refreshPermVacancyViews = async () => {
    try {
      const map = await dbGetPermVacancyViewsMap();
      setPermVacancyViewsMap(map);
    } catch {}
  };

  const unreadCount = chats.reduce((sum, c) => {
    if (currentUser?.role === 'worker') return sum + (c.unreadWorker ?? 0);
    if (currentUser?.role === 'employer') return sum + (c.unreadEmployer ?? 0);
    return sum;
  }, 0);

  return (
    <AppContext.Provider
      value={{
        currentUser,
        loading,
        dataReady,
        backendOffline,
        offline,
        vacanciesLoading,
        toast,
        showToast,
        users,
        vacancies,
        likes,
        chats,
        unreadCount,
        permVacancies,
        permApplications,
        savedWorkers,
        permSavedWorkers,
        savedIds,
        optimisticAddSaved,
        optimisticRemoveSaved,
        optimisticAddVacancy,
        optimisticUpdateVacancy,
        optimisticAddPermVacancy,
        optimisticUpdatePermVacancy,
        optimisticAddChat,
        optimisticUpdateChat,
        optimisticAddLike,
        optimisticUpdateLike,
        permSavedIds,
        optimisticAddPermSaved,
        optimisticRemovePermSaved,
        registerUser,
        loginUser,
        logout,
        enterGuest,
        exitGuest,
        refreshUsers,
        refreshVacancies,
        refreshLikes,
        refreshChats,
        refreshSaved,
        refreshPermVacancies,
        refreshPermApplications,
        refreshPermSaved,
        refreshAll,
        updateUser,
        vacancyStatsMap,
        responsivenessMap,
        refreshVacancyStats,
        permVacancyViewsMap,
        refreshPermVacancyViews,
        notifications,
        unreadNotifCount,
        refreshNotifications,
        markNotifRead,
        markAllNotifsRead,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
