import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions, Image, AccessibilityInfo } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFonts } from 'expo-font';
import { Unbounded_700Bold } from '@expo-google-fonts/unbounded/700Bold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { rs, rf } from '@/constants/scale';

// Загрузочный экран — макет «JT-splash» (28.09.2026, docs/design/splash), 1:1
// с веб-версией в app/+html.tsx: оранжевая точка раскрывается в белую плашку,
// впрыгивает логотип, появляется тень-наклейка и подпись, полоса загрузки идёт
// по реальному проценту. Штатный RN Animated (reanimated-плагин не подключён).
//
// Ниже — ещё и DrawnArt/Stroke: «рисующиеся» линии, которыми нарисованы
// иконки выбора роли (constants/roleIcons.ts).

const AnimatedPath = Animated.createAnimatedComponent(Path);

const { height: SH } = Dimensions.get('window');

const WHITE = '#FFFFFF';

// Длительность полной прорисовки
const DRAW_MS = 1280;

// Штрихи арта. from/to — окно прорисовки внутри общего прогресса 0→1,
// len — приблизительная длина пути (для strokeDasharray).
export type Stroke = { d: string; len: number; from: number; to: number; w?: number; t?: string };


function DrawnStroke({ stroke, progress, color = WHITE, scale = 1 }: {
  stroke: Stroke; progress: Animated.Value; color?: string; scale?: number;
}) {
  const offset = progress.interpolate({
    inputRange: [stroke.from, stroke.to],
    outputRange: [stroke.len, 0],
    extrapolate: 'clamp',
  });
  return (
    <AnimatedPath
      d={stroke.d}
      transform={stroke.t}
      stroke={color}
      strokeWidth={(stroke.w ?? 3.4) * scale}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      strokeDasharray={[stroke.len, stroke.len]}
      strokeDashoffset={offset as unknown as number}
    />
  );
}

/**
 * Переиспользуемый «рисующийся» арт: линии прорисовываются по своим окнам
 * внутри общего прогресса. Используется и на загрузочном экране, и в
 * иконках выбора роли, чтобы стиль везде был один.
 */
export function DrawnArt({
  strokes, viewBox, width, height, color = WHITE, delay = 0, duration = DRAW_MS, strokeScale = 1,
}: {
  strokes: Stroke[];
  viewBox: string;
  width: number;
  height: number;
  color?: string;
  delay?: number;
  duration?: number;
  strokeScale?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1, duration, delay,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, []);

  return (
    <Svg width={width} height={height} viewBox={viewBox}>
      {strokes.map((s, i) => (
        <DrawnStroke key={i} stroke={s} progress={progress} color={color} scale={strokeScale} />
      ))}
    </Svg>
  );
}

/**
 * Процент загрузки. Три фазы, чтобы счёт выглядел живым и честным:
 *   1) 1 → 95 % равномерно за minMs, пока прописывается логотип;
 *   2) 95 → 99 % по одному проценту раз в TAIL_STEP_MS, если данные ещё едут
 *      (видно, что приложение не зависло, но и до 100 % не врём);
 *   3) данные готовы → быстро добегаем до 100 %.
 */
const TAIL_STEP_MS = 250;

// Момент начала загрузки, общий на всё приложение. Загрузочный экран
// показывается дважды подряд (сначала в index.tsx, затем оверлеем
// EntryTransition при входе во вкладки) — без общего старта прорисовка и
// счётчик сбрасывались бы на второй раз. Держим их непрерывными.
// Достигнутый процент — общий для обоих показов экрана. Без него второй
// показ (оверлей поверх вкладок) начинал считать заново и откатывал 100 → 99.
let lastPercent = 1;
let bootStartedAt: number | null = null;
function bootStart(): number {
  if (bootStartedAt == null) bootStartedAt = Date.now();
  return bootStartedAt;
}

/** Сколько миллисекунд прошло с начала загрузки приложения. */
export function bootElapsed(): number {
  return Date.now() - bootStart();
}

/**
 * Минимальное время показа загрузочного экрана. Без него при быстром старте
 * (гость, которому нечего грузить) экран улетал недорисованным.
 */
// Заставка всегда ~5 с (решение владельца 28.09.2026): раскадровка макета
// растянута вдвое; полоса идёт с SPLASH_BAR_FROM и доходит до 100 % к
// SPLASH_MIN_MS, после — плавный уход (EntryTransition, FADE_MS).
export const SPLASH_MIN_MS = 4400;
const SPLASH_BAR_FROM = 2400;

/**
 * Процент на полосе заставки. Полоса видна с SPLASH_BAR_FROM и идёт ровно по
 * времени: данные готовы — доходит до 100 % к SPLASH_MIN_MS, не раньше (иначе
 * прыгнула бы к концу и стояла); данные ещё едут — останавливается на 95 и
 * дальше ползёт по проценту, не обещая 100 %, пока их нет.
 */
export function useLoadingPercent(ready: boolean, minMs = SPLASH_MIN_MS): number {
  const [percent, setPercent] = useState(lastPercent);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const id = setInterval(() => {
      setPercent(prevState => {
        // Считаем от общего достигнутого значения, а не от локального
        const prev = Math.max(prevState, lastPercent);
        if (prev >= 100) { lastPercent = 100; return 100; }
        const elapsed = bootElapsed();
        const byTime = Math.max(0, Math.min(100, Math.round((elapsed - SPLASH_BAR_FROM) / (minMs - SPLASH_BAR_FROM) * 100)));
        if (readyRef.current) return (lastPercent = Math.max(prev, byTime));
        if (elapsed < minMs) return (lastPercent = Math.max(prev, Math.min(95, byTime)));
        // хвост: 96, 97, 98, 99 — заметно медленнее
        const extra = Math.floor((elapsed - minMs) / TAIL_STEP_MS);
        return (lastPercent = Math.max(prev, Math.min(99, 95 + extra)));
      });
    }, 45);
    return () => clearInterval(id);
  }, [minMs]);

  return percent;
}

const INK = '#141414';
const ACCENT = '#FF6B1A';
const PLATE = rs(140);
const LOGO_W = rs(96);
const BAR_W = rs(180);
// Центр плашки — на 45 % высоты, как (195, 380) на экране 844 pt.
const CENTER_Y = SH * 0.45;

/**
 * Проигрывает значение 0 → 1 в окне [at, at + ms] от старта приложения.
 * Экран показывается дважды подряд (index.tsx, затем оверлей
 * EntryTransition), поэтому уже прошедшая часть не проигрывается заново.
 */
function play(value: Animated.Value, at: number, ms: number, easing: (t: number) => number, native: boolean) {
  const elapsed = bootElapsed();
  if (elapsed >= at + ms) { value.setValue(1); return; }
  const from = elapsed > at ? (elapsed - at) / ms : 0;
  value.setValue(from);
  Animated.timing(value, {
    toValue: 1, duration: ms * (1 - from), delay: Math.max(0, at - elapsed),
    easing, useNativeDriver: native,
  }).start();
}

export default function SplashLoader({ percent = 1 }: { percent?: number }) {
  // Подписи рисуем только с загруженным шрифтом. Иначе Android меряет их
  // системным шрифтом, а когда приходит Unbounded/Manrope, ширину не
  // пересчитывает — и строка обрезается («Работа в IT —», «Подбираем»).
  // Шрифты те же, что грузит app/_layout.tsx: второй загрузки не будет.
  const [fontsReady] = useFonts({ Unbounded_700Bold, Manrope_700Bold });
  // Тайминги — раскадровка макета, растянутая до ~5 с.
  const dot = useRef(new Animated.Value(0)).current;      // 0–500: точка 0 → 1
  const open = useRef(new Animated.Value(0)).current;     // 500–1100: точка → плашка
  const logo = useRef(new Animated.Value(0)).current;     // 1100–1800: логотип с отскоком
  const sticker = useRef(new Animated.Value(0)).current;  // 1700–2400: тень и подпись
  const loading = useRef(new Animated.Value(0)).current;  // 2400+: полоса и подпись под ней

  useEffect(() => {
    let alive = true;
    const run = (reduce: boolean) => {
      if (!alive) return;
      if (reduce) {
        // «Уменьшение движения»: сразу кадр 5, без анимации.
        [dot, open, logo, sticker, loading].forEach(v => v.setValue(1));
        return;
      }
      play(dot, 0, 500, Easing.out(Easing.quad), false);
      play(open, 500, 600, Easing.bezier(0.2, 0.8, 0.2, 1), false);
      play(logo, 1100, 700, Easing.linear, true);
      play(sticker, 1700, 700, Easing.out(Easing.quad), true);
      play(loading, SPLASH_BAR_FROM, 500, Easing.out(Easing.quad), true);
    };
    AccessibilityInfo.isReduceMotionEnabled().then(run).catch(() => run(false));
    return () => { alive = false; };
  }, []);

  // Точка 18 pt = 0.13 плашки: сначала растёт до неё, потом раскрывается.
  const plateScale = Animated.add(
    dot.interpolate({ inputRange: [0, 1], outputRange: [0, 0.13] }),
    open.interpolate({ inputRange: [0, 1], outputRange: [0, 0.87] }),
  );
  const radius = open.interpolate({ inputRange: [0, 1], outputRange: [PLATE / 2, rs(36)] });
  // Цвет оранжевый → белый: оранжевый слой гаснет над белой плашкой.
  const orange = open.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  // Отскок scale 0.6 → 1.08 → 1 (cubic-bezier(.3,1.4,.5,1) макета).
  const logoScale = logo.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.6, 1.08, 1] });
  const logoOpacity = logo.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] });
  const shadowShift = sticker.interpolate({ inputRange: [0, 1], outputRange: [0, rs(6)] });
  const tagShift = sticker.interpolate({ inputRange: [0, 1], outputRange: [rs(10), 0] });

  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const fillW = Math.round((BAR_W - 4) * pct / 100);

  return (
    <View style={styles.root} accessibilityLabel="Загрузка JobToo">
      <View style={styles.slot}>
        {/* Тень-наклейка: чёрная копия плашки, выезжает на 6 pt вправо-вниз */}
        <Animated.View
          style={[styles.plateBox, styles.shadow, {
            opacity: sticker,
            transform: [{ translateX: shadowShift }, { translateY: shadowShift }],
          }]}
        />
        <Animated.View style={[styles.plateBox, styles.plate, { borderRadius: radius, transform: [{ scale: plateScale }] }]}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: ACCENT, opacity: orange }]} />
          <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }] }}>
            <Image source={require('@/assets/images/splash-mark.png')} style={styles.logo} resizeMode="contain" />
          </Animated.View>
        </Animated.View>
      </View>

      <View style={styles.below}>
        {fontsReady ? (
          <Animated.Text style={[styles.tag, { opacity: sticker, transform: [{ translateY: tagShift }] }]}>
            Работа в IT и офисе — свайпом
          </Animated.Text>
        ) : <View style={styles.tagSlot} />}
        <Animated.View style={[styles.bar, { opacity: loading }]} accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: pct }}>
          <View style={[styles.fill, { width: fillW }, pct > 0 && pct < 100 && styles.fillEdge]} />
        </Animated.View>
        {fontsReady ? (
          <Animated.Text style={[styles.caption, { opacity: loading }]}>Подбираем вакансии…</Animated.Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: '#F5EFE6' },
  slot: {
    position: 'absolute', left: 0, right: 0, top: CENTER_Y - PLATE / 2, height: PLATE,
    alignItems: 'center',
  },
  plateBox: { position: 'absolute', width: PLATE, height: PLATE, borderRadius: rs(36) },
  shadow: { backgroundColor: INK },
  plate: {
    backgroundColor: WHITE, borderWidth: 2, borderColor: INK, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  logo: { width: LOGO_W, height: LOGO_W * 186 / 288 },
  below: {
    position: 'absolute', left: 0, right: 0, top: CENTER_Y + rs(106),
    alignItems: 'center', paddingHorizontal: 16,
  },
  // alignSelf: 'stretch' — ширина строки от экрана, а не от замера текста:
  // запасная страховка от обрезки, перенос — по словам.
  tag: {
    alignSelf: 'stretch', fontFamily: 'Unbounded_700Bold', fontSize: rf(18), lineHeight: rf(22),
    letterSpacing: -0.18, color: INK, textAlign: 'center',
  },
  tagSlot: { height: rf(22) },
  bar: {
    marginTop: rs(26), width: BAR_W, height: 14, borderWidth: 2, borderColor: INK, borderRadius: 7,
    backgroundColor: WHITE, overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: ACCENT },
  fillEdge: { borderRightWidth: 2, borderRightColor: INK },
  caption: { alignSelf: 'stretch', marginTop: 10, fontFamily: 'Manrope_700Bold', fontSize: rf(13), color: '#6B645C', textAlign: 'center' },
});
