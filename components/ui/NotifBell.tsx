import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ScrollView, ActivityIndicator, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { routeForNotification, routeByTitle } from '@/services/notificationRoute';
import { Colors } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { APP_HEADER_CONTROL } from '@/components/ui/BrandLogo';
import { SheetHandle, useSwipeToDismiss } from '@/components/ui/Sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  dbGetNotifications, dbMarkNotifRead, dbMarkAllNotifsRead,
  dbDeleteNotif, dbDeleteAllNotifs,
} from '@/services/db';

interface Notif {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  /** Вид уведомления — по нему открываем нужный экран (может отсутствовать
   *  у записей, созданных до появления колонки) */
  type?: string | null;
  payload?: { chatId?: string } | null;
}

export function NotifBell() {
  const app = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const count = app?.unreadNotifCount ?? 0;
  const userId = app?.currentUser?.id ?? null;

  const fetchNotifs = useCallback(async (uid: string) => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const rows = await dbGetNotifications(uid);
      setNotifs(rows.map((n: any) => ({
        id: n.id, title: n.title, body: n.body,
        isRead: n.is_read, createdAt: n.created_at,
        type: n.type ?? null,
        // payload приходит объектом (jsonb) либо строкой — принимаем оба вида
        payload: typeof n.payload === 'string'
          ? (() => { try { return JSON.parse(n.payload); } catch { return null; } })()
          : (n.payload ?? null),
      })));
      app?.refreshNotifications?.();
    } catch {
      // Уже загруженный список оставляем на экране, но явно помечаем его как
      // не обновившийся. Пустой локальный массив при обрыве — не «уведомлений нет».
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [app]);

  function handleOpen() {
    if (!userId) return;
    setOpen(true);
    fetchNotifs(userId);
  }

  async function handleMarkAll() {
    if (!userId) return;
    try {
      // Один серверный запрос — через контекст, чтобы локальный список и
      // глобальный badge переходили в read после одного и того же commit.
      const op = app?.markAllNotifsRead
        ? app.markAllNotifsRead()
        : dbMarkAllNotifsRead(userId);
      await op;
      setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch {
      app?.showToast?.('Не удалось отметить уведомления прочитанными', 'error');
    }
  }

  /** Чат с этим человеком — для старых уведомлений «💬 Имя», у которых
   *  не сохранён chatId. Имя берём из заголовка. */
  function chatIdByPersonName(title: string): string | undefined {
    const name = title.replace(/^💬\s*/, '').trim();
    if (!name) return undefined;
    const me = app?.currentUser;
    const chats = app?.chats ?? [];
    const users = app?.users ?? [];
    const match = chats.find((c: any) => {
      const otherId = me?.role === 'worker' ? c.employerId : c.workerId;
      const u = users.find((x: any) => x.id === otherId);
      return u && `${u.firstName} ${u.lastName}`.trim() === name;
    });
    return match?.id;
  }

  async function handleTap(n: Notif) {
    // Навигацию не задерживаем запросом «прочитано», но и не оставляем локальный
    // счётчик в ложном состоянии, если сервер запись не принял.
    if (!n.isRead) {
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      // Навигацию не ждём, но серверный write теперь ровно один. Контекст
      // обновит глобальный badge только после успеха; при отказе локальный
      // optimistic state откатываем.
      const markPromise = app?.markNotifRead
        ? app.markNotifRead(n.id)
        : dbMarkNotifRead(n.id);
      void markPromise.catch(() => {
        setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: false } : x));
        void app?.refreshNotifications?.();
      });
    }

    // Уведомление — это ссылка: открываем экран, о котором оно говорит
    let target = routeForNotification(n.type, n.payload);
    if (!target || (target.pathname === '/(tabs)/chats' && n.title.startsWith('💬'))) {
      const chatId = n.payload?.chatId ?? chatIdByPersonName(n.title);
      if (chatId) target = { pathname: '/chat-room', params: { chatId } };
    }
    if (!target) target = routeByTitle(n.title);
    if (!target) return;

    setOpen(false);
    router.push(target as never);
  }

  async function handleDelete(id: string) {
    try {
      await dbDeleteNotif(id);
      setNotifs(prev => prev.filter(n => n.id !== id));
      app?.refreshNotifications?.();
    } catch {
      app?.showToast?.('Не удалось удалить уведомление', 'error');
    }
  }

  async function handleDeleteAll() {
    if (!userId) return;
    if (!confirmDeleteAll) { setConfirmDeleteAll(true); return; }
    setConfirmDeleteAll(false);
    try {
      await dbDeleteAllNotifs(userId);
      setNotifs([]);
      app?.refreshNotifications?.();
    } catch {
      app?.showToast?.('Не удалось удалить уведомления', 'error');
    }
  }

  const unread = notifs.filter(n => !n.isRead).length;
  const badge = open ? unread : count;

  const insets = useSafeAreaInsets();
  const swipe = useSwipeToDismiss(() => setOpen(false), open);

  return (
    <>
      <TouchableOpacity onPress={handleOpen} style={s.btn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="notifications-outline" size={22} color={Colors.textPrimary} />
        {badge > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeTxt}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal statusBarTranslucent navigationBarTranslucent visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          {/* Тап по затемнению тоже закрывает — смахивание не единственный выход */}
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setOpen(false)} />
          <Animated.View style={[s.sheet, { paddingBottom: insets.bottom }, swipe.animStyle]}>
            {/* Тянуть можно за всю шапку, не только за саму полоску: попасть
                в полоску пальцем на ходу трудно. Крестика больше нет — он
                жался к самому краю экрана и налезал на кнопки. */}
            <View {...swipe.panHandlers}>
              <SheetHandle />
              <View style={s.header}>
                <Text style={s.title}>Уведомления</Text>
              </View>
              {(notifs.length > 0 || notifs.some(n => !n.isRead)) && (
                <View style={s.actions}>
                  {notifs.length > 0 && (
                    confirmDeleteAll ? (
                      <>
                        <TouchableOpacity onPress={handleDeleteAll} style={s.deleteAllBtn}>
                          <Text style={s.deleteAllTxt}>Подтвердить</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setConfirmDeleteAll(false)} style={s.cancelBtn}>
                          <Text style={s.cancelTxt}>Отмена</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity onPress={handleDeleteAll} style={s.deleteAllBtn}>
                        <Text style={s.deleteAllTxt}>Удалить все</Text>
                      </TouchableOpacity>
                    )
                  )}
                  {notifs.some(n => !n.isRead) && (
                    <TouchableOpacity onPress={handleMarkAll} style={s.markAllBtn}>
                      <Text style={s.markAllTxt}>Прочитать все</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {!loading && loadFailed && notifs.length > 0 ? (
              <View style={{ paddingHorizontal: rs(20), paddingVertical: rs(10), backgroundColor: Colors.surface, gap: rs(4) }}>
                <Text style={{ color: Colors.textPrimary, fontWeight: '700', textAlign: 'center', fontSize: rf(12.5) }}>
                  Не удалось обновить уведомления
                </Text>
                <TouchableOpacity onPress={() => userId && void fetchNotifs(userId)} activeOpacity={0.8}>
                  <Text style={{ color: Colors.primary, fontWeight: '700', textAlign: 'center', fontSize: rf(12.5) }}>Повторить</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <ScrollView contentContainerStyle={s.list}>
              {loading ? (
                <View style={s.empty}>
                  <ActivityIndicator color={Colors.primary} size="large" />
                </View>
              ) : loadFailed && notifs.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="cloud-offline-outline" size={52} color={Colors.textMuted} style={{ marginBottom: 16 }} />
                  <Text style={s.emptyTitle}>Не удалось загрузить уведомления</Text>
                  <Text style={s.emptySub}>Проверьте связь и попробуйте ещё раз.</Text>
                  <TouchableOpacity onPress={() => userId && void fetchNotifs(userId)} activeOpacity={0.8} style={{ marginTop: rs(12) }}>
                    <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: rf(14) }}>Повторить</Text>
                  </TouchableOpacity>
                </View>
              ) : notifs.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="notifications-outline" size={56} color={Colors.textMuted} style={{ marginBottom: 16 }} />
                  <Text style={s.emptyTitle}>Нет уведомлений</Text>
                  <Text style={s.emptySub}>Здесь будут появляться важные уведомления</Text>
                </View>
              ) : (
                notifs.map(n => (
                  <View key={n.id} style={[s.item, !n.isRead && s.itemUnread]}>
                    <TouchableOpacity
                      onPress={() => handleTap(n)}
                      activeOpacity={0.7}
                      style={s.itemContent}
                    >
                      <View style={s.itemDot}>
                        {!n.isRead && <View style={s.dot} />}
                      </View>
                      <View style={s.itemBody}>
                        <Text style={[s.itemTitle, !n.isRead && s.itemTitleBold]}>{n.title}</Text>
                        <Text style={s.itemText}>{n.body}</Text>
                        <Text style={s.itemTime}>
                          {new Date(n.createdAt).toLocaleString('ru', {
                            day: '2-digit', month: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </Text>
                      </View>
                      {/* Стрелка — знак того, что уведомление открывается */}
                      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} style={{ alignSelf: 'center' }} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(n.id)} style={s.deleteBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: {
    position: 'relative',
    width: rs(APP_HEADER_CONTROL),
    height: rs(APP_HEADER_CONTROL),
    borderRadius: rs(APP_HEADER_CONTROL / 2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute', top: 0, right: 0,
    backgroundColor: Colors.primary, borderRadius: rs(10),
    minWidth: rs(16), height: rs(16), alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(3),
  },
  badgeTxt: { color: '#fff', fontSize: rf(9), fontWeight: '700' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  // Не во весь экран: сверху видно затемнение, и сразу понятно, что окно
  // временное и его можно закрыть.
  sheet: {
    maxHeight: '92%', backgroundColor: Colors.bg,
    borderTopLeftRadius: rs(20), borderTopRightRadius: rs(20),
  },
  header: { paddingHorizontal: rs(20), paddingTop: rs(2), paddingBottom: rs(10) },
  title: { fontSize: rf(18), fontWeight: '700', color: Colors.textPrimary },
  // Кнопки — отдельной строкой. В одну строку с заголовком они не помещались:
  // «Прочитать все» упиралось в край экрана.
  actions: {
    flexDirection: 'row', flexWrap: 'wrap', gap: rs(8),
    paddingHorizontal: rs(20), paddingBottom: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  deleteAllBtn: { paddingVertical: rs(4), paddingHorizontal: rs(8), borderRadius: rs(8), backgroundColor: '#FEE2E2' },
  deleteAllTxt: { fontSize: rf(12), fontWeight: '600', color: '#DC2626' },
  cancelBtn: { paddingVertical: rs(4), paddingHorizontal: rs(8), borderRadius: rs(8), backgroundColor: Colors.divider },
  cancelTxt: { fontSize: rf(12), fontWeight: '600', color: Colors.textSecondary },
  markAllBtn: { paddingVertical: rs(4), paddingHorizontal: rs(8), borderRadius: rs(8), backgroundColor: Colors.primaryLight },
  markAllTxt: { fontSize: rf(12), fontWeight: '600', color: Colors.primary },

  list: { paddingVertical: rs(8) },

  empty: { alignItems: 'center', paddingTop: rs(80), paddingHorizontal: rs(32) },
  emptyIcon: { fontSize: rf(48), marginBottom: rs(16) },
  emptyTitle: { fontSize: rf(17), fontWeight: '600', color: Colors.textPrimary, marginBottom: rs(8) },
  emptySub: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', lineHeight: rf(20) },

  item: {
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: rs(20), paddingRight: rs(12), paddingVertical: rs(14),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
    backgroundColor: Colors.bg,
  },
  itemUnread: { backgroundColor: '#FFF8F5' },
  itemContent: { flex: 1, flexDirection: 'row' },
  itemDot: { width: rs(20), alignItems: 'center', paddingTop: rs(5) },
  dot: { width: rs(8), height: rs(8), borderRadius: rs(4), backgroundColor: Colors.primary },
  itemBody: { flex: 1 },
  itemTitle: { fontSize: rf(14), color: Colors.textPrimary, marginBottom: rs(3) },
  itemTitleBold: { fontWeight: '600' },
  itemText: { fontSize: rf(13), color: Colors.textSecondary, lineHeight: rf(18), marginBottom: rs(5) },
  itemTime: { fontSize: rf(11), color: Colors.textMuted },
  deleteBtn: { padding: rs(6), marginLeft: rs(8) },
});
