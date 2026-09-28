import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { patchResume } from '@/lib/profileEdit';
import {
  EditScreen, Field, Chip, ChipGroup, useUnsavedGuard, PlusIcon,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

const MAX_INTERESTS = 10;

/** Варианты чипов — `resume/10-interests.html`. Нет в справочниках `lib/profileEdit.ts`. */
const INTEREST_OPTIONS = [
  'Путешествия', 'Спорт', 'Бег', 'Чтение', 'Хакатоны', 'Музыка',
  'Кино и сериалы', 'Фотография', 'Настольные игры', 'Кулинария',
  'Open source', 'IT-митапы', 'Волонтёрство', 'Иностранные языки', 'Шахматы',
];

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/**
 * Интересы — `resume/10-interests.html`. Чипы из `INTEREST_OPTIONS` + свой
 * вариант, до `MAX_INTERESTS` штук. Уже сохранённые интересы, которых нет в
 * списке, показываются как дополнительные выбранные чипы.
 */
export default function InterestsScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const initial = currentUser?.resume?.interests ?? [];
  // Сохранённые интересы вне справочника — отдельные чипы, добавляются в конец списка.
  const [extraChips, setExtraChips] = useState<string[]>(() => (
    initial.filter((v) => !INTEREST_OPTIONS.some((o) => o.toLowerCase() === v.toLowerCase()))
  ));
  const [selected, setSelected] = useState<string[]>(initial);

  const chips = [...INTEREST_OPTIONS, ...extraChips];
  const dirty = !sameSet(selected, initial);

  const toggle = (label: string) => {
    if (selected.includes(label)) {
      setSelected(selected.filter((v) => v !== label));
      return;
    }
    if (selected.length >= MAX_INTERESTS) return;
    setSelected([...selected, label]);
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    const existingChip = chips.find((c) => c.toLowerCase() === trimmed.toLowerCase());
    if (existingChip) {
      if (!selected.includes(existingChip) && selected.length < MAX_INTERESTS) {
        setSelected([...selected, existingChip]);
      }
    } else if (selected.length < MAX_INTERESTS) {
      setExtraChips([...extraChips, trimmed]);
      setSelected([...selected, trimmed]);
    }
    setCustomInput('');
  };

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchResume(currentUser, { interests: selected }));
      showToast('Сохранено');
      return true;
    } catch {
      showToast('Не удалось сохранить. Попробуйте ещё раз', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const { requestClose, dialog, leave } = useUnsavedGuard({ dirty, onSave: save });

  if (!currentUser) return null;

  return (
    <>
      <EditScreen
        title="Интересы"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <View style={{ gap: 20 }}>
          <Text style={s.hint}>
            До 10 — помогает найти команду по духу · выбрано {selected.length}
          </Text>

          <ChipGroup>
            {chips.map((label) => {
              const isSelected = selected.includes(label);
              const isDisabled = !isSelected && selected.length >= MAX_INTERESTS;
              return (
                <View key={label} style={isDisabled ? s.chipDisabled : undefined}>
                  <Chip label={label} selected={isSelected} onPress={() => toggle(label)} />
                </View>
              );
            })}
          </ChipGroup>

          <View style={{ gap: 8 }}>
            <Text style={s.label}>Нет в списке?</Text>
            <View style={s.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Field
                  value={customInput}
                  onChangeText={setCustomInput}
                  placeholder="Свой вариант"
                  accessibilityLabel="Свой интерес"
                  onSubmitEditing={addCustom}
                  returnKeyType="done"
                />
              </View>
              <TouchableOpacity
                onPress={addCustom}
                style={s.addBtn}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Добавить свой интерес"
              >
                <PlusIcon size={20} color={EditColors.surface} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </EditScreen>

      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  hint: {
    fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20, color: EditColors.textTertiary,
  },
  label: { fontFamily: EditFonts.text700, fontSize: 14, color: EditColors.label },
  row: { flexDirection: 'row', gap: 10 },
  chipDisabled: { opacity: 0.4 },
  addBtn: {
    width: 56, height: 56, borderRadius: 16, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.ink, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
});
