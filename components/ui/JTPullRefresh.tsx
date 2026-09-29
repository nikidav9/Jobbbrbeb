import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';

/**
 * «Потяните, чтобы обновить» в стиле JT — для веба (сайт, PWA на iPhone,
 * мини-приложение). react-native-web не умеет RefreshControl: жест там не
 * делал ничего, хотя экраны просили «потяните вниз». В собранном приложении
 * работает системный RefreshControl экранов, этот компонент там ничего не
 * добавляет.
 *
 * Жест берётся, только когда всё под пальцем прокручено к началу и палец идёт
 * вниз, а не вбок: свайп карточки и прокрутка списка остаются как были.
 */
const TRIGGER = 72;   // сколько протянуть, чтобы обновилось
const HOLD = 80;      // насколько контент сдвинут, пока идёт обновление
const MAX = 120;
// Высота значка с подписью: он стоит ровно над сдвинутым контентом.
const INDICATOR_H = 76;

type Phase = 'idle' | 'pull' | 'ready' | 'refreshing';

export function JTPullRefresh({
  refreshing, onRefresh, children, topInset = 0,
}: {
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  children: React.ReactNode;
  /** Отступ значка сверху — чтобы не лечь на шапку экрана. */
  topInset?: number;
}) {
  const web = Platform.OS === 'web';
  const pull = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const [phase, setPhase] = useState<Phase>('idle');
  const start = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);
  const dist = useRef(0);

  const busy = refreshing || phase === 'refreshing';

  useEffect(() => {
    if (!busy) return;
    const loop = Animated.loop(Animated.timing(spin, {
      toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: !web,
    }));
    spin.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [busy, spin, web]);

  useEffect(() => {
    if (refreshing) {
      setPhase('refreshing');
      Animated.spring(pull, { toValue: HOLD, useNativeDriver: !web, bounciness: 6 }).start();
    } else if (phase === 'refreshing') {
      Animated.timing(pull, { toValue: 0, duration: 260, useNativeDriver: !web }).start(() => setPhase('idle'));
    }
    // phase нарочно не в зависимостях: реагируем только на смену refreshing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing]);

  // Прокручено ли что-нибудь под пальцем вниз от начала (DOM, только веб).
  const scrolledBelowTop = (target: any): boolean => {
    for (let el = target; el && el !== document.body; el = el.parentElement) {
      if (el.scrollTop > 0) return true;
    }
    return typeof window !== 'undefined' && window.scrollY > 0;
  };

  const touchProps = web ? {
    onTouchStart: (e: any) => {
      if (busy) return;
      const t = e.nativeEvent.touches?.[0];
      if (!t) return;
      armed.current = !scrolledBelowTop(e.nativeEvent.target);
      start.current = { x: t.pageX, y: t.pageY };
      dist.current = 0;
    },
    onTouchMove: (e: any) => {
      if (!armed.current || !start.current || busy) return;
      const t = e.nativeEvent.touches?.[0];
      if (!t) return;
      const dx = t.pageX - start.current.x;
      const dy = t.pageY - start.current.y;
      // Вбок или вверх — это свайп карточки или прокрутка, не наш жест.
      if (dy <= 0 || Math.abs(dx) > dy) {
        if (dist.current === 0) armed.current = Math.abs(dx) <= 8 && dy >= 0;
        return;
      }
      dist.current = Math.min(MAX, dy * 0.5);
      pull.setValue(dist.current);
      setPhase(dist.current >= TRIGGER ? 'ready' : 'pull');
    },
    onTouchEnd: () => {
      if (!armed.current || busy) { armed.current = false; return; }
      armed.current = false;
      if (dist.current >= TRIGGER) {
        setPhase('refreshing');
        Animated.spring(pull, { toValue: HOLD, useNativeDriver: false, bounciness: 6 }).start();
        Promise.resolve(onRefresh()).finally(() => {
          Animated.timing(pull, { toValue: 0, duration: 260, useNativeDriver: false })
            .start(() => setPhase('idle'));
        });
      } else {
        Animated.timing(pull, { toValue: 0, duration: 200, useNativeDriver: false })
          .start(() => setPhase('idle'));
      }
      dist.current = 0;
    },
  } : {};

  // В приложении жест и значок — у системного RefreshControl экрана.
  if (!web) return <>{children}</>;

  const visible = phase !== 'idle' || refreshing;
  const rotate = busy
    ? spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
    : pull.interpolate({ inputRange: [0, TRIGGER], outputRange: ['0deg', '180deg'], extrapolate: 'clamp' });
  const label = busy ? 'Обновляем…' : phase === 'ready' ? 'Отпустите, чтобы обновить' : 'Потяните, чтобы обновить';

  return (
    <View style={s.root} {...touchProps}>
      <Animated.View style={{ flex: 1, transform: [{ translateY: pull }] }}>
        {children}
      </Animated.View>
      {visible ? (
        <Animated.View
          pointerEvents="none"
          style={[s.indicator, {
            top: topInset,
            opacity: pull.interpolate({ inputRange: [0, 24], outputRange: [refreshing ? 1 : 0, 1], extrapolate: 'clamp' }),
            transform: [{ translateY: pull.interpolate({ inputRange: [0, MAX], outputRange: [-INDICATOR_H, MAX - INDICATOR_H], extrapolate: 'clamp' }) }],
          }]}
          testID="pull-refresh"
        >
          <View style={s.badgeBox}>
            <View style={s.badgeShadow} />
            <View style={[s.badge, busy && s.badgeBusy]}>
              <Animated.View style={{ transform: [{ rotate }] }}>
                <Ionicons name={busy ? 'sync' : 'arrow-down'} size={rs(20)} color={JT.ink} />
              </Animated.View>
            </View>
          </View>
          <Text style={s.label}>{label}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const SIZE = rs(40);
const s = StyleSheet.create({
  root: { flex: 1 },
  indicator: {
    position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50,
  },
  badgeBox: { width: SIZE + 3, height: SIZE + 3 },
  badgeShadow: {
    position: 'absolute', top: 3, left: 3, width: SIZE, height: SIZE,
    borderRadius: SIZE / 2, backgroundColor: JT.ink,
  },
  badge: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2,
    backgroundColor: JT.surface, borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeBusy: { backgroundColor: JT.accent },
  label: {
    marginTop: rs(6), fontFamily: JT_FONT.bold, fontSize: rf(12.5), color: JT.ink,
    backgroundColor: JT.background, paddingHorizontal: rs(8), borderRadius: rs(8), overflow: 'hidden',
  },
});
