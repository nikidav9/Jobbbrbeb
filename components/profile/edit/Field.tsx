import React, { useState } from 'react';
import { View, TextInput, TextInputProps, StyleSheet } from 'react-native';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import { FieldLabel } from './FieldLabel';

/**
 * Поле ввода: пустое — контур 1.5 `border`, заполненное — контур 2 `ink`,
 * в фокусе — контур 2 + жёсткая тень 3/3 `accent` (эталон
 * `docs/design/profile-edit/resume/01-desired-position.html`).
 */
export function Field({
  label, optional, value, onChangeText, placeholder, disabled, left, right, inputRef, autoFocus, keyboardType,
  ...rest
}: {
  label?: string;
  optional?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  left?: React.ReactNode;
  right?: React.ReactNode;
  inputRef?: React.Ref<TextInput>;
  autoFocus?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'placeholder' | 'editable' | 'autoFocus' | 'keyboardType'>) {
  const [focused, setFocused] = useState(false);
  const filled = value.length > 0;

  const showShadow = focused && !disabled;

  return (
    <View style={{ gap: 8 }}>
      {label ? <FieldLabel label={label} optional={optional} /> : null}
      <View>
        {showShadow ? (
          // Жёсткая тень без размытия: подложка-View того же радиуса, сдвинутая
          // на offset — как в HardShadowCard, а не shadow* (на Android всегда
          // размыт elevation).
          <View pointerEvents="none" style={s.shadowBacking} />
        ) : null}
        <View style={[s.box, filled && s.filled, showShadow && s.focused, disabled && s.disabled]}>
          {left}
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={EditColors.placeholder}
            editable={!disabled}
            autoFocus={autoFocus}
            keyboardType={keyboardType}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[s.input, disabled && s.inputDisabled]}
            {...rest}
          />
          {right}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    height: 56, borderRadius: EditRadius.field, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  filled: { borderWidth: 2, borderColor: EditColors.ink },
  focused: { borderWidth: 2, borderColor: EditColors.ink },
  shadowBacking: {
    position: 'absolute', top: 3, left: 3, right: -3, bottom: -3,
    backgroundColor: EditColors.accent, borderRadius: EditRadius.field,
  },
  disabled: { backgroundColor: EditColors.fieldDisabledBg, borderWidth: 1.5, borderColor: EditColors.borderSoft },
  input: {
    flex: 1, minWidth: 0, fontFamily: EditFonts.text600, fontSize: 16, color: EditColors.ink, padding: 0,
  },
  inputDisabled: { color: EditColors.textTertiary },
});
