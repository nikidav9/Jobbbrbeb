import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
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
export const BRAND_LOGO_WIDTH = 44;
export const BRAND_LOGO_HEIGHT = 30;

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
