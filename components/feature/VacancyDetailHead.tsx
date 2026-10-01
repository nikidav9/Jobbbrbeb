import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { Chip } from '@/components/ui/Chip';
import { rs, rf } from '@/constants/scale';

import { JT_FONT } from '@/constants/jt';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type ChipVariant = React.ComponentProps<typeof Chip>['variant'];

export interface DetailChip {
  label: string;
  variant?: ChipVariant;
  icon?: IoniconName;
}

interface Props {
  /** Знак компании — у каждой ленты свой, поэтому приходит готовым. */
  logo?: React.ReactNode;
  company: string;
  /** «40 минут назад». Пусто — строка не показывается. */
  postedAgo?: string;
  title: string;
  chips: DetailChip[];
  /** Приписка под чипами — например, что зарплата оценочная. */
  note?: string;
}

/**
 * Шапка экрана вакансии: кто, когда, что и в двух словах — на каких условиях.
 *
 * Общая для смен, постоянных вакансий и партнёрских. Раньше каждая из трёх
 * рисовала своё, и они разошлись: где-то компания была заголовком, где-то
 * подписью, чипы отличались размером и цветом. Теперь это одно место.
 */
export function VacancyDetailHead({ logo, company, postedAgo, title, chips, note }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.companyRow}>
        {logo}
        {/* Две строки, а не одна. У партнёрских здесь помещается и компания,
            и источник, и «40 минут назад» — в одну строку это обрезалось
            ровно на времени публикации, то есть терялась самая свежая часть. */}
        <Text style={styles.company} numberOfLines={2}>
          {company}
          {postedAgo ? <Text style={styles.ago}>{` · ${postedAgo}`}</Text> : null}
        </Text>
      </View>

      <Text style={styles.title}>{title}</Text>

      {chips.length ? (
        <View style={styles.chips}>
          {chips.map((c, i) => (
            <Chip key={`${c.label}-${i}`} label={c.label} variant={c.variant ?? 'neutral'} icon={c.icon} />
          ))}
        </View>
      ) : null}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: rs(10) },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  company: { flex: 1, fontSize: rf(14), fontFamily: JT_FONT.bold, color: Colors.textSecondary },
  ago: { fontFamily: JT_FONT.medium, color: Colors.textMuted },
  title: { fontSize: rf(24), lineHeight: rf(30), fontFamily: JT_FONT.heavy, color: Colors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(6) },
  note: { fontFamily: JT_FONT.medium, fontSize: rf(12.5), lineHeight: rf(18), color: Colors.textMuted },
});
