import React, { useEffect, useRef } from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import {
  Platform, View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomSafe } from '@/lib/androidInsets';
import { StackActions, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import NotificationPermissionSheet from '@/components/NotificationPermissionSheet';
import CompleteProfileSheet from '@/components/CompleteProfileSheet';
import EntryTransition from '@/components/EntryTransition';
import { OnboardingTarget } from '@/components/OnboardingTarget';
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
  activeRoute,
  onTabPress,
  tabs,
}: {
  activeRoute: string;
  onTabPress: (route: string) => void;
  tabs: TabDef[];
}) {
  const insets = useSafeAreaInsets();
  // На части прошивок insets.bottom приходит нулём, хотя панель кнопок
  // есть — меряем её отдельно, иначе плашка вкладок садится под
  // системные «назад/домой».
  const safeBottom = bottomSafe(insets.bottom);
  // Fade the scrolled page under the floating bar, rather than inserting an
  // opaque dock. Each tab fades into its own background (orange / white / gray).
  const fadeColors: [string, string, string] = activeRoute === 'feed'
    ? ['rgba(255,212,181,0)', 'rgba(255,212,181,0.30)', 'rgba(255,212,181,0.88)']
    : activeRoute === 'profile'
      ? ['rgba(245,245,245,0)', 'rgba(241,241,241,0.32)', 'rgba(245,245,245,0.88)']
      : ['rgba(255,255,255,0)', 'rgba(248,248,248,0.30)', 'rgba(255,255,255,0.88)'];

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        pointerEvents="none"
        colors={fadeColors}
        locations={[0, 0.45, 1]}
        style={[fS.bottomFade, { height: safeBottom + rs(145) }]}
      />
      {/* Shadow sits on top of the fade. The page stays visible behind both. */}
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
            const focused = activeRoute === tab.route;
            return (
              <TouchableOpacity
                key={tab.route}
                style={fS.tabItem}
                activeOpacity={0.7}
                onPress={() => { if (!focused) onTabPress(tab.route); }}
              >
                <OnboardingTarget
                  targetKey={`tab.${tab.route}`}
                  style={fS.tabCell}
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
                </OnboardingTarget>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
    </View>
  );
}

// ─── Layout ─────────────────────────────────────────────────────────────────

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const lastSegment = pathname.split('/').filter(Boolean).pop();
  const activeRoute = lastSegment === 'profile' || lastSegment === 'matches' || lastSegment === 'feed'
    ? lastSegment
    : lastSegment === 'chats' ? 'matches' : 'feed';
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

  const onTabPress = (route: string) => {
    if (route === 'feed') router.navigate('/(tabs)/feed');
    else if (route === 'matches') router.navigate('/(tabs)/matches');
    else if (route === 'profile') router.navigate('/(tabs)/profile');
  };

  return (
    <View style={{
      flex: 1,
      backgroundColor: activeRoute === 'feed'
        ? Colors.bgWarm
        : activeRoute === 'profile' ? Colors.outerBg : Colors.bg,
    }}>
      <Tabs
        initialRouteName="feed"
        screenOptions={{
          headerShown: false,
          // The real bar is a sibling overlay below. Keep this height only
          // for useBottomTabBarHeight() so scrollable screens leave enough
          // trailing space to reveal their final items above the bar.
          tabBarStyle: {
            position: 'absolute',
            height: tabBarHeight,
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarBackground: () => null,
          tabBarShowLabel: false,
        }}
        // Rendering no bar here makes the navigator's scenes fill the whole
        // viewport. A custom bar inside Tabs still reserved the iOS bottom
        // safe-area strip, abruptly clipping cards and text above the edge.
        tabBar={() => null}
      >
        <Tabs.Screen name="feed" options={{ tabBarIcon: () => null }} />
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="matches" options={{ tabBarIcon: () => null }} />
        {/* Переписка — экран, а не вкладка: вход из «Откликов». */}
        <Tabs.Screen name="chats" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ tabBarIcon: () => null }} />
      </Tabs>
      <FloatingTabBar activeRoute={activeRoute} onTabPress={onTabPress} tabs={tabs} />
      <NotificationPermissionSheet />
      <CompleteProfileSheet />
      <EntryTransition />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const fS = StyleSheet.create({
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
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
