/**
 * Единая кнопка «назад» (решение владельца 26.09): белый круг с мягкой тенью
 * и стрелкой ‹ — так, как она уже выглядела в «Настройках».
 *
 * До этого на двадцати экранах было пять разных вариантов: «← Назад»
 * текстом, стрелки разных размеров, символ «‹». Новый экран берёт эту.
 *
 * Без onPress — шаг назад по истории. Если истории нет (сайт или
 * мини-приложение открыли по прямой ссылке), router.back() не делает ничего,
 * и человек застревает на экране; тогда уводим на `fallback`, по умолчанию —
 * на главную.
 */
import React from 'react';
import { TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { Colors, Shadow } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';

/** Размер кнопки — для пустого места напротив неё, чтобы заголовок стоял по центру. */
export const BACK_BUTTON_SIZE = rs(44);

type Props = {
  onPress?: () => void;
  fallback?: Href;
  style?: StyleProp<ViewStyle>;
  /** Подпись для читалок экрана; «Назад» подходит почти всегда. */
  label?: string;
  testID?: string;
};

export function BackButton({ onPress, fallback = '/(tabs)', style, label = 'Назад', testID }: Props) {
  const router = useRouter();
  const goBack = () => {
    if (onPress) { onPress(); return; }
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  };
  return (
    <TouchableOpacity
      style={[styles.btn, style]}
      onPress={goBack}
      activeOpacity={0.72}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID ?? 'back-button'}
    >
      <Ionicons name="chevron-back" size={rf(24)} color={Colors.textPrimary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: BACK_BUTTON_SIZE,
    height: BACK_BUTTON_SIZE,
    borderRadius: BACK_BUTTON_SIZE / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },
});
