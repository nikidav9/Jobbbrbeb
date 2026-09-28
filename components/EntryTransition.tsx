import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Animated, Easing, Platform } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { hideWebSplash, setWebSplashProgress } from '@/lib/webSplash';
import SplashLoader, { useLoadingPercent, bootElapsed, SPLASH_MIN_MS } from '@/components/SplashLoader';

// Оверлей поверх вкладок: тот же загрузочный экран, что и при старте, держится
// пока подгружаются реальные данные (dataReady из AppContext), затем растворяется.

// Тот же минимум, что и у стартового экрана — чтобы анимация докрутилась
const MIN_SHOW_MS = SPLASH_MIN_MS;
const MAX_SHOW_MS = SPLASH_MIN_MS + 1600;  // уходим, даже если данные ещё едут
const FADE_MS = 700;  // плавный уход после ~5 с заставки

export default function EntryTransition() {
  const app = useApp();
  const dataReady = app?.dataReady ?? false;
  const percent = useLoadingPercent(dataReady);

  const [done, setDone] = useState(false);
  // Минимум считаем от старта приложения, а не от монтирования оверлея:
  // до него тот же экран уже показывался в index.tsx, и отсчёт заново
  // растянул бы загрузку вдвое.
  const [minPassed, setMinPassed] = useState(Platform.OS === 'web' || bootElapsed() >= MIN_SHOW_MS);
  const overlay = useRef(new Animated.Value(1)).current;
  const dissolving = useRef(false);
  const webFrame = useRef<number | null>(null);

  function dissolve() {
    if (dissolving.current) return;
    dissolving.current = true;
    if (Platform.OS === 'web') {
      // dataReady означает готовые данные, но не гарантирует, что Safari уже
      // нарисовал вкладки. Ждём два кадра и только после этого показываем 100 %
      // и убираем HTML splash — иначе iPhone остаётся с белым root-view.
      webFrame.current = requestAnimationFrame(() => {
        webFrame.current = requestAnimationFrame(() => {
          setWebSplashProgress(100);
          hideWebSplash();
          setDone(true);
          webFrame.current = null;
        });
      });
      return;
    }
    Animated.timing(overlay, {
      toValue: 0, duration: FADE_MS,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(() => setDone(true));
  }

  useEffect(() => {
    // Web: HTML splash has already been visible during JS load — no extra min hold
    const remaining = MIN_SHOW_MS - bootElapsed();
    const minT = (Platform.OS === 'web' || remaining <= 0)
      ? null
      : setTimeout(() => setMinPassed(true), remaining);
    const maxT = setTimeout(dissolve, MAX_SHOW_MS);
    return () => {
      if (minT) clearTimeout(minT);
      clearTimeout(maxT);
      if (webFrame.current !== null) cancelAnimationFrame(webFrame.current);
    };
  }, []);

  useEffect(() => {
    if (minPassed && dataReady) dissolve();
  }, [minPassed, dataReady]);

  if (done || Platform.OS === 'web') return null;

  return (
    <Animated.View style={[styles.overlay, { opacity: overlay }]} pointerEvents="none">
      <SplashLoader percent={percent} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F5EFE6',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 999,
  },
});
