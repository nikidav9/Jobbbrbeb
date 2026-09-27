import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  ScrollView, Dimensions, Platform,
} from 'react-native';
import { Image } from 'expo-image';
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

        {/* ── Иллюстрация ── */}
        <Animated.View style={[styles.artWrap, { opacity: introFade }]}>
          <Image
            source={require('@/assets/images/char-worker-crop.png')}
            style={styles.art}
            contentFit="contain"
            transition={200}
          />
        </Animated.View>

        {/* ── Заголовок ── */}
        <Animated.View style={[styles.headlineBlock, { opacity: introFade }]}>
          <Text style={styles.headline}>Постоянная IT-работа в Москве — одним свайпом</Text>
          <Text style={styles.headlineSub}>Вакансии компаний напрямую. Откликайтесь в один жест.</Text>
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

  // Иллюстрация — спокойная, без теней и градиентов: аудитория на дешёвых
  // телефонах, лишние эффекты там же и тормозят.
  artWrap: { marginBottom: r(8) },
  art: { width: r(122), height: r(159) },

  headlineBlock: { alignItems: 'center', marginBottom: r(14) },
  headline: {
    fontSize: r(24), fontWeight: '800', color: '#111111', lineHeight: r(30),
    textAlign: 'center',
  },
  headlineSub: {
    fontSize: r(13.5), color: Colors.textSecondary,
    marginTop: r(6), lineHeight: r(18), textAlign: 'center',
  },

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
