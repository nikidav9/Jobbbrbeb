import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  ScrollView, Dimensions, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useApp } from '@/hooks/useApp';
import { Colors } from '@/constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SplashLoader, { useLoadingPercent, bootElapsed, SPLASH_MIN_MS } from '@/components/SplashLoader';
import Constants from 'expo-constants';
import { hideWebSplash, setWebSplashProgress } from '@/lib/webSplash';

import { rs } from '@/constants/scale';
import { dbCountUsers, dbRecordGuestEvent } from '@/services/db';
import { LegalLinks } from '@/components/LegalLinks';

const USER_COUNT_KEY = 'cached_user_count';

const { width: SW, height: SH } = Dimensions.get('window');
const sc = Math.min(SW / 390, SH / 844);
const r = (n: number) => Math.round(n * sc);

/**
 * Карусель на входе — как в getmatch: пролистай, узнай суть за три экрана.
 * Первый слайд — фото персонажа (уже есть в ресурсах), второй и третий —
 * простые плоские рисунки на react-native-svg: новых картинок не заводим,
 * а анимированный DrawnArt здесь не нужен — слайд статичен, пока его не пролистали.
 */
const SLIDES = [
  { key: 'swipe', title: 'Постоянная IT-работа в Москве — одним свайпом' },
  { key: 'sites', title: 'Вакансии прямо с сайтов компаний' },
  { key: 'apply', title: 'Отклик на сайт компании отправим за вас' },
] as const;

// Слайд 2: карточка браузера со списком вакансий — «берём напрямую с сайтов».
function SitesArt({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160">
      <Rect x={14} y={18} width={132} height={124} rx={16} fill="#FFFFFF" stroke={Colors.inputBorder} strokeWidth={2} />
      <Circle cx={28} cy={34} r={3.5} fill={Colors.inputBorder} />
      <Circle cx={40} cy={34} r={3.5} fill={Colors.inputBorder} />
      <Circle cx={52} cy={34} r={3.5} fill={Colors.primary} />
      <Line x1={14} y1={46} x2={146} y2={46} stroke={Colors.divider} strokeWidth={2} />
      {[64, 92, 120].map(cy => (
        <React.Fragment key={cy}>
          <Circle cx={30} cy={cy} r={9} fill={Colors.primaryLight} stroke={Colors.primary} strokeWidth={1.5} />
          <Rect x={46} y={cy - 7} width={72} height={6} rx={3} fill={Colors.inputBorder} />
          <Rect x={46} y={cy + 3} width={46} height={5} rx={2.5} fill={Colors.divider} />
        </React.Fragment>
      ))}
    </Svg>
  );
}

// Слайд 3: бумажный самолётик летит к карточке компании — «отправим за вас».
function ApplyArt({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160">
      <Circle cx={80} cy={80} r={62} fill={Colors.primaryLight} />
      <Path d="M40 108 Q60 70 96 52" stroke={Colors.primaryBorder} strokeWidth={2.5} strokeDasharray="5 6" fill="none" />
      <Path d="M96 46 L134 30 L110 64 L98 60 Z" fill={Colors.primary} />
      <Path d="M98 60 L110 64 L100 76 Z" fill="#E0590F" />
    </Svg>
  );
}

function SlideArt({ index, size }: { index: number; size: number }) {
  if (index === 0) {
    return (
      <Image
        source={require('@/assets/images/char-worker-crop.png')}
        style={{ width: size * 0.77, height: size, alignSelf: 'center' }}
        contentFit="contain"
        transition={200}
      />
    );
  }
  if (index === 1) return <SitesArt size={size} />;
  return <ApplyArt size={size} />;
}

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
  const [userCount, setUserCount] = useState<number | null>(null);
  const [userCountReady, setUserCountReady] = useState(false);
  // Always holds latest currentUser — avoids stale closure inside animation callback
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  // ── Карусель на входе ──
  const carouselRef = useRef<ScrollView>(null);
  const [slideWidth, setSlideWidth] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);

  const goToSlide = (index: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, index));
    setActiveSlide(clamped);
    if (slideWidth > 0) carouselRef.current?.scrollTo({ x: clamped * slideWidth, animated: true });
  };

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
    // Показываем кэшированное значение сразу
    AsyncStorage.getItem(USER_COUNT_KEY).then(cached => {
      if (cached) { setUserCount(Number(cached)); setUserCountReady(true); }
    }).catch(() => {});
    // Затем обновляем свежими данными.
    // Через прокси, а не напрямую в базу: с закрытием базы прямой запрос стал
    // получать отказ, и экран навсегда застревал на числе из кэша телефона —
    // в дашборде было 357, а здесь 351.
    dbCountUsers()
      .then(count => {
        if (count > 0) {
          setUserCount(count);
          setUserCountReady(true);
          AsyncStorage.setItem(USER_COUNT_KEY, String(count)).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── Лого ── */}
        <Animated.View style={[styles.logoRow, { opacity: introFade }]}>
          <Text style={styles.logo}>
            <Text style={styles.logoDark}>Job</Text>
            <Text style={styles.logoOrange}>Too</Text>
          </Text>
        </Animated.View>

        {/* ── Карусель: три слайда, как в getmatch ── */}
        <Animated.View style={[styles.carouselWrap, { opacity: introFade }]}>
          <View onLayout={e => setSlideWidth(e.nativeEvent.layout.width)}>
            {slideWidth > 0 && (
              <ScrollView
                ref={carouselRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                bounces={false}
                onMomentumScrollEnd={e => setActiveSlide(Math.round(e.nativeEvent.contentOffset.x / slideWidth))}
                onScrollEndDrag={e => setActiveSlide(Math.round(e.nativeEvent.contentOffset.x / slideWidth))}
              >
                {SLIDES.map((slide, i) => (
                  <View key={slide.key} style={[styles.slide, { width: slideWidth }]}>
                    <View style={styles.slideArt}>
                      <SlideArt index={i} size={r(184)} />
                    </View>
                    <Text style={styles.slideTitle}>{slide.title}</Text>
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
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                accessibilityLabel={`Слайд ${i + 1} из ${SLIDES.length}`}
                testID={`entry-dot-${i}`}
              >
                <View style={[styles.dot, i === activeSlide && styles.dotActive]} />
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        {/* ── Счётчик пользователей: социальное доказательство рядом с призывом ── */}
        <Animated.View style={[styles.userCountCard, { opacity: introFade }]}>
          <Text style={styles.userCountTxt}>
            {userCountReady && userCount != null
              ? <>Более <Text style={styles.userCountNum}>{userCount.toLocaleString('ru')}</Text> пользователей уже с нами!</>
              : 'Сообщество JobToo растёт'
            }
          </Text>
        </Animated.View>

        <View style={{ flex: 1, minHeight: r(8) }} />

        {/* ══ Главное действие: зарегистрироваться ══ */}
        <Animated.View style={{ opacity: introFade, width: '100%' }}>
          <TouchableOpacity
            style={styles.registerBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/register-worker')}
            testID="entry-register"
            accessibilityLabel="Зарегистрироваться"
          >
            <Text style={styles.registerBtnTxt}>Зарегистрироваться</Text>
          </TouchableOpacity>

          {/* ── Уже есть аккаунт ── */}
          <TouchableOpacity
            style={styles.loginBtn}
            activeOpacity={0.7}
            onPress={() => router.push('/login')}
            testID="entry-login"
            accessibilityLabel="Уже есть аккаунт"
          >
            <Text style={styles.loginBtnTxt}>Уже есть аккаунт</Text>
          </TouchableOpacity>

          {/* ══ Посмотреть без регистрации ══ */}
          {/* Снимаем стену регистрации: даём заглянуть в ленту вакансий как
              гость. Любое действие внутри попросит зарегистрироваться. */}
          <TouchableOpacity
            style={styles.guestLink}
            activeOpacity={0.6}
            onPress={() => {
              void dbRecordGuestEvent('guest_started');
              enterGuest();
              router.replace('/(tabs)');
            }}
            testID="entry-guest"
            accessibilityLabel="Смотреть вакансии без регистрации"
          >
            <Text style={styles.guestLinkTxt}>Смотреть вакансии без регистрации</Text>
          </TouchableOpacity>

          {/* ── Работодателям ── */}
          <View style={styles.employerRow}>
            <Text style={styles.employerGray}>Работодатель? </Text>
            <TouchableOpacity
              onPress={() => router.push('/register-employer')}
              testID="entry-employer"
              accessibilityLabel="Разместить вакансию"
            >
              <Text style={styles.employerLink}>Разместить вакансию</Text>
            </TouchableOpacity>
          </View>

          {/* Документы доступны до регистрации — прямо со стартового экрана. */}
          <View style={{ marginTop: r(10) }}>
            <LegalLinks />
          </View>

          <Text style={styles.version}>JobToo v{Constants.expoConfig?.version ?? '1.4.0'}</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Тёплый фон — как в ленте: экран продаёт одно действие, а не читается.
  safe: { flex: 1, backgroundColor: Colors.bgWarm },

  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: r(24),
    paddingTop: r(10),
    paddingBottom: r(12),
    maxWidth: rs(430),
    width: '100%',
    alignSelf: 'center',
  },

  logoRow: { marginBottom: r(6) },
  logo: { fontSize: r(24), fontWeight: '800', letterSpacing: -0.6 },
  logoDark: { color: '#111111' },
  logoOrange: { color: Colors.primary },

  // Карусель — спокойная, без теней и градиентов: аудитория на дешёвых
  // телефонах, лишние эффекты там же и тормозят.
  carouselWrap: { width: '100%', marginBottom: r(6) },
  slide: { alignItems: 'center', paddingHorizontal: r(4) },
  slideArt: { height: r(184), alignItems: 'center', justifyContent: 'center' },
  slideTitle: {
    fontSize: r(21), fontWeight: '800', color: '#111111', lineHeight: r(27),
    textAlign: 'center', marginTop: r(10), minHeight: r(58),
  },

  dotsRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: r(8), marginTop: r(4),
  },
  dot: {
    width: r(7), height: r(7), borderRadius: r(4),
    backgroundColor: Colors.primaryBorder,
  },
  dotActive: { width: r(18), backgroundColor: Colors.primary },

  userCountCard: {
    alignSelf: 'center',
    marginTop: r(4),
    paddingVertical: r(6), paddingHorizontal: r(14),
    borderRadius: r(20),
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    backgroundColor: '#FFFFFF',
  },
  userCountTxt: { fontSize: r(12), color: Colors.textSecondary },
  userCountNum: { fontWeight: '800', color: Colors.primary },

  // ── Главное действие ──
  registerBtn: {
    width: '100%', height: r(52), borderRadius: rs(100),
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  registerBtnTxt: { fontSize: r(16), fontWeight: '800', color: '#fff' },

  loginBtn: {
    width: '100%', height: r(52), borderRadius: rs(100),
    marginTop: r(10),
    borderWidth: 1.5, borderColor: Colors.primary,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  loginBtnTxt: { fontSize: r(16), fontWeight: '800', color: Colors.primary },

  // Снимаем стену регистрации: даём заглянуть в ленту как гость —
  // текстовая ссылка, а не кнопка, чтобы не спорить с двумя выше.
  guestLink: {
    alignSelf: 'center', marginTop: r(14),
    paddingVertical: r(6), paddingHorizontal: r(8),
  },
  guestLinkTxt: { fontSize: r(14), fontWeight: '700', color: Colors.textSecondary },

  employerRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    marginTop: r(14),
  },
  employerGray: { fontSize: r(13), color: Colors.textSecondary },
  employerLink: { fontSize: r(13), fontWeight: '800', color: Colors.primary },

  version: { textAlign: 'center', fontSize: r(11), color: Colors.textMuted, marginTop: r(8) },
});
