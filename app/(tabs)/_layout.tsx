import React, { useEffect, useRef } from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomSafe } from '@/lib/androidInsets';
import { StackActions, useNavigation } from 'expo-router/react-navigation';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/theme';
import { JT, JT_FONT } from '@/constants/jt';
import { useApp } from '@/hooks/useApp';
import NotificationPermissionSheet from '@/components/NotificationPermissionSheet';
import CompleteProfileSheet from '@/components/CompleteProfileSheet';
import EntryTransition from '@/components/EntryTransition';
import { matchBadgeCount } from '@/services/matchCounts';

import { rs, rf } from '@/constants/scale';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Размеры нижнего меню — макет JT-design: высота 64, скругление 32, по бокам 20.
const FLOATING_TAB_HEIGHT = rs(64);
const FLOATING_TAB_SIDE = rs(20);
const FLOATING_TAB_RADIUS = rs(32);
const FLOATING_TAB_SAFE_OVERLAP = rs(13);
const FLOATING_TAB_MIN_BOTTOM = rs(8);

function floatingTabBottom(safeBottom: number): number {
  // Android: плашка стоит строго над системной панелью («назад/домой/меню»),
  // а не заезжает в неё. Нахлёст — приём макета для полоски iOS; панель
  // кнопок Android он перекрывал, и человек попадал мимо.
  if (Platform.OS === 'android') return Math.max(FLOATING_TAB_MIN_BOTTOM, safeBottom + FLOATING_TAB_MIN_BOTTOM);
  // The reference bar sits partly inside the iOS home-indicator safe area.
  // We keep an 8pt floor for gesture-only / web layouts and move the pill
  // down by ~13pt relative to the safe-area boundary.
  return Math.max(FLOATING_TAB_MIN_BOTTOM, safeBottom - FLOATING_TAB_SAFE_OVERLAP);
}


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
  surfaceRoute,
  onTabPress,
  tabs,
}: {
  activeRoute: string;
  surfaceRoute: string;
  onTabPress: (route: string) => void;
  tabs: TabDef[];
}) {
  const insets = useSafeAreaInsets();
  // На части прошивок insets.bottom приходит нулём, хотя панель кнопок
  // есть — меряем её отдельно, иначе плашка вкладок садится под
  // системные «назад/домой».
  const safeBottom = bottomSafe(insets.bottom);
  const tabBottom = floatingTabBottom(safeBottom);
  // Fade the scrolled page under the floating bar, rather than inserting an
  // opaque dock. Each tab fades into its own background (orange / white / gray).
  const fadeColors: [string, string, string] = surfaceRoute === 'feed'
    ? ['rgba(245,239,230,0)', 'rgba(245,239,230,0.40)', 'rgba(245,239,230,0.92)']
    : surfaceRoute === 'profile' || surfaceRoute === 'company'
      ? ['rgba(245,245,245,0)', 'rgba(245,245,245,0.12)', 'rgba(245,245,245,0.48)']
      : ['rgba(255,255,255,0)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.45)'];

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        pointerEvents="none"
        colors={fadeColors}
        locations={[0, 0.42, 1]}
        // Keep the scrim local to the bar. It softens the content like the
        // reference, but stays translucent enough for text/cards to remain
        // visible all the way through the iOS home-indicator area.
        style={[fS.bottomFade, { height: tabBottom + FLOATING_TAB_HEIGHT + rs(36) }]}
      />
      {/* Нижнее меню по макету JT-design: чёрная «таблетка», активный раздел —
          оранжевая пилюля с чёрным текстом, остальные — белым. Оранжевая точка
          у раздела — там есть обновления (число — в подписи для чтения экрана). */}
      <View style={[fS.pill, { bottom: tabBottom }]}>
        <View style={fS.tabsRow}>
          {tabs.map((tab) => {
            const focused = activeRoute === tab.route;
            const hasBadge = !!tab.badge && tab.badge > 0;
            return (
              <TouchableOpacity
                key={tab.route}
                style={fS.tabItem}
                activeOpacity={0.7}
                onPress={() => { if (!focused) onTabPress(tab.route); }}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={hasBadge ? `${tab.label}, новых: ${tab.badge}` : tab.label}
              >
                {/* collapsable={false}: у плашки есть фон и скругление, и Android
                    (Fabric) схлопывает такой View, рисуя оранжевый прямоугольник без
                    скруглений поверх меню. Раньше это держала обёртка тура. */}
                <View collapsable={false} style={[fS.tabCell, focused && fS.tabCellActive]}>
                  <Ionicons
                    name={focused ? tab.iconFilled : tab.iconOutline}
                    size={rs(18)}
                    color={focused ? JT.ink : JT.surface}
                  />
                  <Text
                    style={[fS.label, focused && fS.labelActive]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {tab.label}
                  </Text>
                  {hasBadge ? <View style={fS.badgeDot} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
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
  // Company profile is opened from the vacancy feed, so the Vacancies tab stays
  // selected, while its surface/fade is neutral gray rather than feed orange.
  const surfaceRoute = lastSegment === 'company' ? 'company' : activeRoute;
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

  // Height exposed to useBottomTabBarHeight(): exactly the distance from the
  // physical bottom edge to the pill's top edge. Worker vacancy cards and
  // floating actions use this value, so lowering the pill also lets the card
  // grow down by the same amount instead of leaving an empty band.
  const layoutSafeBottom = bottomSafe(insets.bottom);
  const tabBarHeight = floatingTabBottom(layoutSafeBottom) + FLOATING_TAB_HEIGHT;

  const onTabPress = (route: string) => {
    if (route === 'feed') router.navigate('/(tabs)/feed');
    else if (route === 'matches') router.navigate('/(tabs)/matches');
    else if (route === 'profile') router.navigate('/(tabs)/profile');
  };

  return (
    <View style={{
      flex: 1,
      backgroundColor: surfaceRoute === 'feed'
        ? JT.background
        : surfaceRoute === 'profile' || surfaceRoute === 'company' ? Colors.outerBg : Colors.bg,
    }}>
      {/* Keep the navigator free of a tab-bar footer so cards and text can
          continue to the screen edge. The floating bar is a sibling overlay. */}
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
        tabBar={() => null}
      >
        <Tabs.Screen name="feed" options={{ tabBarIcon: () => null }} />
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="matches" options={{ tabBarIcon: () => null }} />
        {/* Переписка и профиль компании — вложенные экраны, не отдельные вкладки. */}
        <Tabs.Screen name="chats" options={{ href: null }} />
        <Tabs.Screen name="company" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ tabBarIcon: () => null }} />
      </Tabs>
      <FloatingTabBar activeRoute={activeRoute} surfaceRoute={surfaceRoute} onTabPress={onTabPress} tabs={tabs} />
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
  pill: {
    position: 'absolute',
    left: FLOATING_TAB_SIDE,
    right: FLOATING_TAB_SIDE,
    height: FLOATING_TAB_HEIGHT,
    borderRadius: FLOATING_TAB_RADIUS,
    backgroundColor: JT.ink,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  tabsRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: rs(5),
    gap: 0,
  },
  // Ширина — по содержимому, а не поровну: иначе «Вакансии» в оранжевой
  // пилюле обрезаются до «Ваканс…» на экране в 390pt.
  tabItem: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  tabCell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: rs(5),
    height: FLOATING_TAB_HEIGHT - rs(12),
    borderRadius: (FLOATING_TAB_HEIGHT - rs(12)) / 2,
    paddingHorizontal: rs(8),
  },
  tabCellActive: { backgroundColor: JT.accent },
  label: {
    flexShrink: 1,
    fontFamily: JT_FONT.bold,
    fontSize: rf(14),
    color: JT.surface,
  },
  labelActive: { color: JT.ink },
  badgeDot: {
    position: 'absolute',
    top: rs(8),
    right: rs(4),
    width: rs(8),
    height: rs(8),
    borderRadius: rs(4),
    backgroundColor: JT.accent,
  },
});
