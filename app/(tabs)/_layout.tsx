import React, { useCallback, useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import {
  Platform, View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomSafe } from '@/lib/androidInsets';
import { StackActions, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { BlurView } from 'expo-blur';
import { Colors } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import NotificationPermissionSheet from '@/components/NotificationPermissionSheet';
import CompleteProfileSheet from '@/components/CompleteProfileSheet';
import EntryTransition from '@/components/EntryTransition';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { setOnboardingTarget, registerOnboardingMeasurer } from '@/lib/onboardingTargets';
import { matchBadgeCount } from '@/services/matchCounts';

import { rs, rf } from '@/constants/scale';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];


// ─── Floating tab bar ───────────────────────────────────────────────────────

interface TabDef {
  route: string;
  iconFilled: IoniconName;
  iconOutline: IoniconName;
  label: string;
  badge?: number;
}

function FloatingTabBar({
  state,
  navigation,
  tabs,
}: {
  state: any;
  navigation: any;
  tabs: TabDef[];
}) {
  const insets = useSafeAreaInsets();
  // На части прошивок insets.bottom приходит нулём, хотя панель кнопок
  // есть — меряем её отдельно, иначе плашка вкладок садится под
  // системные «назад/домой».
  const safeBottom = bottomSafe(insets.bottom);

  // Вкладка «Мэтчи» — цель подсветки в обучении. Меряем по ссылке: первый
  // замер на iOS часто возвращает нули, поэтому оставляем способ перемерить.
  const matchesCellRef = useRef<View>(null);
  const measureMatchesTab = useCallback(() => {
    matchesCellRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setOnboardingTarget('matchesTab', { x, y, w, h });
    });
  }, []);
  useEffect(() => registerOnboardingMeasurer('matchesTab', measureMatchesTab), [measureMatchesTab]);

  return (
    <>
    {/* White background covering safe-area gap under the pill */}
    {safeBottom > 0 && (
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: safeBottom + 13, backgroundColor: '#fff',
      }} />
    )}
    {/* Outer: shadow (overflow:hidden would clip Android elevation) */}
    <View style={[fS.pillShadow, { bottom: safeBottom + 13 }]}>
      {/* Inner: clips blur to rounded shape */}
      <View style={fS.pillClip}>
        {/* Frosted glass background */}
        <BlurView intensity={72} tint="light" style={StyleSheet.absoluteFill} />
        {/* Semi-transparent overlay for contrast on dark content */}
        <View style={fS.pillTint} />

        {/* Вкладки: простое нажатие. Активная выделяется цветом иконки и
            подписи — без плашки-подсветки вокруг кнопки и без плавного
            «переезда» индикатора. */}
        <View style={fS.tabsRow}>
          {tabs.map((tab) => {
            const routeIndex = state.routes.findIndex((r: any) => r.name === tab.route);
            const focused = routeIndex >= 0 && state.index === routeIndex;
            return (
              <TouchableOpacity
                key={tab.route}
                style={fS.tabItem}
                activeOpacity={0.7}
                onPress={() => { if (!focused) navigation.navigate(tab.route); }}
              >
                <View
                  style={fS.tabCell}
                  ref={tab.route === 'matches' ? matchesCellRef : undefined}
                  onLayout={tab.route === 'matches' ? measureMatchesTab : undefined}
                >
                  <View>
                    <Ionicons
                      name={focused ? tab.iconFilled : tab.iconOutline}
                      size={22}
                      color={Colors.primary}
                      style={focused ? undefined : fS.iconIdle}
                    />
                    {tab.badge && tab.badge > 0 ? (
                      <View style={fS.badge}>
                        <Text style={fS.badgeText}>{tab.badge > 9 ? '9+' : tab.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[fS.label, focused && fS.labelActive]}>
                    {tab.label}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
    </>
  );
}

// ─── Layout ─────────────────────────────────────────────────────────────────

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const app = useApp();
  const currentUser = app?.currentUser ?? null;
  const unreadCount = app?.unreadCount ?? 0;
  const likes = app?.likes ?? [];
  const vacancies = app?.vacancies ?? [];
  const permApplications = app?.permApplications ?? [];
  const isWorker = currentUser?.role === 'worker';
  const navigation = useNavigation();
  const splashFrameRef = useRef(0);

  useEffect(() => {
    if (!app?.loading && !currentUser) {
      navigation.dispatch(StackActions.replace('index'));
    }
  }, [app?.loading, currentUser]);

  useEffect(() => {
    // На части Android-устройств hideAsync в первый effect успевает убрать
    // системный splash до того, как EntryTransition отрисовал первый кадр.
    // Два кадра дают React Native завершить layout и исключают белое окно.
    const first = requestAnimationFrame(() => {
      const second = requestAnimationFrame(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
      splashFrameRef.current = second;
    });
    splashFrameRef.current = first;
    return () => cancelAnimationFrame(splashFrameRef.current);
  }, []);

  // ─── Match badge ─────────────────────────────────────────────────────────
  // Считаем тем же кодом, что и вкладки внутри экрана, — см. services/matchCounts.ts.
  const matchBadge = currentUser
    ? matchBadgeCount({
        role: isWorker ? 'worker' : 'employer',
        userId: currentUser.id,
        likes, vacancies, permApplications,
      })
    : 0;

  // Три вкладки, одинаковые для обеих ролей. Смен в сервисе больше нет, а
  // переписка переехала внутрь «Откликов» вторым сегментом: отклик и ответ
  // по нему — одна история, и разводить их по разным вкладкам значило
  // заставлять человека сверять два списка руками.
  //
  // Значок на «Откликах» складывает оба сегмента: непрочитанное сообщение и
  // ждущий ответа отклик одинаково требуют, чтобы человек сюда зашёл.
  const tabs: TabDef[] = [
    { route: 'feed', iconFilled: 'briefcase', iconOutline: 'briefcase-outline', label: 'Вакансии' },
    {
      route: 'matches',
      iconFilled: 'document-text',
      iconOutline: 'document-text-outline',
      label: 'Отклики',
      badge: matchBadge + unreadCount,
    },
    { route: 'profile', iconFilled: 'person', iconOutline: 'person-outline', label: 'Профиль' },
  ];

  // ─── Tab bar height (keeps useBottomTabBarHeight working in screens) ──────
  const tabBarHeight = Platform.select({
    ios: insets.bottom + 64 + 13,
    android: bottomSafe(insets.bottom) + 64 + 13,
    default: 77,
  });

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        initialRouteName="feed"
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            height: tabBarHeight,
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarBackground: () => null,
          tabBarShowLabel: false,
        }}
        tabBar={(props) => (
          <FloatingTabBar
            state={props.state}
            navigation={props.navigation}
            tabs={tabs}
          />
        )}
      >
        <Tabs.Screen name="feed" options={{ tabBarIcon: () => null }} />
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="matches" options={{ tabBarIcon: () => null }} />
        {/* Переписка — экран, а не вкладка: вход из «Откликов». */}
        <Tabs.Screen name="chats" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ tabBarIcon: () => null }} />
      </Tabs>
      <NotificationPermissionSheet />
      <CompleteProfileSheet />
      <EntryTransition />
      <OnboardingOverlay />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const fS = StyleSheet.create({
  // Outer view: carries the shadow (can't use overflow:hidden here on Android)
  pillShadow: {
    position: 'absolute',
    left: rs(16),
    right: rs(16),
    height: rs(64),
    borderRadius: rs(28),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 20,
    elevation: 12,
  },
  // Inner view: clips blur + indicator to pill shape
  pillClip: {
    flex: 1,
    borderRadius: rs(28),
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  pillTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  // Row of tab items
  tabsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: rs(6),
  },
  tabItem: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCell: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: rs(3),
  },
  // Неактивная иконка притушена — так активная читается без плашки-подсветки.
  iconIdle: { opacity: 0.4 },
  label: {
    fontSize: rf(10),
    fontWeight: '600',
    color: Colors.primary,
    opacity: 0.45,
  },
  labelActive: {
    opacity: 1,
  },
  badge: {
    position: 'absolute',
    top: rs(-4),
    right: rs(-8),
    backgroundColor: Colors.primary,
    borderRadius: rs(100),
    minWidth: rs(16),
    height: rs(16),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: rs(3),
  },
  badgeText: { color: '#fff', fontSize: rf(9), fontWeight: '700' },
});