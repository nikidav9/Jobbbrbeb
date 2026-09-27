import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  ScrollView, Dimensions, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
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

const USER_COUNT_KEY = 'cached_user_count';

const { width: SW, height: SH } = Dimensions.get('window');
const sc = Math.min(SW / 390, SH / 844);
const r = (n: number) => Math.round(n * sc);

/**
 * Карусель на входе — как в getmatch: пролистай, узнай суть за три экрана.
 * Первый слайд — фото персонажа (уже есть в ресурсах), второй и третий —
 * тот же персонаж и та же оранжевая «таблетка»-бейдж, что и в остальном
 * интерфейсе: иначе слайды 2–3 читаются как значки от другого приложения.
 * Неразрывные пробелы — чтобы на 320 px не повисало одно слово на строке.
 */
const SLIDES = [
  // \u00A0 перед тире: иначе на узком экране строка начиналась с «— одним свайпом».
  { key: 'swipe', title: 'Постоянная IT-работа в\u00A0Москве\u00A0— одним\u00A0свайпом' },
  { key: 'sites', title: 'Вакансии прямо с сайтов компаний' },
  { key: 'apply', title: 'Отклик на сайт компании отправим за вас' },
] as const;

// Бейдж-«таблетка» поверх картинки — общий акцент для 2 и 3 слайда, тот же
// оранжевый и та же белая обводка, что и у кнопок ниже.
type IconName = React.ComponentProps<typeof Ionicons>['name'];
function ArtBadge({ size, icon, style }: { size: number; icon: IconName; style?: object }) {
  return (
    <View style={[{
      position: 'absolute',
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: Colors.primary,
      borderWidth: size * 0.09, borderColor: '#FFFFFF',
      alignItems: 'center', justifyContent: 'center',
    }, style]}
    >
      <Ionicons name={icon} size={size * 0.46} color="#FFFFFF" />
    </View>
  );
}

// Слайд 2: карточка браузера со списком вакансий — «берём напрямую с сайтов».
// Насыщенные цвета и тёмный контур — тот же визуальный вес, что у персонажа.
function SitesArt({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 160 160">
        <Rect x={12} y={14} width={136} height={132} rx={18} fill="#FFFFFF" stroke="#171717" strokeWidth={2.5} />
        <Circle cx={27} cy={31} r={4} fill={Colors.primary} />
        <Circle cx={40} cy={31} r={4} fill={Colors.textMuted} />
        <Circle cx={53} cy={31} r={4} fill={Colors.textMuted} />
        <Line x1={12} y1={46} x2={148} y2={46} stroke={Colors.divider} strokeWidth={2} />
        {[68, 98, 128].map(cy => (
          <React.Fragment key={cy}>
            <Circle cx={31} cy={cy} r={10} fill={Colors.primary} />
            <Rect x={50} y={cy - 7} width={76} height={7} rx={3.5} fill={Colors.textSecondary} />
            <Rect x={50} y={cy + 5} width={50} height={5} rx={2.5} fill={Colors.divider} />
          </React.Fragment>
        ))}
      </Svg>
      <ArtBadge size={size * 0.32} icon="business" style={{ right: -size * 0.03, bottom: -size * 0.03 }} />
    </View>
  );
}

// Слайд 3: карточка отклика с отметкой «отправлен» и самолётиком. Раньше тут
// повторялся персонаж первого слайда — слайды выглядели одинаково.
function ApplyArt({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 160 160">
        <Rect x={16} y={30} width={128} height={100} rx={18} fill="#FFFFFF" stroke="#171717" strokeWidth={2.5} />
        <Circle cx={38} cy={56} r={11} fill={Colors.primary} />
        <Rect x={56} y={49} width={64} height={7} rx={3.5} fill={Colors.textSecondary} />
        <Rect x={56} y={61} width={40} height={5} rx={2.5} fill={Colors.divider} />
        <Rect x={30} y={82} width={100} height={6} rx={3} fill={Colors.divider} />
        <Rect x={30} y={94} width={76} height={6} rx={3} fill={Colors.divider} />
        <Rect x={30} y={108} width={58} height={14} rx={7} fill={Colors.green} />
        <Line x1={37} y1={115} x2={41} y2={119} stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" />
        <Line x1={41} y1={119} x2={48} y2={111} stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" />
        <Rect x={53} y={113} width={28} height={4} rx={2} fill="#FFFFFF" />
      </Svg>
      <ArtBadge size={size * 0.32} icon="paper-plane" style={{ right: -size * 0.03, top: size * 0.02 }} />
    </View>
  );
}

// Все три картинки на одном мягком круге — разные по стилю рисунки
// читаются как одна серия.
function SlideArt({ index, size }: { index: number; size: number }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: Colors.primaryLight,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <SlideArtInner index={index} size={size * 0.86} />
    </View>
  );
}

function SlideArtInner({ index, size }: { index: number; size: number }) {
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

// 1 человек, 2–4 человека, 5+ человек; 12–14 — «человек».
function peopleWord(n: number): string {
  const d = n % 10, h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'человека' : 'человек';
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
  const [slideHeight, setSlideHeight] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);
  // Картинка занимает большую часть высоты слайда, но не съедает место
  // подписи под ней и не раздувается на высоком экране.
  const artSize = slideHeight > 0
    ? Math.max(r(90), Math.min(r(230), slideHeight * 0.6, slideHeight - r(66)))
    : r(140);

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
        {/* Растягивается на всё, что осталось между лого и кнопками: картинка
            подстраивается под доступную высоту (см. artSize), а не наоборот. */}
        <Animated.View style={[styles.carouselWrap, { opacity: introFade }]}>
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
                  const i = Math.max(0, Math.min(SLIDES.length - 1, Math.round(e.nativeEvent.contentOffset.x / slideWidth)));
                  setActiveSlide(prev => (prev === i ? prev : i));
                }}
              >
                {SLIDES.map((slide, i) => (
                  <View key={slide.key} style={[styles.slide, { width: slideWidth }]}>
                    <View style={styles.slideArt}>
                      <SlideArt index={i} size={artSize} />
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
              ? <>С нами уже <Text style={styles.userCountNum}>{userCount.toLocaleString('ru')}</Text> {peopleWord(userCount)}</>
              : 'Сообщество JobToo растёт'
            }
          </Text>
        </Animated.View>

        <View style={{ height: r(14) }} />

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

          {/* ── Второстепенное — одной тихой строкой. Карточка «Все документы»
              весила как главная кнопка, хотя это справка. ── */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              onPress={() => router.push('/register-employer')}
              testID="entry-employer"
              accessibilityLabel="Разместить вакансию"
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            >
              <Text style={styles.footerLink}>Работодателям</Text>
            </TouchableOpacity>
            <Text style={styles.footerDot}>·</Text>
            <TouchableOpacity
              onPress={() => router.push('/legal')}
              testID="entry-legal"
              accessibilityLabel="Все документы"
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            >
              <Text style={styles.footerLink}>Документы</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.version}>JobToo v{Constants.expoConfig?.version ?? '1.4.0'}</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Белый фон (решение владельца 27.09): персиковый делал экран мутным, и
  // белые кнопки на нём «плавали». Оранжевый — только акцент.
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

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
  // телефонах, лишние эффекты там же и тормозят. flex: 1 — забирает всё
  // место между лого и кнопками, картинка масштабируется под него (artSize).
  carouselWrap: { flex: 1, width: '100%', marginBottom: r(6) },
  carouselBox: { flex: 1, width: '100%' },
  slide: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: r(4),
  },
  slideArt: { alignItems: 'center', justifyContent: 'center' },
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
    backgroundColor: 'rgba(17,17,17,0.15)',
  },
  dotActive: { width: r(18), backgroundColor: Colors.primary },

  userCountCard: { alignSelf: 'center', marginTop: r(6) },
  userCountTxt: { fontSize: r(13), color: Colors.textSecondary },
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
    borderWidth: 1.5, borderColor: Colors.primaryBorder,
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

  footerRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: r(8), marginTop: r(18),
  },
  footerLink: { fontSize: r(13), fontWeight: '600', color: Colors.textSecondary },
  footerDot: { fontSize: r(13), color: Colors.textMuted },

  version: { textAlign: 'center', fontSize: r(11), color: Colors.textMuted, marginTop: r(8) },
});
