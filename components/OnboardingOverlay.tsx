import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Modal, Animated, Easing,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getOnboardingTarget, getOnboardingFlag, subscribeOnboardingTargets, measureOnboardingTargets } from '@/lib/onboardingTargets';
import { LavkaLogo } from '@/components/ui/LavkaLogo';

import { rs, rf } from '@/constants/scale';

const KEY = (uid: string) => `jm_onboarding_done_${uid}`;

// Подписка, чтобы «Показать обучение снова» из профиля мгновенно перезапускало оверлей
const replayListeners = new Set<() => void>();

// Кто ждёт окончания обучения. Предложение включить уведомления показывается
// только после него — иначе два окна наезжают друг на друга при первом входе.
const doneListeners = new Set<() => void>();

/** Обучение уже пройдено этим пользователем? */
export async function isOnboardingDone(uid: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEY(uid))) === '1'; } catch { return true; }
}

/** Позвать, когда обучение завершится. Возвращает функцию отписки. */
export function onOnboardingDone(cb: () => void): () => void {
  doneListeners.add(cb);
  return () => doneListeners.delete(cb);
}

// Внешний ключ — сбрасывает флаг и просит смонтированный оверлей показаться заново
export async function resetOnboarding(uid: string) {
  try { await AsyncStorage.removeItem(KEY(uid)); } catch {}
  replayListeners.forEach(fn => fn());
}

type Rect = { x: number; y: number; w: number; h: number };
type Step = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  spot?: Rect;          // подсветка элемента; нет → центрированный экран-приветствие
  hint: 'below' | 'above' | 'center';
  demo?: boolean;       // шаг про свайп: при отсутствии реальной карточки показываем демо
};

/**
 * Плавно пульсирующее кольцо вокруг подсвеченного элемента: расходится и
 * гаснет, как круги по воде. Один и тот же указатель на всех шагах, чтобы
 * подсказка читалась одинаково.
 */
function PulseRing({ rect, radius }: { rect: Rect; radius: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1, duration: 1250, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.delay(220),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const common = {
    position: 'absolute' as const,
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    borderRadius: radius,
    borderWidth: 2.5,
    borderColor: Colors.primary,
  };

  return (
    // absoluteFill обязателен: у View без размеров Android обрезает
    // абсолютных детей, выходящих за его границы, — кольцо бы пропало
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* постоянный контур — видно, что именно выделено */}
      <View style={[common, { opacity: 0.95 }]} />
      {/* расходящееся кольцо */}
      <Animated.View
        style={[common, {
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
        }]}
      />
    </View>
  );
}

export function OnboardingOverlay() {
  const app = useApp();
  const user = app?.currentUser ?? null;
  const insets = useSafeAreaInsets();
  // useWindowDimensions, а не Dimensions.get: размер окна меняется — поворот
  // экрана, разделённый экран на планшете, изменение окна браузера, — и
  // подсветка должна переехать вместе с кнопкой, а не остаться где была.
  const { width: W, height: H } = useWindowDimensions();

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [, force] = useState(0);

  // Элементы сообщают геометрию через measureInWindow — это координаты ОКНА.
  // Оверлей живёт в модальном окне, которое тоже занимает всё окно целиком,
  // поэтому пересчитывать ничего не нужно: замеры ложатся один в один.
  //
  // Раньше оверлей висел внутри контейнера вкладок и вычитал собственное
  // положение. Стоило этому положению разойтись с ожидаемым — а оно зависит
  // от устройства и от того, кто рисует отступы, — и подсветка уезжала мимо
  // кнопки. На скриншотах кольцо стояло выше и левее «плюса».

  // Перерисовка, когда элементы сообщают свои измеренные позиции
  useEffect(() => subscribeOnboardingTargets(() => force(n => n + 1)), []);

  // И просим перемерить в тот момент, когда собираемся рисовать. Первый
  // замер при раскладке нередко приходит с нулями — тогда цели просто нет,
  // и шаг оставался без подсветки. Второй раз с задержкой: на Android
  // отступы применяются позже первой раскладки.
  useEffect(() => {
    if (!visible) return;
    measureOnboardingTargets();
    const t = setTimeout(measureOnboardingTargets, 300);
    return () => clearTimeout(t);
  }, [visible, step]);

  useEffect(() => {
    // Гостю онбординг не показываем: он листает ленту на просмотр, а обучение
    // «откликайся свайпом» про действие, которого у гостя нет. Увидит после
    // регистрации.
    if (!user || user.isGuest) { setVisible(false); return; }
    let cancelled = false;
    AsyncStorage.getItem(KEY(user.id)).then(v => {
      if (!cancelled && !v) { setStep(0); setVisible(true); }
    }).catch(() => {});
    const replay = () => { setStep(0); setVisible(true); };
    replayListeners.add(replay);
    return () => { cancelled = true; replayListeners.delete(replay); };
  }, [user?.id]);

  if (!visible || !user || user.isGuest) return null;

  const isWorker = user.role === 'worker';
  const top = insets.top;

  // Позиции элементов — только по замеру, без запасных расчётов.
  //
  // Запасные значения тут были хуже, чем их отсутствие: они вычислялись по
  // размеру экрана и предполагали одну конкретную вёрстку. На чужом
  // устройстве кольцо вставало мимо кнопки, но с уверенным видом. Не
  // измерено — значит подсветки нет и подсказка просто стоит по центру.
  const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 });
  const measured = (key: string, p = 6): Rect | undefined => {
    const t = getOnboardingTarget(key);
    return t && t.w > 0 && t.h > 0 ? pad(t, p) : undefined;
  };

  const rFab = measured('fab');
  const rTelegram = measured('telegram');
  const rMatchesTab = measured('matchesTab', 4);

  // Есть ли реальная карточка смены. Если нет — рисуем демо-карточку сами,
  // и вот ей размеры придумать можно: это наша картинка, а не чужая кнопка.
  const hasRealCard = getOnboardingFlag('hasShiftCard') !== false;
  const cardTarget = getOnboardingTarget('card');
  const rCard: Rect | undefined = hasRealCard
    ? (cardTarget ? pad(cardTarget, 4) : undefined)
    : { x: 24, y: top + 158, w: W - 48, h: 208 };

  const steps: Step[] = isWorker
    ? [
        { icon: 'hand-left', title: `Привет, ${user.firstName}! 👋`, hint: 'center',
          body: 'Это JobToo — постоянная работа рядом с домом. Покажем за 20 секунд, куда нажимать.' },
        { icon: 'heart', title: 'Откликайся свайпом', spot: rCard, hint: 'below', demo: !hasRealCard,
          body: 'Свайп карточки вправо или ❤️ — откликнуться на вакансию. Влево — пропустить.' },
        { icon: 'people', title: 'Твои отклики', spot: rMatchesTab, hint: 'above',
          body: 'Вкладка «Отклики»: здесь ответы работодателей и статусы твоих заявок.' },
        { icon: 'notifications', title: 'Не пропусти смену', spot: rTelegram, hint: 'below',
          body: 'Привяжи Telegram и включи уведомления — о новых вакансиях рядом узнаешь первым.' },
      ]
    : [
        { icon: 'hand-left', title: `Привет, ${user.firstName}! 👋`, hint: 'center',
          body: 'Это JobToo — публикуйте вакансии, кандидаты рядом откликнутся. Покажем, куда нажимать.' },
        { icon: 'add-circle', title: 'Создать вакансию', spot: rFab, hint: 'above',
          body: 'Кнопка «+» — опубликовать вакансию за минуту.' },
        { icon: 'people', title: 'Отклики кандидатов', spot: rMatchesTab, hint: 'above',
          body: 'Вкладка «Отклики»: сюда падают заявки. Одобряйте или отклоняйте в один тап.' },
        { icon: 'notifications', title: 'Отвечайте быстрее', spot: rTelegram, hint: 'below',
          body: 'Привяжите Telegram — отклики придут с кнопками, отвечайте не заходя в приложение.' },
      ];

  const s = steps[step];
  const isLast = step === steps.length - 1;

  const finish = () => {
    AsyncStorage.setItem(KEY(user.id), '1').catch(() => {});
    setVisible(false);
    doneListeners.forEach(fn => fn());
  };
  const next = () => { if (isLast) finish(); else setStep(step + 1); };

  // Карточка-подсказка: над или под подсветкой, не перекрывая подсвеченный
  // элемент. Сторону выбираем по свободному месту, а не по тому, что записано
  // в шаге: на маленьком экране «снизу» может не остаться места вовсе, и
  // подсказка накрыла бы собой то, на что показывает.
  //
  // Для верхнего положения прижимаем НИЗ карточки к элементу: высота её
  // зависит от длины текста и от размера шрифта на устройстве, а низ известен.
  const cardW = W - 40;
  const CARD_MIN = 300;
  const below = s.spot ? H - (s.spot.y + s.spot.h) >= CARD_MIN : false;
  const cardPos: { top?: number; bottom?: number } =
    (!s.spot || s.hint === 'center')
      ? { top: Math.max(insets.top + 24, H / 2 - 170) }
      : below
      ? { top: s.spot.y + s.spot.h + 16 }
      : { bottom: Math.max(H - s.spot.y + 16, insets.bottom + 20) };

  // Радиус подсветки: круглым кнопкам — круг, широким блокам — мягкое скругление
  const spotRadius = (r: Rect) =>
    Math.abs(r.w - r.h) < 14 ? Math.max(r.w, r.h) / 2 : 18;

  // Путь скруглённого прямоугольника — им вырезаем «дырку» в затемнении
  const roundedRect = (x: number, y: number, w: number, h: number, rad: number) => {
    const r = Math.max(0, Math.min(rad, w / 2, h / 2));
    return `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r}`
      + ` V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
      + ` H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r}`
      + ` V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
  };

  // Затемнение с вырезом: рисуем одним SVG-путём с правилом evenodd, поэтому
  // «дырка» получается скруглённой, а не квадратной. В демо-режиме (реальной
  // карточки нет) выреза не делаем — иначе за демо-карточкой просвечивает фон.
  const dim = 'rgba(17,17,17,0.72)';
  const Spot = () => {
    if (!s.spot || s.demo) return <View style={[StyleSheet.absoluteFill, { backgroundColor: dim }]} />;
    const { x, y, w, h } = s.spot;
    return (
      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path
          d={`M0 0 H${W} V${H} H0 Z ` + roundedRect(x, y, w, h, spotRadius(s.spot))}
          fill={dim}
          fillRule="evenodd"
        />
      </Svg>
    );
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent
      navigationBarTranslucent onRequestClose={finish}>
      <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      <Spot />

      {/* Демо-карточка смены — когда на выбранную дату реальных смен нет */}
      {s.demo && s.spot ? (
        <View style={[dc.card, { left: s.spot.x, top: s.spot.y, width: s.spot.w, height: s.spot.h }]}>
          <View style={dc.top}>
            <LavkaLogo size={38} />
            <View style={{ flex: 1 }}>
              <Text style={dc.company}>Лавка</Text>
              <View style={dc.metroRow}>
                <Ionicons name="subway-outline" size={12} color={Colors.textMuted} />
                <Text style={dc.metro}>м. Сокол</Text>
              </View>
            </View>
            <View style={dc.urgent}><Text style={dc.urgentTxt}>Пример</Text></View>
          </View>
          <Text style={dc.title}>Кладовщик</Text>
          <View style={dc.chips}>
            <View style={dc.chip}><Text style={dc.chipTxt}>🕐 09:00–18:00</Text></View>
            <View style={dc.chip}><Text style={dc.chipTxt}>💰 2 500 ₽</Text></View>
          </View>
          <View style={dc.actions}>
            <View style={[dc.actionBtn, { backgroundColor: '#FEE2E2' }]}><Ionicons name="close" size={20} color={Colors.red} /></View>
            <View style={[dc.actionBtn, { backgroundColor: Colors.primary }]}><Ionicons name="heart" size={20} color="#fff" /></View>
          </View>
        </View>
      ) : null}

      {/* Пульсирующее кольцо на элементе — единый указатель «нажми сюда».
          Рисуем после демо-карточки, иначе она бы его перекрыла. */}
      {s.spot ? <PulseRing rect={s.spot} radius={spotRadius(s.spot)} /> : null}

      {/* Пропустить */}
      <View style={[st.skipWrap, { top: top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity
          style={st.skip}
          onPress={finish}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={st.skipTxt}>Пропустить</Text>
        </TouchableOpacity>
      </View>

      {/* Карточка-подсказка */}
      <View style={[st.card, { left: 20, width: cardW, ...cardPos }]}>
        <View style={st.iconWrap}><Ionicons name={s.icon} size={22} color="#fff" /></View>
        <Text style={st.title}>{s.title}</Text>
        <Text style={st.body}>{s.body}</Text>

        <View style={st.dots}>
          {steps.map((_, i) => (
            <View key={i} style={[st.dot, i === step && st.dotActive]} />
          ))}
        </View>

        <TouchableOpacity style={st.btn} onPress={next} activeOpacity={0.85}>
          <Text style={st.btnTxt}>{isLast ? 'Понятно, начать!' : 'Далее'}</Text>
        </TouchableOpacity>
      </View>
      </View>
    </Modal>
  );
}

const dc = StyleSheet.create({
  card: {
    position: 'absolute', backgroundColor: '#fff', borderRadius: rs(18),
    padding: rs(14), justifyContent: 'flex-start', gap: rs(10),
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14, shadowRadius: 16, elevation: 10,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  company: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  metroRow: { flexDirection: 'row', alignItems: 'center', gap: rs(4), marginTop: rs(2) },
  metro: { fontSize: rf(12), color: Colors.textMuted },
  urgent: { backgroundColor: '#FEF3C7', borderRadius: rs(8), paddingHorizontal: rs(8), paddingVertical: rs(4) },
  urgentTxt: { fontSize: rf(11), fontWeight: '700', color: '#92400E' },
  title: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary },
  chips: { flexDirection: 'row', gap: rs(8) },
  chip: { backgroundColor: '#F4F4F5', borderRadius: rs(10), paddingHorizontal: rs(10), paddingVertical: rs(6) },
  chipTxt: { fontSize: rf(13), fontWeight: '600', color: Colors.textSecondary },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: rs(24), marginTop: rs(4) },
  actionBtn: { width: rs(44), height: rs(44), borderRadius: rs(22), alignItems: 'center', justifyContent: 'center' },
});

const st = StyleSheet.create({
  skipWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  skip: {
    paddingHorizontal: rs(16), paddingVertical: rs(6),
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: rs(100),
  },
  skipTxt: { color: '#fff', fontSize: rf(13), fontWeight: '600' },
  card: {
    position: 'absolute', backgroundColor: '#fff', borderRadius: rs(20),
    padding: rs(20), shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2, shadowRadius: 24, elevation: 16,
  },
  iconWrap: {
    width: rs(44), height: rs(44), borderRadius: rs(14), backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: rs(12),
  },
  title: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary, marginBottom: rs(6) },
  body: { fontSize: rf(14), color: Colors.textSecondary, lineHeight: rf(20) },
  dots: { flexDirection: 'row', gap: rs(6), marginTop: rs(16), marginBottom: rs(14) },
  dot: { width: rs(7), height: rs(7), borderRadius: rs(4), backgroundColor: '#E4E4E7' },
  dotActive: { backgroundColor: Colors.primary, width: rs(20) },
  btn: {
    backgroundColor: Colors.primary, borderRadius: rs(100),
    paddingVertical: rs(13), alignItems: 'center',
  },
  btnTxt: { color: '#fff', fontSize: rf(15), fontWeight: '700' },
});
