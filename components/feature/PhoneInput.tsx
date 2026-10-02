import React, { useRef, useEffect } from 'react';
import { TextInput, StyleSheet, View, Text } from 'react-native';
import { Colors } from '@/constants/theme';
import { isPhoneComplete } from '@/services/storage';

import { rs, rf } from '@/constants/scale';

import { JT_FONT } from '@/constants/jt';
interface Props {
  value: string; // formatted string like "+7 (999) 123-45-67"
  onChange: (formatted: string) => void;
  error?: string;
}

/**
 * Phone input with automatic +7 prefix and mask +7 (XXX) XXX-XX-XX
 */
export function PhoneInput({ value, onChange, error }: Props) {
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Initialize with +7 if empty
    if (!value) onChange('+7 ');
  }, []);

  const handleChange = (text: string) => {
    // Extract digits only
    const digits = text.replace(/\D/g, '');
    // Ensure starts with 7
    let normalized: string;
    if (digits.length === 0) {
      normalized = '';
    } else if (digits[0] === '7' || digits[0] === '8') {
      normalized = '7' + digits.slice(1, 11);
    } else {
      normalized = '7' + digits.slice(0, 10);
    }
    const formatted = buildMask(normalized);
    onChange(formatted);
  };

  return (
    <View>
      <TextInput
        ref={inputRef}
        style={[styles.input, error ? styles.inputError : null]}
        value={value}
        onChangeText={handleChange}
        keyboardType="phone-pad"
        placeholder="+7 (___) ___-__-__"
        placeholderTextColor={Colors.textMuted}
        maxLength={18}
        autoFocus
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function buildMask(digits: string): string {
  // digits always starts with 7, up to 11 chars
  const d = digits.startsWith('7') ? digits.slice(1) : digits;
  const local = d.slice(0, 10);
  let result = '+7';
  if (local.length === 0) return result + ' ';
  result += ' (';
  result += local.slice(0, 3);
  if (local.length <= 3) return result;
  result += ') ';
  result += local.slice(3, 6);
  if (local.length <= 6) return result;
  result += '-';
  result += local.slice(6, 8);
  if (local.length <= 8) return result;
  result += '-';
  result += local.slice(8, 10);
  return result;
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: Colors.bg,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: rs(12),
    paddingHorizontal: rs(16),
    paddingVertical: rs(14),
    fontFamily: JT_FONT.medium, fontSize: rf(18),
    color: Colors.textPrimary,
    letterSpacing: 1,
  },
  inputError: {
    borderColor: Colors.red,
  },
  error: {
    color: Colors.red,
    fontFamily: JT_FONT.medium, fontSize: rf(12),
    marginTop: rs(4),
  },
});
