import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder,
  Dimensions, Platform, Easing, Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOnboardingDone, onOnboardingDone } from '@/components/OnboardingOverlay';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomSafe } from '@/lib/androidInsets';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { JT, JT_FONT } from '@/constants/jt';
import { JTButton, JT_ERROR } from '@/components/ui/jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { registerForPushNotifications } from '@/services/notifications';
import { registerWebPush, getWebPushDebug } from '@/lib/webPush';
import { useApp } from '@/hooks/useApp';

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
        <TouchableOpacity
          style={st.closeBtn}
          onPress={handleClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
        >
          <Ionicons name="close" size={rs(20)} color={JT.ink} />
        </TouchableOpacity>

        <Text style={st.title}>Будьте в курсе</Text>
        <Text style={st.subtitle}>
          Включите уведомления, чтобы не пропустить важное — ответы работодателей, мэтчи и новые вакансии
        </Text>

        {/* Как будет выглядеть уведомление */}
        <HardShadowBox offset={4} radius={rs(18)} shadowColor={JT.ink} style={st.pushBox}>
          <View style={st.pushCard}>
            <Image source={require('@/assets/images/jt-logo.png')} style={st.pushIcon} resizeMode="cover" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={st.pushTopRow}>
                <Text style={st.pushApp}>JobToo</Text>
                <Text style={st.pushNow}>сейчас</Text>
              </View>
              <Text style={st.pushTitle}>Мэтч! Вас хотят взять </Text>
              <Text style={st.pushBody} numberOfLines={1}>Frontend-разработчик, от 250 000 ₽</Text>
            </View>
          </View>
        </HardShadowBox>

        {/* Reasons */}
        <View style={st.reasons}>
          <Reason icon="chatbubble-ellipses-outline" text="Мгновенно узнавайте о сообщениях и мэтчах" />
          <Reason icon="briefcase-outline" text="Первыми получайте новые вакансии по вашему стеку" />
          <Reason icon="mail-unread-outline" text="Не пропустите ответ работодателя на отклик" />
        </View>

        {/* Buttons */}
        <JTButton
          label={errorMsg ? 'Попробовать ещё раз' : 'Включить уведомления'}
          onPress={handleEnable}
          busy={busy}
          arrow={false}
        />
        {errorMsg ? <Text style={st.errorText}>{errorMsg}</Text> : null}
        <TouchableOpacity style={st.skipBtn} onPress={handleSkip} activeOpacity={0.7} accessibilityRole="button">
          <Text style={st.skipText}>Не сейчас</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function Reason({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={st.reasonRow}>
      <View style={st.reasonIcon}>
        <Ionicons name={icon} size={rs(17)} color={JT.ink} />
      </View>
      <Text style={st.reasonText}>{text}</Text>
    </View>
  );
}

// Стиль JT (30.09.2026): кремовый лист с контуром, Unbounded в заголовке,
// карточка-наклейка с жёсткой тенью и оранжевая кнопка JTButton. На широком
// экране лист не растягивается во всю ширину окна.
const st = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,20,20,0.5)',
  },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    width: '100%', maxWidth: 560, alignSelf: 'center', marginHorizontal: 'auto',
    backgroundColor: JT.background,
    borderTopLeftRadius: rs(28),
    borderTopRightRadius: rs(28),
    borderWidth: 2, borderBottomWidth: 0, borderColor: JT.ink,
    paddingHorizontal: rs(20),
    paddingTop: rs(10),
  },
  grabber: {
    alignSelf: 'center',
    width: rs(44), height: rs(5),
    borderRadius: rs(3),
    backgroundColor: JT.borderSoft,
    marginBottom: rs(10),
  },
  closeBtn: {
    position: 'absolute',
    top: rs(16), right: rs(16),
    width: rs(38), height: rs(38), borderRadius: rs(19),
    backgroundColor: JT.surface, borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  title: {
    fontFamily: JT_FONT.head,
    fontSize: rf(22),
    lineHeight: rf(28),
    color: JT.ink,
    marginTop: rs(22),
    marginRight: rs(48),
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: JT_FONT.medium,
    fontSize: rf(14.5),
    lineHeight: rf(21),
    color: JT.textSecondary,
    marginTop: rs(8),
    marginBottom: rs(18),
  },
  pushBox: { marginBottom: rs(22), marginRight: rs(4) },
  pushCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(12),
    backgroundColor: JT.surface,
    borderRadius: rs(18), borderWidth: 2, borderColor: JT.ink,
    padding: rs(12),
  },
  pushIcon: {
    width: rs(40), height: rs(40),
    borderRadius: rs(10),
  },
  pushTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pushApp: { fontFamily: JT_FONT.heavy, color: JT.textTertiary, fontSize: rf(11), textTransform: 'uppercase', letterSpacing: 0.4 },
  pushNow: { fontFamily: JT_FONT.medium, color: JT.textTertiary, fontSize: rf(11.5) },
  pushTitle: { fontFamily: JT_FONT.heavy, color: JT.ink, fontSize: rf(14), marginTop: rs(2) },
  pushBody: { fontFamily: JT_FONT.medium, color: JT.textBody, fontSize: rf(13), marginTop: rs(1) },
  reasons: { gap: rs(12), marginBottom: rs(24) },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: rs(12) },
  reasonIcon: {
    width: rs(34), height: rs(34),
    borderRadius: rs(17),
    backgroundColor: JT.accentSoft, borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonText: { flex: 1, fontFamily: JT_FONT.bold, fontSize: rf(14.5), lineHeight: rf(20), color: JT.ink },
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: rs(12),
    paddingHorizontal: rs(20),
    marginTop: rs(4),
  },
  skipText: { fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.textTertiary },
  errorText: {
    marginTop: rs(10),
    fontFamily: JT_FONT.bold,
    fontSize: rf(12.5),
    lineHeight: rf(17),
    color: JT_ERROR,
    textAlign: 'center',
  },
});
