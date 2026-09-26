import React, { useState } from 'react';
import { TextInput, View, Text, StyleSheet, TextInputProps } from 'react-native';
import { Colors, Radius } from '@/constants/theme';

import { rs, rf } from '@/constants/scale';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
}

export function AppInput({ label, error, style, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[
          styles.input,
          focused && styles.focused,
          error ? styles.errBorder : null,
          style as any,
        ]}
        placeholderTextColor={Colors.textMuted}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Подпись над полем — она же его имя для экранного диктора: иначе
        // TalkBack/VoiceOver читает просто «поле ввода».
        accessibilityLabel={label}
        {...rest}
      />
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  label: {
    fontSize: rf(13),
    color: Colors.textMuted,
    fontWeight: '500',
    marginBottom: rs(8),
  },
  input: {
    backgroundColor: Colors.bg,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: Radius.md,
    paddingHorizontal: rs(16),
    paddingVertical: rs(14),
    fontSize: rf(16),
    color: Colors.textPrimary,
    width: '100%',
  },
  focused: { borderColor: Colors.primary },
  errBorder: { borderColor: Colors.red },
  err: { color: Colors.red, fontSize: rf(12), marginTop: rs(4) },
});
