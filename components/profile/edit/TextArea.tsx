import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import { FieldLabel } from './FieldLabel';

/** Многострочное поле со счётчиком символов справа снизу. */
export function TextArea({
  label, optional, value, onChangeText, maxLength, placeholder, minHeight = 120,
}: {
  label?: string;
  optional?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  maxLength: number;
  placeholder?: string;
  minHeight?: number;
}) {
  const [focused, setFocused] = useState(false);
  const filled = value.length > 0;
  const showShadow = focused;

  return (
    <View style={{ gap: 8 }}>
      {label ? <FieldLabel label={label} optional={optional} /> : null}
      <View>
        {showShadow ? <View pointerEvents="none" style={s.shadowBacking} /> : null}
        <View style={[s.box, { minHeight }, filled && s.filled, showShadow && s.focused]}>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={EditColors.placeholder}
            maxLength={maxLength}
            multiline
            textAlignVertical="top"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={s.input}
          />
          <Text style={s.counter}>{value.length} / {maxLength}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    borderRadius: EditRadius.field, padding: 14, paddingBottom: 22,
    borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface,
  },
  filled: { borderWidth: 2, borderColor: EditColors.ink },
  focused: { borderWidth: 2, borderColor: EditColors.ink },
  shadowBacking: {
    position: 'absolute', top: 3, left: 3, right: -3, bottom: -3,
    backgroundColor: EditColors.accent, borderRadius: EditRadius.field,
  },
  input: { flex: 1, fontFamily: EditFonts.text600, fontSize: 16, color: EditColors.ink, padding: 0 },
  counter: {
    position: 'absolute', right: 14, bottom: 8,
    fontFamily: EditFonts.text700, fontSize: 12, color: EditColors.textTertiary,
  },
});
