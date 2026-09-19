import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';

/**
 * Единая точка входа во все юридические документы.
 *
 * Раньше стартовый экран показывал четыре длинные текстовые ссылки и при этом
 * не показывал отдельное согласие на трансграничную передачу. Теперь здесь
 * одна заметная кнопка, а полный актуальный набор документов живёт на /legal.
 */
export function LegalLinks({ style }: { style?: ViewStyle }) {
  const router = useRouter();

  return (
    <View style={[styles.wrap, style]}>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push('/legal')}
        activeOpacity={0.78}
      >
        <View style={styles.icon}>
          <Ionicons name="documents-outline" size={rf(18)} color={Colors.primary} />
        </View>
        <Text style={styles.label}>Все документы</Text>
        <Ionicons name="chevron-forward" size={rf(17)} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  button: {
    minHeight: rs(48),
    paddingHorizontal: rs(16),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(10),
  },
  icon: {
    width: rs(30),
    height: rs(30),
    borderRadius: rs(15),
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontSize: rf(14),
    fontWeight: '700',
    color: Colors.textPrimary,
  },
});
