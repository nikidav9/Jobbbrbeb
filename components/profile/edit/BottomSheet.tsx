import React, { useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback, Animated, PanResponder, StyleSheet,
} from 'react-native';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import { CloseIcon } from './icons';

/**
 * Нижняя шторка (email, телефон, списки выбора): затемнение фона, белая
 * панель со скруглением сверху, «ручка», крестик. Закрывается тапом по
 * затемнению или свайпом вниз.
 *
 * PanResponder вместо reanimated-жестов: на вебе жест-хендлеры reanimated не
 * всегда надёжны, а `Animated` + `PanResponder` — часть `react-native`,
 * работает одинаково на всех трёх поверхностях.
 */
export function BottomSheet({
  visible, onClose, title, children, height, backgroundColor,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  /** Фиксированная высота шторки (например, `'90%'`); по умолчанию — по содержимому. */
  height?: number | `${number}%`;
  /** Фон панели; по умолчанию белый. */
  backgroundColor?: string;
}) {
  const translateY = useRef(new Animated.Value(0)).current;

  // PanResponder создаётся один раз — держим актуальный onClose в ref, иначе
  // замыкание навсегда получает onClose первого рендера (закрывает шторку
  // без вопроса о несохранённом, если onClose с тех пор сменился на requestClose).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 100 || gesture.vy > 1) {
          Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: true }).start(() => {
            translateY.setValue(0);
            onCloseRef.current();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        }
      },
    }),
  ).current;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay} />
      </TouchableWithoutFeedback>
      <Animated.View style={[
        s.sheet,
        height !== undefined && { height },
        backgroundColor ? { backgroundColor } : null,
        { transform: [{ translateY }] },
      ]} {...panResponder.panHandlers}>
        <View style={s.handle} />
        {title ? (
          <View style={s.header}>
            <Text style={s.title} numberOfLines={1}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityLabel="Закрыть" accessibilityRole="button">
              <CloseIcon size={16} />
            </TouchableOpacity>
          </View>
        ) : null}
        {children}
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: EditColors.overlay },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34,
    borderTopLeftRadius: EditRadius.sheet, borderTopRightRadius: EditRadius.sheet,
    borderTopWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.surface,
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: EditColors.border },
  header: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, minWidth: 0, fontFamily: EditFonts.heading, fontSize: 19, color: EditColors.ink },
  closeBtn: {
    flexShrink: 0, width: 40, height: 40, borderRadius: 20,
    borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
});
