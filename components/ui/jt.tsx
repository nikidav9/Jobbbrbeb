/**
 * Элементы макета «JT-auth-and-details» (27.09.2026): главная кнопка-«наклейка»,
 * поле ввода, полоска шагов, галочка и подчёркнутая ссылка. Размеры — из README
 * макета: поле и кнопка 58 с контуром 2 и скруглением 18, тень кнопки 4/4 без
 * размытия, галочка 26×26 со скруглением 8, полоска 8 с зазором 6.
 */
import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
  type TextInputProps, type StyleProp, type ViewStyle, type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';

export const JT_ERROR = '#D93A1F';

/** Круглая кнопка «назад» в духе макета: белая, контур 2, без мягкой тени. */
export const jtBackStyle: ViewStyle = {
  borderWidth: 2, borderColor: JT.ink,
  shadowOpacity: 0, elevation: 0,
};

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  arrow?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/** Оранжевая кнопка с чёрным контуром и жёсткой тенью; неактивная — плоская. */
export function JTButton({ label, onPress, disabled, busy, arrow = true, testID, style }: ButtonProps) {
  const off = disabled || busy;
  return (
    <View style={[s.btnWrap, style]}>
      {!off ? <View style={s.btnShadow} pointerEvents="none" /> : null}
      <TouchableOpacity
        testID={testID}
        style={[s.btn, off && s.btnOff]}
        onPress={onPress}
        disabled={off}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!off, busy: !!busy }}
      >
        {busy ? <ActivityIndicator color={JT.ink} /> : (
          <>
            <Text style={[s.btnTxt, off && s.btnTxtOff]}>{label}</Text>
            {arrow ? <Ionicons name="arrow-forward" size={rs(20)} color={off ? '#9A9086' : JT.ink} /> : null}
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

type InputProps = TextInputProps & { label?: string; error?: string };

export function JTInput({ label, error, style, ...rest }: InputProps) {
  return (
    <View style={s.field}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor="#9A9086"
        {...rest}
        style={[s.input, !!error && s.inputErr, style]}
      />
      {error ? <Text style={s.err}>{error}</Text> : null}
    </View>
  );
}

/** Полоска шагов: закрашено `step` сегментов из `total`, справа «N из M». */
export function JTProgress({ step, total }: { step: number; total: number }) {
  return (
    <View style={s.progRow} accessibilityLabel={`Шаг ${step} из ${total}`}>
      <View style={s.progBars}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[s.progSeg, i < step && s.progSegOn]} />
        ))}
      </View>
      <Text style={s.progTxt}>{step} из {total}</Text>
    </View>
  );
}

export function JTCheck({ checked }: { checked: boolean }) {
  return (
    <View style={[s.check, checked && s.checkOn]}>
      {checked ? <Ionicons name="checkmark" size={rs(16)} color={JT.ink} /> : null}
    </View>
  );
}

/** Ссылка внутри текста: жирная, с оранжевым подчёркиванием. */
export function JTLink({ children, onPress, style, testID }: {
  children: React.ReactNode; onPress: () => void; style?: StyleProp<TextStyle>; testID?: string;
}) {
  return (
    <Text testID={testID} style={[s.link, style]} onPress={onPress} accessibilityRole="link" suppressHighlighting>
      {children}
    </Text>
  );
}

const s = StyleSheet.create({
  btnWrap: { height: rs(58) },
  btnShadow: {
    position: 'absolute', left: rs(4), top: rs(4), right: -rs(4), bottom: -rs(4),
    borderRadius: rs(18), backgroundColor: JT.ink,
  },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(8),
    borderRadius: rs(18), borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.accent,
  },
  btnOff: { backgroundColor: JT.stack2, borderColor: JT.stack2 },
  btnTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(18), color: JT.ink },
  btnTxtOff: { color: '#9A9086' },

  field: { gap: rs(8) },
  label: { fontFamily: JT_FONT.bold, fontSize: rf(14), color: JT.textBody },
  input: {
    height: rs(58), paddingHorizontal: rs(18), borderRadius: rs(18),
    borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
    fontFamily: JT_FONT.bold, fontSize: rf(17), color: JT.ink,
  },
  inputErr: { borderColor: JT_ERROR },
  err: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT_ERROR },

  progRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: rs(14) },
  progBars: { flex: 1, flexDirection: 'row', gap: rs(6) },
  progSeg: {
    flex: 1, height: rs(8), borderRadius: rs(4),
    backgroundColor: JT.stack2, borderWidth: 1.5, borderColor: JT.stack2,
  },
  progSegOn: { backgroundColor: JT.accent, borderColor: JT.ink },
  progTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(13), color: JT.textTertiary },

  check: {
    width: rs(26), height: rs(26), borderRadius: rs(8), marginTop: 1,
    borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: JT.accent },

  link: {
    fontFamily: JT_FONT.heavy, color: JT.ink,
    textDecorationLine: 'underline', textDecorationColor: JT.accent,
  },
});
