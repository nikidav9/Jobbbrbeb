import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder,
  Dimensions, Platform, Easing, Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOnboardingDone, onOnboardingDone } from '@/components/OnboardingOverlay';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomSafe } from '@/lib/androidInsets';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { Colors, Radius } from '@/constants/theme';
import { registerForPushNotifications } from '@/services/notifications';
import { registerWebPush, getWebPushDebug } from '@/lib/webPush';
import { useApp } from '@/hooks/useApp';
import { LEGAL_DOCS, needsReconsent } from '@/constants/legal';

import { rs, rf } from '@/constants/scale';

export const NOTIFICATION_CHOICE_KEY = 'jm_notif_prompt_choice'; // 'enabled' once notifications are on
const CHOICE_KEY = NOTIFICATION_CHOICE_KEY;
const SCREEN_H = Dimensions.get('window').height;
const SHOW_DELAY_MS = 1200;
const ENABLE_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

export default function NotificationPermissionSheet() {
  const insets = useSafeAreaInsets();
  const app = useApp();
  // Гостю — ничего: он не зарегистрирован, подписывать на пуши некого.
  const userId = app?.currentUser?.isGuest ? null : (app?.currentUser?.id ?? null);

  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const slideY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const sheetHeightRef = useRef(480);

  // ─── Decide whether to show ────────────────────────────────────────────────
  // The sheet appears on EVERY entry until notifications are actually enabled.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let unsubOnboarding: (() => void) | null = null;

    (async () => {
      try {
        const choice = await AsyncStorage.getItem(CHOICE_KEY);
        if (choice === 'enabled') return;

        if (Platform.OS === 'web') {
          // Browser Notification API: skip if unsupported or already resolved
          if (typeof Notification === 'undefined') return;
          if (Notification.permission === 'granted') {
            // Permission is on — finish the web push subscription silently
            const ok = await registerWebPush(userId).catch(() => false);
            if (ok) { await AsyncStorage.setItem(CHOICE_KEY, 'enabled'); return; }
            // Subscription incomplete — show the sheet so the user can retry
          } else if (Notification.permission === 'denied') {
            return; // browser-level deny can't be fixed from JS
          }
        } else {
          const { status } = await Notifications.getPermissionsAsync();
          if (status === 'granted') {
            // Разрешение ОС само по себе ещё не означает работающий push:
            // токен должен реально получиться и сохраниться на сервере.
            const ok = await withTimeout(registerForPushNotifications(userId), ENABLE_TIMEOUT_MS).catch(() => false);
            if (ok) {
              await AsyncStorage.setItem(CHOICE_KEY, 'enabled');
              return;
            }
            // Токен не зарегистрировался — показываем лист и даём повторить.
          }
          // iOS: after a hard OS-level deny the dialog can't be re-shown — stop nagging
          if (status === 'denied' && Platform.OS === 'ios') {
            const { canAskAgain } = await Notifications.getPermissionsAsync();
            if (!canAskAgain) return;
          }
        }

        // Обучение и это окно раньше показывались одновременно и наезжали
        // друг на друга при первом входе. Ждём, пока человек пройдёт или
        // пропустит обучение, и только потом предлагаем уведомления.
        const show = () => setTimeout(() => { if (!cancelled) open(); }, SHOW_DELAY_MS);
        if (await isOnboardingDone(userId)) { show(); return; }
        unsubOnboarding = onOnboardingDone(() => { if (!cancelled) show(); });
      } catch {}
    })();

    return () => { cancelled = true; unsubOnboarding?.(); };
  }, [userId]);

  // ─── Open / close animations ───────────────────────────────────────────────
  function open() {
    setVisible(true);
    dragY.setValue(0);
    slideY.setValue(SCREEN_H);
    backdrop.setValue(0);
    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 1, duration: 260, useNativeDriver: true,
      }),
      Animated.spring(slideY, {
        toValue: 0, tension: 60, friction: 12, useNativeDriver: true,
      }),
    ]).start();
  }

  function close(after?: () => void) {
    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 0, duration: 200, useNativeDriver: true,
      }),
      Animated.timing(slideY, {
        toValue: SCREEN_H, duration: 260,
        easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
      after?.();
    });
  }

  // ─── Swipe down to dismiss ─────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > sheetHeightRef.current * 0.25 || g.vy > 0.9) {
          // Swipe away = same as X: show again next launch
          Animated.timing(dragY, {
            toValue: SCREEN_H, duration: 220,
            easing: Easing.in(Easing.cubic), useNativeDriver: true,
          }).start(() => setVisible(false));
          Animated.timing(backdrop, { toValue: 0, duration: 220, useNativeDriver: true }).start();
        } else {
          Animated.spring(dragY, { toValue: 0, tension: 120, friction: 14, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  // ─── Actions ───────────────────────────────────────────────────────────────
  // X / «Не сейчас» / swipe just close the sheet — it returns on the next entry
  // until notifications are actually enabled.
  const handleClose = () => close();
  const handleSkip = () => close();

  const handleEnable = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      if (Platform.OS === 'web') {
        const ok = userId ? await withTimeout(registerWebPush(userId), ENABLE_TIMEOUT_MS) : false;
        if (ok) {
          await AsyncStorage.setItem(CHOICE_KEY, 'enabled');
          close();
        } else {
          // Stay open and explain instead of spinning forever
          setErrorMsg(getWebPushDebug() || 'Не получилось включить. Попробуйте ещё раз.');
        }
      } else {
        const { status } = await withTimeout(Notifications.requestPermissionsAsync(), ENABLE_TIMEOUT_MS);
        if (status === 'granted') {
          const ok = userId
            ? await withTimeout(registerForPushNotifications(userId), ENABLE_TIMEOUT_MS)
            : false;
          if (ok) {
            await AsyncStorage.setItem(CHOICE_KEY, 'enabled');
            close();
          } else {
            setErrorMsg('Разрешение получено, но push-токен не зарегистрировался. Проверьте связь и попробуйте ещё раз.');
          }
        } else {
          // Пользователь отказал на уровне ОС. Не выдаём это за включённые
          // уведомления; лист просто закроется и сможет появиться позже.
          close();
        }
      }
    } catch {
      setErrorMsg('Не получилось включить (нет ответа). Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View style={[st.backdrop, { opacity: backdrop }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          st.sheet,
          // На Android панель кнопок иногда не попадает в insets — меряем сами
          { paddingBottom: bottomSafe(insets.bottom) + 16 },
          { transform: [{ translateY: Animated.add(slideY, dragY) }] },
        ]}
        onLayout={e => { sheetHeightRef.current = e.nativeEvent.layout.height; }}
        {...panResponder.panHandlers}
      >
        {/* Grabber */}
        <View style={st.grabber} />

        {/* Close */}
        <TouchableOpacity style={st.closeBtn} onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>

        <Text style={st.title}>Будьте в курсе</Text>
        <Text style={st.subtitle}>
          Включите уведомления, чтобы не пропустить важное — отклики, мэтчи и новые вакансии
        </Text>

        {/* Mock push preview */}
        <View style={st.pushCard}>
          <Image source={require('@/assets/images/jt-logo.png')} style={st.pushIcon} resizeMode="cover" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={st.pushTopRow}>
              <Text style={st.pushApp}>JobToo</Text>
              <Text style={st.pushNow}>сейчас</Text>
            </View>
            <Text style={st.pushTitle}>Мэтч! Вас хотят взять 🎉</Text>
            <Text style={st.pushBody} numberOfLines={1}>Кладовщик — м. Хорошёво, 95 000 ₽/мес…</Text>
          </View>
        </View>

        {/* Reasons */}
        <View style={st.reasons}>
          <Reason icon="notifications-outline" text="Мгновенно узнавайте о сообщениях и мэтчах" />
          <Reason icon="briefcase-outline" text="Получайте новые вакансии рядом с вами" />
          <Reason icon="checkmark-circle-outline" text="Не пропустите подтверждение смены" />
        </View>

        {/* Buttons */}
        <TouchableOpacity style={st.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
          <Text style={st.skipText}>Не сейчас</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.enableBtn, busy && { opacity: 0.55 }]}
          onPress={handleEnable}
          activeOpacity={0.85}
          disabled={busy}
        >
          <Text style={st.enableText}>{busy ? 'Подключаем…' : errorMsg ? 'Попробовать ещё раз' : 'Включить уведомления'}</Text>
        </TouchableOpacity>
        {errorMsg ? <Text style={st.errorText}>{errorMsg}</Text> : null}
      </Animated.View>
    </View>
  );
}

function Reason({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={st.reasonRow}>
      <View style={st.reasonIcon}>
        <Ionicons name={icon} size={17} color={Colors.primary} />
      </View>
      <Text style={st.reasonText}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,17,17,0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: rs(24),
    borderTopRightRadius: rs(24),
    paddingHorizontal: rs(20),
    paddingTop: rs(10),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 20,
  },
  grabber: {
    alignSelf: 'center',
    width: rs(40), height: rs(4),
    borderRadius: rs(2),
    backgroundColor: '#E5E7EB',
    marginBottom: rs(14),
  },
  closeBtn: {
    position: 'absolute',
    top: rs(18), left: rs(20),
    width: rs(30), height: rs(30),
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 2,
  },
  title: {
    fontSize: rf(24),
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: rs(26),
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: rf(14.5),
    lineHeight: rf(20),
    color: Colors.textSecondary,
    marginTop: rs(6),
    marginBottom: rs(16),
  },
  pushCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(10),
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: Radius.lg,
    padding: rs(12),
    marginBottom: rs(18),
  },
  pushIcon: {
    width: rs(38), height: rs(38),
    borderRadius: rs(9),
  },
  pushTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pushApp: { color: 'rgba(255,255,255,0.55)', fontSize: rf(11.5), fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  pushNow: { color: 'rgba(255,255,255,0.4)', fontSize: rf(11.5) },
  pushTitle: { color: '#fff', fontSize: rf(13.5), fontWeight: '700', marginTop: rs(1) },
  pushBody: { color: 'rgba(255,255,255,0.75)', fontSize: rf(12.5), marginTop: rs(1) },
  reasons: { gap: rs(12), marginBottom: rs(22) },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: rs(12) },
  reasonIcon: {
    width: rs(32), height: rs(32),
    borderRadius: rs(16),
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonText: { flex: 1, fontSize: rf(14), lineHeight: rf(19), color: Colors.textPrimary, fontWeight: '500' },
  consentRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(10),
    padding: rs(12), marginBottom: rs(8), borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  checkbox: {
    width: rs(22), height: rs(22), borderRadius: rs(6), borderWidth: 1.5,
    borderColor: Colors.inputBorder, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkmark: { color: '#fff', fontSize: rf(13), fontWeight: '800' },
  consentText: { flex: 1, fontSize: rf(12.5), lineHeight: rf(18), color: Colors.textSecondary },
  consentLink: { color: Colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: rs(10),
    paddingHorizontal: rs(20),
    marginBottom: rs(2),
  },
  skipText: { fontSize: rf(15), fontWeight: '600', color: Colors.textSecondary },
  enableBtn: {
    height: rs(52),
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enableText: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
  errorText: {
    marginTop: rs(8),
    fontSize: rf(12.5),
    lineHeight: rf(17),
    color: Colors.red,
    textAlign: 'center',
  },
});
