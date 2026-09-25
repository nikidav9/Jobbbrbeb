import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { parseDescriptionBlocks } from '@/services/descriptionBlocks';

interface DescriptionBlocksProps {
  text?: string | null;
}

/**
 * Полное описание вакансии со структурой: заголовки разделов жирным и
 * покрупнее, пункты списка — с точкой слева, остальное — обычный абзац.
 * Разбор текста на блоки — services/descriptionBlocks.ts, здесь только вёрстка.
 */
export function DescriptionBlocks({ text }: DescriptionBlocksProps) {
  const blocks = parseDescriptionBlocks(text);
  if (!blocks.length) return null;

  return (
    <View>
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return (
            <Text key={i} style={[styles.heading, i > 0 ? styles.headingSpacing : null]}>
              {b.text}
            </Text>
          );
        }
        if (b.type === 'bullet') {
          return (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{b.text}</Text>
            </View>
          );
        }
        return (
          <Text key={i} style={styles.para}>
            {b.text}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: rf(14.5),
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: rs(4),
  },
  headingSpacing: { marginTop: rs(10) },
  para: {
    fontSize: rf(13.5),
    color: Colors.textSecondary,
    lineHeight: rf(21),
    marginBottom: rs(4),
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: rs(2),
  },
  bulletDot: {
    fontSize: rf(13.5),
    color: Colors.textSecondary,
    lineHeight: rf(21),
    marginRight: rs(6),
  },
  bulletText: {
    flex: 1,
    fontSize: rf(13.5),
    color: Colors.textSecondary,
    lineHeight: rf(21),
  },
});
