import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { useApp } from '@/hooks/useApp';
import {
  getOnboardingTarget,
  measureOnboardingTargets,
  subscribeOnboardingTargets,
} from '@/lib/onboardingTargets';
import {
  chapterLabel,
  normalizeOnboardingPath,
  onboardingSteps,
  onboardingStorageKey,
} from '@/lib/onboardingFlow';

type Rect = { x: number; y: number; w: number; h: number };
type StoredProgress = { status: 'active' | 'done'; step: number };

const replayListeners = new Set<() => void>();
const doneListeners = new Set<() => void>();

export async function isOnboardingDone(uid: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(onboardingStorageKey(uid));
    if (!raw) return false;
    return (JSON.parse(raw) as StoredProgress).status === 'done';
  } catch {
    return true;
  }
}

export function onOnboardingDone(cb: () => void): () => void {
  doneListeners.add(cb);
  return () => doneListeners.delete(cb);
}

export async function resetOnboarding(uid: string) {
  try { await AsyncStorage.removeItem(onboardingStorageKey(uid)); } catch {}
  replayListeners.forEach(fn => fn());
}

function PulseRing({ rect, radius }: { rect: Rect; radius: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(180),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const frame = {
    position: 'absolute' as const,
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    borderRadius: radius,
    borderWidth: 2.5,
    borderColor: Colors.primary,
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[frame, { opacity: 0.95 }]} />
      <Animated.View
        style={[
          frame,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
          },
        ]}
      />
    </View>
  );
}

function fallbackRect(target: string | undefined, width: number, height: number, top: number, bottom: number): Rect | undefined {
  if (!target) return undefined;
  if (target === 'worker.feed.card') return { x: 16, y: top + 118, w: width - 32, h: Math.max(220, height - top - bottom - 270) };
  if (target === 'worker.feed.reject') return { x: width * 0.15, y: height - bottom - 166, w: 72, h: 72 };
  if (target === 'worker.feed.filter') return { x: width * 0.5 - 36, y: height - bottom - 166, w: 72, h: 72 };
  if (target === 'worker.feed.apply') return { x: width * 0.75 - 18, y: height - bottom - 166, w: 72, h: 72 };
  if (target === 'worker.feed.save') return { x: width - 132, y: top + 126, w: 52, h: 52 };
  if (target === 'tab.matches') return { x: width / 3, y: height - bottom - 78, w: width / 3, h: 64 };
  if (target === 'tab.profile') return { x: width * 2 / 3, y: height - bottom - 78, w: width / 3, h: 64 };
  if (target === 'matches.saved') return { x: width - 150, y: top + 10, w: 48, h: 48 };
  if (target === 'matches.chats') return { x: width - 96, y: top + 10, w: 48, h: 48 };
  if (target.endsWith('.back')) return { x: 12, y: top + 8, w: 52, h: 52 };
  if (target === 'employer.feed.create') return { x: width - 88, y: height - bottom - 166, w: 64, h: 64 };
  if (target === 'employer.create.publish') return { x: 20, y: height - bottom - 90, w: width - 40, h: 58 };
  return { x: 16, y: top + 100, w: width - 32, h: Math.max(180, height - top - bottom - 220) };
}

function roundedRect({ x, y, w, h }: Rect, radius: number) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  return `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r}`
    + ` V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
    + ` H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r}`
    + ` V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}

function spotRadius(rect: Rect) {
  return Math.abs(rect.w - rect.h) < 14 ? Math.max(rect.w, rect.h) / 2 : rs(18);
}

export function OnboardingOverlay() {
  const app = useApp();
  const user = app?.currentUser ?? null;
  const router = useRouter();
  const pathname = normalizeOnboardingPath(usePathname());
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [, redraw] = useState(0);

  const role = user?.role === 'employer' ? 'employer' : 'worker';
  const userId = user?.id ?? null;
  const isGuest = user?.isGuest ?? false;
  const steps = useMemo(() => onboardingSteps(role), [role]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const stepPath = step?.path;

  useEffect(() => subscribeOnboardingTargets(() => redraw(value => value + 1)), []);

  useEffect(() => {
    if (!visible) return;
    measureOnboardingTargets();
    const first = setTimeout(measureOnboardingTargets, 120);
    const second = setTimeout(measureOnboardingTargets, 420);
    return () => { clearTimeout(first); clearTimeout(second); };
  }, [visible, stepIndex, pathname]);

  useEffect(() => {
    if (!userId || isGuest) {
      setVisible(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(onboardingStorageKey(userId));
        const saved = raw ? JSON.parse(raw) as StoredProgress : null;
        if (cancelled || saved?.status === 'done') return;
        setStepIndex(Math.max(0, Math.min(saved?.step ?? 0, steps.length - 1)));
        setVisible(true);
      } catch {}
    };
    void load();

    const replay = () => {
      setStepIndex(0);
      setVisible(true);
    };
    replayListeners.add(replay);
    return () => {
      cancelled = true;
      replayListeners.delete(replay);
    };
  }, [userId, isGuest, steps.length]);

  useEffect(() => {
    if (!visible || !stepPath || pathname === stepPath) return;
    const timer = setTimeout(() => router.replace(stepPath as never), 80);
    return () => clearTimeout(timer);
  }, [visible, stepPath, pathname, router]);

  if (!visible || !user || user.isGuest || !step) return null;

  const measured = step.target ? getOnboardingTarget(step.target) : undefined;
  const compactMeasured = measured && (step.target?.endsWith('.content') || step.target === 'employer.create.form')
    ? { ...measured, h: Math.min(measured.h, rs(270)) }
    : measured;
  const padded = compactMeasured
    ? { x: compactMeasured.x - 5, y: compactMeasured.y - 5, w: compactMeasured.w + 10, h: compactMeasured.h + 10 }
    : fallbackRect(step.target, width, height, insets.top, insets.bottom);
  const spot = padded && padded.y < height && padded.y + padded.h > 0 ? padded : undefined;
  const radius = spot ? spotRadius(spot) : rs(18);

  const chapterOrder = Array.from(new Set(steps.map(item => item.chapter)));
  const chapterIndex = chapterOrder.indexOf(step.chapter);
  const chapterSteps = steps.filter(item => item.chapter === step.chapter);
  const chapterStepIndex = chapterSteps.findIndex(item => item.id === step.id);
  const isLast = stepIndex === steps.length - 1;

  const complete = async () => {
    try {
      const progress: StoredProgress = { status: 'done', step: steps.length - 1 };
      await AsyncStorage.setItem(onboardingStorageKey(user.id), JSON.stringify(progress));
    } catch {}
    setVisible(false);
    doneListeners.forEach(fn => fn());
  };

  const advance = async () => {
    if (isLast) {
      if (step.navigate) router.replace(step.navigate as never);
      await complete();
      return;
    }
    const nextIndex = stepIndex + 1;
    setStepIndex(nextIndex);
    try {
      const progress: StoredProgress = { status: 'active', step: nextIndex };
      await AsyncStorage.setItem(onboardingStorageKey(user.id), JSON.stringify(progress));
    } catch {}
    if (step.navigate) router.replace(step.navigate as never);
  };

  const cardHeight = rs(230);
  const belowSpace = spot ? height - (spot.y + spot.h) : 0;
  const aboveSpace = spot?.y ?? 0;
  const cardPosition = !spot
    ? { top: Math.max(insets.top + rs(70), height / 2 - cardHeight / 2) }
    : belowSpace > cardHeight + rs(18)
      ? { top: spot.y + spot.h + rs(14) }
      : aboveSpace > cardHeight + insets.top + rs(18)
        ? { bottom: Math.max(height - spot.y + rs(14), insets.bottom + rs(18)) }
        : { top: Math.max(insets.top + rs(64), height - insets.bottom - cardHeight - rs(18)) };

  const dimPath = spot
    ? `M0 0 H${width} V${height} H0 Z ${roundedRect(spot, radius)}`
    : `M0 0 H${width} V${height} H0 Z`;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => { void complete(); }}
    >
      <View style={StyleSheet.absoluteFill}>
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={dimPath} fill="rgba(17,17,17,0.76)" fillRule="evenodd" />
        </Svg>

        {spot ? <PulseRing rect={spot} radius={radius} /> : null}

        {spot ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Шаг обучения: ${step.title}`}
            style={{ position: 'absolute', left: spot.x, top: spot.y, width: spot.w, height: spot.h, borderRadius: radius }}
            activeOpacity={1}
            onPress={() => { void advance(); }}
          />
        ) : null}

        <TouchableOpacity
          style={[styles.skip, { top: insets.top + rs(8) }]}
          onPress={() => { void complete(); }}
          hitSlop={10}
        >
          <Text style={styles.skipText}>Пропустить</Text>
        </TouchableOpacity>

        <View style={[styles.card, { left: rs(20), width: width - rs(40), ...cardPosition }]}>
          <View style={styles.progressTop}>
            <Text style={styles.chapter}>
              Глава {chapterIndex + 1} из {chapterOrder.length} · {chapterLabel[step.chapter]}
            </Text>
            <Text style={styles.counter}>{chapterStepIndex + 1}/{chapterSteps.length}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((stepIndex + 1) / steps.length) * 100}%` }]} />
          </View>

          <View style={styles.titleRow}>
            <View style={styles.icon}><Ionicons name={step.icon} size={rf(20)} color="#FFFFFF" /></View>
            <Text style={styles.title}>{step.title}</Text>
          </View>
          <Text style={styles.body}>{step.body}</Text>

          {spot ? (
            <View style={styles.tapHint}>
              <Ionicons name="finger-print-outline" size={rf(16)} color={Colors.primary} />
              <Text style={styles.tapHintText}>Нажмите выделенный элемент</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.button} onPress={() => { void advance(); }} activeOpacity={0.85}>
              <Text style={styles.buttonText}>{step.cta ?? 'Продолжить'}</Text>
              {!isLast ? <Ionicons name="arrow-forward" size={rf(17)} color="#FFFFFF" /> : null}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  skip: {
    position: 'absolute', right: rs(16), paddingHorizontal: rs(14), paddingVertical: rs(8),
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: rs(100),
  },
  skipText: { color: '#FFFFFF', fontSize: rf(12), fontWeight: '700' },
  card: {
    position: 'absolute', backgroundColor: '#FFFFFF', borderRadius: rs(22), padding: rs(18),
    shadowColor: '#000000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.24,
    shadowRadius: 28, elevation: 18,
  },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: rs(8) },
  chapter: { flex: 1, fontSize: rf(10.5), fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase' },
  counter: { fontSize: rf(11), fontWeight: '800', color: Colors.primary },
  progressTrack: { height: rs(4), borderRadius: rs(2), backgroundColor: '#ECEDEF', overflow: 'hidden', marginTop: rs(8), marginBottom: rs(14) },
  progressFill: { height: '100%', borderRadius: rs(2), backgroundColor: Colors.primary },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  icon: { width: rs(38), height: rs(38), borderRadius: rs(12), alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary },
  title: { flex: 1, fontSize: rf(17), fontWeight: '800', color: Colors.textPrimary },
  body: { marginTop: rs(10), fontSize: rf(13.5), lineHeight: rf(19), color: Colors.textSecondary },
  tapHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(7), marginTop: rs(14), paddingVertical: rs(10), borderRadius: rs(100), backgroundColor: Colors.primaryLight },
  tapHintText: { fontSize: rf(12.5), fontWeight: '700', color: Colors.primary },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(8), marginTop: rs(16), paddingVertical: rs(13), borderRadius: rs(100), backgroundColor: Colors.primary },
  buttonText: { color: '#FFFFFF', fontSize: rf(14), fontWeight: '800' },
});
