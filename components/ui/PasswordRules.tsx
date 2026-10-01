import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { PASSWORD_RULES } from '@/constants/passwordRules';

import { rs, rf } from '@/constants/scale';

import { JT_FONT } from '@/constants/jt';
/**
 * Список требований к паролю под полем ввода.
 *
 * Пункт загорается зелёным, как только выполнен, — человек видит, чего не
 * хватает, ещё до нажатия кнопки, а не получает отказ постфактум.
 */
export function PasswordRules({ password }: { password: string }) {
  return (
    <View style={s.wrap}>
      {PASSWORD_RULES.map(rule => {
        const done = rule.ok(password);
        return (
          <View key={rule.id} style={s.row}>
            <Ionicons
              name={done ? 'checkmark-circle' : 'ellipse-outline'}
              size={15}
              color={done ? Colors.green : Colors.textMuted}
            />
            <Text style={[s.label, done && s.labelDone]}>{rule.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: rs(6), marginTop: rs(-4) },
  row: { flexDirection: 'row', alignItems: 'center', gap: rs(7) },
  label: { fontFamily: JT_FONT.medium, fontSize: rf(13), color: Colors.textMuted },
  labelDone: { color: Colors.green, fontFamily: JT_FONT.semi },
});
