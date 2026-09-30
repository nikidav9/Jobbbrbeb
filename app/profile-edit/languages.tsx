import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { patchResume, LANGUAGE_LEVELS, POPULAR_LANGUAGES } from '@/lib/profileEdit';
import { ResumeLanguage } from '@/constants/types';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import {
  EditScreen, Field, Chip, ChipGroup, AddDashedButton, BottomSheet, OptionSheet,
  useUnsavedGuard, CloseIcon,
} from '@/components/profile/edit';

/** Расшифровка уровня CEFR — подпись под чипами, как в `resume/03-languages.html`. */
const LEVEL_DESCRIPTIONS: Record<string, string> = {
  A1: 'Начальный',
  A2: 'Элементарный',
  B1: 'Средний',
  B2: 'Выше среднего',
  C1: 'Продвинутый',
  C2: 'Свободный',
};

/** Код CEFR или «Родной», который выбран у языка сейчас — разбираем то, что сами и пишем в `level`. */
function selectedCode(level: string): string | undefined {
  if (!level) return undefined;
  if (/родн/i.test(level)) return 'Родной';
  const match = level.trim().match(/^([ABC][12])\b/i);
  return match ? match[1].toUpperCase() : undefined;
}

/** Значение `ResumeLanguage.level`, которое `LanguageLevel` умеет показывать в профиле как есть. */
function buildLevel(code: string): string {
  if (code === 'Родной') return 'Родной';
  const description = LEVEL_DESCRIPTIONS[code];
  return description ? `${code} — ${description}` : code;
}

/**
 * Языки — `resume/03-languages.html`. Редактирует весь `resume.languages`
 * разом: список карточек с чипами уровня CEFR + «Родной», удаление, добавление
 * из популярных языков или свой вариант.
 */
export default function LanguagesScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [customSheetVisible, setCustomSheetVisible] = useState(false);
  const [customName, setCustomName] = useState('');

  // Начальный список — один раз из currentUser, дальше живёт в состоянии.
  const initialLanguages = useRef(currentUser?.resume?.languages ?? []).current;
  const [languages, setLanguages] = useState<ResumeLanguage[]>(initialLanguages);

  const dirty = JSON.stringify(languages) !== JSON.stringify(initialLanguages);
  const valid = languages.length > 0 && languages.every((l) => l.name.trim() && l.level.trim());

  const addOptions = useMemo(() => (
    POPULAR_LANGUAGES
      .filter((name) => !languages.some((l) => l.name.toLowerCase() === name.toLowerCase()))
      .map((name) => ({ label: name, value: name }))
  ), [languages]);

  const addLanguage = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLanguages((prev) => {
      if (prev.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) return prev;
      return [...prev, { name: trimmed, level: '' }];
    });
  };

  const removeLanguage = (index: number) => {
    setLanguages((prev) => prev.filter((_, i) => i !== index));
  };

  const setLevel = (index: number, code: string) => {
    setLanguages((prev) => prev.map((l, i) => (i === index ? { ...l, level: buildLevel(code) } : l)));
  };

  const handleSelectPopular = (value: string) => {
    if (value === '__custom__') {
      setAddSheetVisible(false);
      setCustomSheetVisible(true);
      return;
    }
    addLanguage(value);
    setAddSheetVisible(false);
  };

  const handleAddCustom = () => {
    addLanguage(customName);
    setCustomName('');
    setCustomSheetVisible(false);
  };

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchResume(currentUser, { languages }));
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
        title="Языки"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <Text style={s.caption}>Уровень по шкале CEFR: от A1 — начальный до C2 — свободный</Text>

        <View style={{ gap: 12 }}>
          {languages.map((lang, index) => {
            const code = selectedCode(lang.level);
            const removable = index > 0;
            return (
              <View key={`${lang.name}-${index}`} style={s.card}>
                <View style={s.cardHeader}>
                  <Text style={s.cardName}>{lang.name}</Text>
                  {removable ? (
                    <TouchableOpacity
                      onPress={() => removeLanguage(index)}
                      style={s.removeBtn}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`Удалить язык: ${lang.name}`}
                    >
                      <CloseIcon size={14} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                <ChipGroup>
                  {LANGUAGE_LEVELS.map((option) => (
                    <Chip
                      key={option}
                      size="sm"
                      label={option}
                      selected={code === option}
                      onPress={() => setLevel(index, option)}
                    />
                  ))}
                </ChipGroup>
                {code && code !== 'Родной' ? <Text style={s.levelCaption}>{lang.level}</Text> : null}
              </View>
            );
          })}
        </View>

        <AddDashedButton label="Добавить язык" onPress={() => setAddSheetVisible(true)} />
      </EditScreen>

      <OptionSheet
        visible={addSheetVisible}
        title="Добавить язык"
        searchable
        options={[...addOptions, { label: 'Свой вариант', value: '__custom__' }]}
        onSelect={handleSelectPopular}
        onClose={() => setAddSheetVisible(false)}
      />

      <BottomSheet
        visible={customSheetVisible}
        onClose={() => { setCustomSheetVisible(false); setCustomName(''); }}
        title="Свой вариант"
      >
        <View style={{ marginTop: 14, gap: 14 }}>
          <Field
            value={customName}
            onChangeText={setCustomName}
            placeholder="Название языка"
            autoFocus
            onSubmitEditing={handleAddCustom}
            returnKeyType="done"
          />
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={!customName.trim()}
            onPress={handleAddCustom}
            style={[s.customAddBtn, !customName.trim() && s.customAddBtnDisabled]}
          >
            <Text style={[s.customAddText, !customName.trim() && s.customAddTextDisabled]}>Добавить</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  caption: { fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20, color: EditColors.textTertiary },
  card: { padding: 16, borderRadius: EditRadius.card, backgroundColor: EditColors.surface, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardName: { fontFamily: EditFonts.text800, fontSize: 17, color: EditColors.ink },
  removeBtn: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: EditColors.border,
    backgroundColor: EditColors.surface, alignItems: 'center', justifyContent: 'center',
  },
  levelCaption: { fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.textTertiary },
  customAddBtn: {
    height: 56, borderRadius: EditRadius.button, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.accent, alignItems: 'center', justifyContent: 'center',
  },
  customAddBtnDisabled: { borderWidth: 0, backgroundColor: EditColors.disabledBg },
  customAddText: { fontFamily: EditFonts.text800, fontSize: 16, color: EditColors.ink },
  customAddTextDisabled: { color: EditColors.disabledText },
});
