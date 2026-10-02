import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ToastType } from '@/contexts/AppContext';
import { JT, JT_FONT } from '@/constants/jt';
import { JT_ERROR } from './jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { stripEmoji } from '@/lib/stripEmoji';
import { rs, rf } from '@/constants/scale';

interface Props {
  message: string;
  type: ToastType;
  visible: boolean;
}

/**
 * Плашка о результате действия в стиле JT (01.10.2026): белая карточка с
 * чёрным контуром и жёсткой тенью, как окно «да/нет». Вид события — иконкой
 * в кружке, без эмодзи: раньше перед каждым текстом стоял ✅/❌/ℹ️/🎉, а с
 * эмодзи внутри самих сообщений выходило «🎉 🎉 Мэтч».
 */
const ICON: Record<ToastType, { name: React.ComponentProps<typeof Ionicons>['name']; bg: string; fg: string }> = {
  success: { name: 'checkmark', bg: JT.accent, fg: JT.ink },
  match: { name: 'checkmark-done', bg: JT.accent, fg: JT.ink },
  info: { name: 'information', bg: JT.accentSoft, fg: JT.ink },
  error: { name: 'alert', bg: JT_ERROR, fg: '#FFFFFF' },
};

export function Toast({ message, type, visible }: Props) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(-120)).current;
  const top = insets.top + rs(12);

  useEffect(() => {
    if (visible) {
      Animated.spring(anim, { toValue: top, useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: -120, duration: 200, useNativeDriver: true }).start();
    }
  }, [visible, top]);

  const icon = ICON[type] ?? ICON.info;
  return (
    <Animated.View
      pointerEvents="none"
      style={[s.container, { transform: [{ translateY: anim }] }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <HardShadowBox offset={3} radius={rs(18)}>
        <View style={s.card}>
          <View style={[s.icon, { backgroundColor: icon.bg }]}>
            <Ionicons name={icon.name} size={rf(16)} color={icon.fg} />
          </View>
          <Text style={s.text}>{stripEmoji(message)}</Text>
        </View>
      </HardShadowBox>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute', top: 0, left: rs(16), right: rs(16), zIndex: 999,
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    maxWidth: 480, backgroundColor: JT.surface,
    borderRadius: rs(18), borderWidth: 2, borderColor: JT.ink,
    paddingVertical: rs(12), paddingLeft: rs(12), paddingRight: rs(16),
  },
  icon: {
    width: rs(28), height: rs(28), borderRadius: rs(14), borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  text: { flexShrink: 1, fontFamily: JT_FONT.bold, fontSize: rf(15), lineHeight: rf(20), color: JT.ink },
});
