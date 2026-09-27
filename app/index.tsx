import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  ScrollView, Dimensions, Platform, AccessibilityInfo,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useApp } from '@/hooks/useApp';
import SplashLoader, { useLoadingPercent, bootElapsed, SPLASH_MIN_MS } from '@/components/SplashLoader';
import { hideWebSplash, setWebSplashProgress } from '@/lib/webSplash';

import { rs } from '@/constants/scale';
import { dbRecordGuestEvent } from '@/services/db';

const { width: SW, height: SH } = Dimensions.get('window');
const sc = Math.min(SW / 390, SH / 844);
const r = (n: number) => Math.round(n * sc);

/**
 * Первый экран — макет владельца «JT-design» (27.09.2026), 1:1: три слайда
 * листаются пальцем и сами каждые 5 секунд; меняются только иллюстрация,
 * заголовок и подзаголовок, кнопки и ссылки стоят на месте.
 * Цвета и размеры — из README макета (экран 390×844, всё масштабируется r()).
 */
const JT = {
  accent: '#FF6B1A',
  ink: '#141414',
  background: '#F5EFE6',
  surface: '#FFFFFF',
  muted: '#D9CFC2',
  textSecondary: '#5C554D',
  textTertiary: '#6B645C',
};
const FONT_HEAD = 'Unbounded-700';
const FONT_MEDIUM = 'Manrope-500';
const FONT_BOLD = 'Manrope-700';

const AUTO_ADVANCE_MS = 5000;

// Неразрывные пробелы — как в макете, чтобы на узком экране предлог не
// повисал в конце строки. Подзаголовок третьего слайда без «или ссылкой»:
// импорта резюме по ссылке пока нет (docs/очередь-задач.md), обещать его нельзя.
const SLIDES = [
  {
    key: 'swipes',
    image: require('@/assets/images/onboarding-1-swipes.png'),
    title: 'Свайпай\nIT-вакансии',
    subtitle: 'Вправо\u00A0— откликнуться, влево\u00A0— пропустить. Поиск работы за\u00A0пару минут в\u00A0день',
  },
  {
    key: 'only-it',
    image: require('@/assets/images/onboarding-2-only-it.png'),
    title: 'Только IT и\u00A0ничего лишнего',
    subtitle: 'Разработка, QA, дизайн, аналитика\u00A0— от\u00A0стажёра до\u00A0тимлида',
  },
  {
    key: 'profile',
    image: require('@/assets/images/onboarding-3-profile.png'),
    title: 'Профиль за\u00A0секунды',
    subtitle: 'Загрузите резюме\u00A0— стек и\u00A0опыт подтянем сами',
  },
] as const;

export default function RootScreen() {
  const router = useRouter();
  const { currentUser, loading, enterGuest } = useApp();
  const finishing = useRef(false);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true if loading was already false when this component mounted (post-logout navigation)
  const skipSplash = useRef(!loading);
  const [ready, setReady] = useState(false);
  // Счётчик на загрузочном экране: добегает до 100 %, когда стартовые данные готовы
  const bootPercent = useLoadingPercent(!loading);
  // Текст и второстепенные блоки проявляются, пока рисуются иконки ролей
  const introFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!ready) return;
    Animated.timing(introFade, {
      toValue: 1, duration: 420, delay: 80, useNativeDriver: true,
    }).start();
  }, [ready]);
  // Always holds latest currentUser — avoids stale closure inside animation callback
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  // ── Карусель на входе ──
  const carouselRef = useRef<ScrollView>(null);
  const [slideWidth, setSlideWidth] = useState(0);
  const [slideHeight, setSlideHeight] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);
  // Картинка занимает большую часть высоты слайда, но не съедает место
  // подписи под ней и не раздувается на высоком экране.
  const artSize = slideHeight > 0
    ? Math.max(r(110), Math.min(r(300), slideHeight - r(150)))
    : r(220);

  // Куда листаем программно: пока прокрутка до него не доехала, onScroll не
  // трогает точку — иначе на полпути она мигала обратно на прежний слайд.
  const scrollTarget = useRef<number | null>(null);
  const goToSlide = (index: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, index));
    scrollTarget.current = clamped;
    setActiveSlide(clamped);
    if (slideWidth > 0) carouselRef.current?.scrollTo({ x: clamped * slideWidth, animated: true });
  };

  // Автолистание каждые 5 с, по кругу. Любое листание рукой меняет
  // activeSlide — таймер перезапускается от него, а пока палец держит
  // карусель, не листаем вовсе. С «уменьшить движение» в системе — только руками.
  const dragging = useRef(false);
  // Отпустил палец на том же слайде — activeSlide не сменился, и без этого
  // счётчика автолистание так бы и не возобновилось.
  const [dragTick, setDragTick] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);
  useEffect(() => {
    if (!ready || reduceMotion || slideWidth <= 0) return;
    const t = setTimeout(() => {
      if (!dragging.current) goToSlide((activeSlide + 1) % SLIDES.length);
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [ready, reduceMotion, slideWidth, activeSlide, dragTick]);

  useEffect(() => {
    // Мышь на вебе не тянет ScrollView сама — тач и колесо работают, а
    // зажатую левую кнопку браузер не превращает в жест прокрутки.
    // Тянем содержимое вручную поверх обычного скролла.
    if (Platform.OS !== 'web' || slideWidth <= 0) return;
    const node = carouselRef.current as unknown as HTMLElement | null;
    if (!node) return;
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;
    const onDown = (e: MouseEvent) => {
      dragging = true;
      moved = false;
      startX = e.pageX;
      startScroll = node.scrollLeft;
      // Без этого протаскивание мышью заодно выделяет заголовок под курсором.
      document.body.style.userSelect = 'none';
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.pageX - startX;
      if (Math.abs(dx) > 3) moved = true;
      node.scrollLeft = startScroll - dx;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      if (moved) goToSlide(Math.round(node.scrollLeft / slideWidth));
    };
    node.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      node.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [slideWidth]);

  useEffect(() => {
    // Post-logout: loading was already false when we mounted — skip splash, show screen now
    if (skipSplash.current && !loading) {
      if (currentUserRef.current) {
        router.replace('/(tabs)');
      } else {
        setReady(true);
      }
      return;
    }

    if (loading || finishing.current) return;
    finishing.current = true;
    // Даже если грузить нечего, даём логотипу дорисоваться, а счётчику —
    // добежать до 100 %: иначе экран мелькает и пропадает недорисованным.
    const wait = Math.max(0, SPLASH_MIN_MS - bootElapsed());
    finishTimer.current = setTimeout(() => {
      // Read from ref so we get the committed value, not a stale closure
      if (currentUserRef.current) {
        // Loading screen hides once tabs are mounted and data is ready:
        // native — EntryTransition overlay, web — the static HTML splash.
        router.replace('/(tabs)');
      } else {
        // No tabs will mount. First commit the welcome screen; a separate
        // paint effect below removes the HTML splash only after it is visible.
        setReady(true);
      }
      finishTimer.current = null;
    }, wait);
    // currentUser намеренно не является зависимостью: актуальное значение
    // читается из currentUserRef. Раньше его изменение между setLoading(false)
    // и этим таймером запускало cleanup, отменяло переход, а finishing уже не
    // позволяло назначить таймер повторно — экран навсегда оставался на 95–99 %.
  }, [loading]);

  useEffect(() => () => {
    if (finishTimer.current) clearTimeout(finishTimer.current);
  }, []);

  useEffect(() => {
    if (!ready) return;
    // Сначала рисуем приветственный экран и только затем убираем splash.
    // Два кадра особенно важны для установленной iOS PWA: первый callback
    // может выполняться до фактической отрисовки React root-view.
    const first = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (Platform.OS === 'web') {
          setWebSplashProgress(100);
          hideWebSplash();
        } else {
          SplashScreen.hideAsync().catch(() => {});
        }
      });
    });
    return () => cancelAnimationFrame(first);
  }, [ready]);

  if (!ready) {
    // Web: the static HTML splash (app/+html.tsx) is the single loading
    // screen — render nothing so there is no second screen behind it.
    if (Platform.OS === 'web') return null;
    return <SplashLoader percent={bootPercent} />;
  }

  const enterAsGuest = () => {
    void dbRecordGuestEvent('guest_started');
    enterGuest();
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={[styles.screen, { opacity: introFade }]}>
        {/* Крестик — пропустить знакомство и смотреть вакансии гостем.
            Любое действие внутри ленты попросит зарегистрироваться. */}
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.closeBtn}
            activeOpacity={0.7}
            onPress={enterAsGuest}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="entry-guest"
            accessibilityRole="button"
            accessibilityLabel="Пропустить и смотреть вакансии без регистрации"
          >
            <Ionicons name="close" size={r(22)} color={JT.ink} />
          </TouchableOpacity>
        </View>

        {/* Меняются только картинка, заголовок и подзаголовок. */}
        <View
          style={styles.carouselBox}
          onLayout={e => {
            setSlideWidth(e.nativeEvent.layout.width);
            setSlideHeight(e.nativeEvent.layout.height);
          }}
        >
          {slideWidth > 0 && slideHeight > 0 && (
            <ScrollView
              ref={carouselRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              bounces={false}
              // Слайд считаем по ходу прокрутки, а не в конце: на iOS
              // onMomentumScrollEnd внутри вертикального списка приходил не
              // всегда, и на всех слайдах горела первая точка.
              scrollEventThrottle={32}
              onScroll={e => {
                const x = e.nativeEvent.contentOffset.x;
                const target = scrollTarget.current;
                if (target !== null) {
                  if (Math.abs(x - target * slideWidth) > 2) return;
                  scrollTarget.current = null;
                }
                const i = Math.max(0, Math.min(SLIDES.length - 1, Math.round(x / slideWidth)));
                setActiveSlide(prev => (prev === i ? prev : i));
              }}
              onScrollBeginDrag={() => { dragging.current = true; scrollTarget.current = null; }}
              onScrollEndDrag={() => { dragging.current = false; setDragTick(t => t + 1); }}
            >
              {SLIDES.map(slide => (
                <View key={slide.key} style={[styles.slide, { width: slideWidth }]}>
                  <View style={styles.artBox}>
                    <Image
                      source={slide.image}
                      style={{ width: artSize, height: artSize }}
                      contentFit="contain"
                      transition={150}
                      accessibilityIgnoresInvertColors
                    />
                  </View>
                  <Text style={styles.title}>{slide.title}</Text>
                  <Text style={styles.subtitle}>{slide.subtitle}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.dotsRow}>
          {SLIDES.map((slide, i) => (
            <TouchableOpacity
              key={slide.key}
              onPress={() => goToSlide(i)}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Слайд ${i + 1} из ${SLIDES.length}`}
              testID={`entry-dot-${i}`}
            >
              <View style={[styles.dot, i === activeSlide && styles.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={styles.registerBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/register-worker')}
            testID="entry-register"
            accessibilityRole="button"
            accessibilityLabel="Зарегистрироваться"
          >
            <Text style={styles.btnTxt}>Зарегистрироваться</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.loginBtn}
            activeOpacity={0.7}
            onPress={() => router.push('/login')}
            testID="entry-login"
            accessibilityRole="button"
            accessibilityLabel="Уже есть аккаунт"
          >
            <Text style={styles.btnTxt}>Уже есть аккаунт</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.employer}>
          IT-компания?{' '}
          <Text
            style={styles.employerLink}
            onPress={() => router.push('/register-employer')}
            testID="entry-employer"
            accessibilityRole="link"
          >
            Найти разработчиков
          </Text>
        </Text>

        <Text style={styles.legal}>
          Пользуясь приложением, вы принимаете{' '}
          <Text
            style={styles.legalLink}
            onPress={() => router.push({ pathname: '/legal', params: { doc: 'terms' } })}
            accessibilityRole="link"
          >
            Условия пользования сервисом
          </Text>
          {' '}и{' '}
          <Text
            style={styles.legalLink}
            onPress={() => router.push({ pathname: '/legal', params: { doc: 'dataPolicy' } })}
            accessibilityRole="link"
          >
            Политику обработки персональных данных
          </Text>
        </Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Фон макета #F5EFE6 и у safe area — без белой полосы под часами.
  safe: { flex: 1, backgroundColor: JT.background },
  screen: {
    flex: 1,
    width: '100%', maxWidth: rs(430), alignSelf: 'center',
    paddingHorizontal: r(24), paddingTop: r(8), paddingBottom: r(16),
  },

  topRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  closeBtn: {
    width: r(44), height: r(44), borderRadius: r(22),
    backgroundColor: JT.surface,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: JT.ink, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  carouselBox: { flex: 1, width: '100%' },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  artBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: {
    fontFamily: FONT_HEAD, fontSize: r(31), lineHeight: r(35), letterSpacing: -0.3,
    color: JT.ink, textAlign: 'center',
  },
  subtitle: {
    fontFamily: FONT_MEDIUM, fontSize: r(16), lineHeight: r(23),
    color: JT.textSecondary, textAlign: 'center',
    marginTop: r(14), marginHorizontal: r(12),
  },

  dotsRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: r(8), marginVertical: r(24),
  },
  dot: { width: r(8), height: r(8), borderRadius: r(4), backgroundColor: JT.muted },
  dotActive: { width: r(28), backgroundColor: JT.accent },

  buttons: { gap: r(12) },
  // Текст на оранжевом — чёрный: белый на этом оранжевом читается плохо (README макета).
  registerBtn: {
    height: r(58), borderRadius: r(18), backgroundColor: JT.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  loginBtn: {
    height: r(58), borderRadius: r(18), borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  btnTxt: { fontFamily: FONT_BOLD, fontSize: r(18), color: JT.ink },

  employer: {
    fontFamily: FONT_MEDIUM, fontSize: r(15), color: JT.ink,
    textAlign: 'center', marginTop: r(20),
  },
  employerLink: {
    fontFamily: FONT_BOLD,
    textDecorationLine: 'underline', textDecorationColor: JT.accent,
  },
  legal: {
    fontFamily: FONT_MEDIUM, fontSize: r(12), lineHeight: r(18),
    color: JT.textTertiary, textAlign: 'center', marginTop: r(16),
  },
  legalLink: { textDecorationLine: 'underline' },
});
