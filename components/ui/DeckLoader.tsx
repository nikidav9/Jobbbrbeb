/**
 * Загрузка ленты (03.10.2026): вместо песочных часов — карточка-заготовка в
 * стиле колоды (белая карточка, чёрный контур, «наклейка»-тень), по которой
 * бежит мягкое мерцание, и молния JT, которая «дышит». Первый запуск грузит
 * ленту долго, и пустой экран с иконкой выглядел сломанным.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { JT, JT_FONT } from '@/constants/jt';
import { rf, rs } from '@/constants/scale';
import { JTBolt } from '@/components/ui/JTBolt';

const DOTS = ['', '.', '..', '...'];

function Block({ w, h, r = 8, style, pulse }: { w: number | string; h: number; r?: number; style?: object; pulse: Animated.Value }) {
  return (
    <Animated.View
      style={[{ width: w as number, height: h, borderRadius: r, backgroundColor: JT.stack2, opacity: pulse }, style]}
    />
  );
}

export function DeckLoader({ label = 'Подбираем вакансии' }: { label?: string }) {
  const pulse = useRef(new Animated.Value(0.55)).current;
  const bolt = useRef(new Animated.Value(1)).current;
  const [dot, setDot] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setStill(!!v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (still) return;
    const shimmer = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.55, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    const breathe = Animated.loop(Animated.sequence([
      Animated.timing(bolt, { toValue: 1.18, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(bolt, { toValue: 1, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    shimmer.start();
    breathe.start();
    const t = setInterval(() => setDot(d => (d + 1) % DOTS.length), 420);
    return () => { shimmer.stop(); breathe.stop(); clearInterval(t); };
  }, [still, pulse, bolt]);

  return (
    <View style={s.wrap} accessibilityRole="progressbar" accessibilityLabel="Загружаем вакансии" testID="deck-loader">
      <View style={s.cardBox}>
        <View style={s.sticker} />
        <View style={s.card}>
          <View style={s.head}>
            <Block w={rs(44)} h={rs(44)} r={rs(11)} pulse={pulse} />
            <View style={{ flex: 1, gap: rs(7) }}>
              <Block w="55%" h={rs(14)} pulse={pulse} />
              <Block w="38%" h={rs(11)} pulse={pulse} />
            </View>
          </View>
          <Block w="86%" h={rs(22)} pulse={pulse} style={{ marginTop: rs(18) }} />
          <Block w="62%" h={rs(22)} pulse={pulse} style={{ marginTop: rs(8) }} />
          <View style={s.chips}>
            <Block w={rs(86)} h={rs(30)} r={rs(15)} pulse={pulse} />
            <Block w={rs(64)} h={rs(30)} r={rs(15)} pulse={pulse} />
            <Block w={rs(96)} h={rs(30)} r={rs(15)} pulse={pulse} />
          </View>
          <Block w="100%" h={rs(12)} pulse={pulse} style={{ marginTop: rs(22) }} />
          <Block w="94%" h={rs(12)} pulse={pulse} style={{ marginTop: rs(9) }} />
          <Block w="97%" h={rs(12)} pulse={pulse} style={{ marginTop: rs(9) }} />
          <Block w="70%" h={rs(12)} pulse={pulse} style={{ marginTop: rs(9) }} />
        </View>
      </View>
      <View style={s.caption}>
        <Animated.View style={{ transform: [{ scale: bolt }] }}>
          <JTBolt size={rs(26)} />
        </Animated.View>
        <Text style={s.captionTxt}>{label}<Text style={s.dots}>{DOTS[dot]}</Text></Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center' },
  cardBox: { width: '100%' },
  sticker: {
    position: 'absolute', left: rs(5), top: rs(5), right: -rs(5), bottom: -rs(5),
    borderRadius: rs(26), backgroundColor: JT.ink,
  },
  card: {
    borderRadius: rs(26), backgroundColor: JT.surface, borderWidth: 2, borderColor: JT.ink,
    padding: rs(20),
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: rs(12) },
  chips: { flexDirection: 'row', gap: rs(8), marginTop: rs(18), flexWrap: 'wrap' },
  caption: { flexDirection: 'row', alignItems: 'center', gap: rs(10), marginTop: rs(28) },
  captionTxt: { fontFamily: JT_FONT.head, fontSize: rf(16), color: JT.ink },
  dots: { fontFamily: JT_FONT.head, color: JT.accent },
});
