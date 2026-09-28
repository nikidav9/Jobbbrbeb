import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import { BottomSheet } from './BottomSheet';
import { Field } from './Field';
import { SearchIcon, CheckIcon } from './icons';

export type Option = { label: string; value: string };

/** Список вариантов в шторке — год, страна, категория и т.п.; с поиском по метке. */
export function OptionSheet({
  visible, title, options, selected, onSelect, onClose, searchable,
}: {
  visible: boolean;
  title: string;
  options: Option[];
  selected?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {searchable ? (
        <View style={{ marginTop: 14 }}>
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск"
            left={<SearchIcon size={20} />}
          />
        </View>
      ) : null}
      <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
        {filtered.map((option) => {
          const isSelected = option.value === selected;
          return (
            <TouchableOpacity
              key={option.value}
              style={s.row}
              activeOpacity={0.7}
              onPress={() => onSelect(option.value)}
            >
              <Text style={[s.rowText, isSelected && s.rowTextSelected]}>{option.label}</Text>
              {isSelected ? <CheckIcon size={16} color={EditColors.accent} /> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  list: { marginTop: 10, maxHeight: 360 },
  row: {
    height: 52, borderRadius: EditRadius.card, paddingHorizontal: 4,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  rowText: { fontFamily: EditFonts.text600, fontSize: 16, color: EditColors.ink },
  rowTextSelected: { fontFamily: EditFonts.text700 },
});
