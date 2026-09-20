import React from 'react';
import { Image, StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { rs } from '@/constants/scale';

/**
 * Единая марка JobToo для верхних шапок.
 *
 * Важно: размер задаётся здесь один раз. Раньше «Вакансии» рисовали PNG
 * 34×23, а «Отклики» — текстовые J/T размером 26, поэтому логотип визуально
 * прыгал между вкладками. Теперь все шапки используют один и тот же asset и
 * один и тот же размер.
 */
export const APP_HEADER_HORIZONTAL = 16;
export const APP_HEADER_TOP = 10;
export const APP_HEADER_BOTTOM = 10;
export const APP_HEADER_CONTROL = 44;
export const APP_HEADER_GAP = 10;
export const BRAND_LOGO_WIDTH = 44;
export const BRAND_LOGO_HEIGHT = 30;

/**
 * Общая «линейка» верхней шапки.
 *
 * Любой главный экран использует этот контейнер: одинаковые safe-area
 * отступы уже даёт SafeAreaView, а здесь фиксируем левый/правый край,
 * высоту контролов и вертикальные отступы. Поэтому логотип и кнопки больше
 * не прыгают между «Вакансии», «Отклики» и «Профиль».
 */
export function AppHeaderRow({
  children,
  backgroundColor,
  borderBottom = false,
  style,
}: {
  children: React.ReactNode;
  backgroundColor?: string;
  borderBottom?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        s.headerRow,
        backgroundColor ? { backgroundColor } : null,
        borderBottom ? s.headerBorder : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function BrandLogo() {
  return (
    <View
      style={s.box}
      accessibilityLabel="JobToo"
      accessibilityRole="image"
    >
      <Image
        source={require('@/assets/images/header-jt-logo.png')}
        style={s.image}
        resizeMode="contain"
      />
    </View>
  );
}

const s = StyleSheet.create({
  headerRow: {
    minHeight: rs(APP_HEADER_CONTROL + APP_HEADER_TOP + APP_HEADER_BOTTOM),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: rs(APP_HEADER_HORIZONTAL),
    paddingTop: rs(APP_HEADER_TOP),
    paddingBottom: rs(APP_HEADER_BOTTOM),
  },
  headerBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  box: {
    width: rs(BRAND_LOGO_WIDTH),
    height: rs(APP_HEADER_CONTROL),
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: rs(BRAND_LOGO_WIDTH),
    height: rs(BRAND_LOGO_HEIGHT),
  },
});
