import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { patchResume } from '@/lib/profileEdit';
import { SKILLS, POPULAR_IT_SKILLS, searchSkills, normalizeSkill } from '@/constants/skills';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import {
  EditScreen, Field, SectionTitle, RemovableChip, SuggestChip, ChipGroup, useUnsavedGuard,
  SearchIcon, PlusIcon,
} from '@/components/profile/edit';

const VISIBLE_LIMIT = 6;

export default function SkillsScreen() {
  const { currentUser, updateUser, showToast } = useApp();

  // Начальные навыки — один раз из currentUser, дальше живут в состоянии.
  const initialSkills = useRef(currentUser?.resume?.skills ?? []).current;
  const [skills, setSkills] = useState<string[]>(initialSkills);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const dirty = JSON.stringify(skills) !== JSON.stringify(initialSkills);

  const normalizedQuery = normalizeSkill(query);
  const suggestions = useMemo(
    () => searchSkills(query, skills, 20),
    [query, skills],
  );
  const exactSkill = useMemo(
    () => SKILLS.find((sk) => sk.toLowerCase() === normalizedQuery.toLowerCase()),
    [normalizedQuery],
  );
  const showAddRow = normalizedQuery.length > 0 && !exactSkill;
  const showDropdown = normalizedQuery.length > 0 && (showAddRow || suggestions.length > 0);

  const addSkill = (name: string) => {
    const norm = normalizeSkill(name);
    if (!norm) return;
    setSkills((prev) => {
      if (prev.some((s) => s.toLowerCase() === norm.toLowerCase())) return prev;
      return [...prev, norm];
    });
    setQuery('');
  };

  const removeSkill = (name: string) => {
    setSkills((prev) => prev.filter((s) => s !== name));
  };

  const handleSubmit = () => {
    if (!normalizedQuery) return;
    if (exactSkill) {
      addSkill(exactSkill);
      return;
    }
    if (suggestions.length > 0) {
      addSkill(suggestions[0]);
      return;
    }
    addSkill(normalizedQuery);
  };

  const popularSkills = useMemo(
    () => POPULAR_IT_SKILLS.filter((sk) => !skills.some((s) => s.toLowerCase() === sk.toLowerCase())),
    [skills],
  );

  const visibleSkills = expanded || skills.length <= VISIBLE_LIMIT ? skills : skills.slice(0, VISIBLE_LIMIT);
  const hiddenCount = skills.length - VISIBLE_LIMIT;

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchResume(currentUser, { skills }));
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
        title="Навыки"
        titleCount={skills.length}
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty}
        busy={busy}
        onPrimary={async () => {
          if (await save()) leave();
        }}
      >
        <View style={s.searchWrap}>
          <Field
            inputRef={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Найти или добавить навык"
            accessibilityLabel="Найти или добавить навык"
            left={<SearchIcon size={20} />}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
          />
          {showDropdown ? (
            <View style={s.dropdown}>
              <ScrollView keyboardShouldPersistTaps="handled" style={s.dropdownScroll} showsVerticalScrollIndicator={false}>
                {showAddRow ? (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={s.dropdownRow}
                    onPress={() => addSkill(normalizedQuery)}
                  >
                    <PlusIcon size={16} />
                    <Text style={s.dropdownAddText}>Добавить «{normalizedQuery}»</Text>
                  </TouchableOpacity>
                ) : null}
                {suggestions.map((sk) => (
                  <TouchableOpacity
                    key={sk}
                    activeOpacity={0.7}
                    style={s.dropdownRow}
                    onPress={() => addSkill(sk)}
                  >
                    <Text style={s.dropdownText}>{sk}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>

        <View>
          <SectionTitle
            right={
              skills.length > VISIBLE_LIMIT ? (
                <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded((v) => !v)}>
                  <Text style={s.showAllLink}>
                    {expanded ? 'Свернуть' : `Показать все ${skills.length}`}
                  </Text>
                </TouchableOpacity>
              ) : undefined
            }
          >
            Ваши навыки
          </SectionTitle>
          {skills.length > 0 ? (
            <View style={s.chipsWrap}>
              <ChipGroup>
                {visibleSkills.map((sk) => (
                  <RemovableChip key={sk} label={sk} onRemove={() => removeSkill(sk)} />
                ))}
                {!expanded && hiddenCount > 0 ? (
                  <View style={s.moreChip}>
                    <Text style={s.moreChipText}>+{hiddenCount} ещё</Text>
                  </View>
                ) : null}
              </ChipGroup>
            </View>
          ) : null}
        </View>

        {popularSkills.length > 0 ? (
          <View>
            <SectionTitle>Часто ищут в IT</SectionTitle>
            <Text style={s.hint}>Нажмите, чтобы добавить</Text>
            <View style={s.chipsWrap}>
              <ChipGroup>
                {popularSkills.map((sk) => (
                  <SuggestChip key={sk} label={sk} onPress={() => addSkill(sk)} />
                ))}
              </ChipGroup>
            </View>
          </View>
        ) : null}
      </EditScreen>
      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  searchWrap: { zIndex: 20 },
  dropdown: {
    position: 'absolute', left: 0, right: 0, top: 62, zIndex: 30,
    borderRadius: EditRadius.field, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.surface, overflow: 'hidden',
    shadowColor: EditColors.ink, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  dropdownScroll: { maxHeight: 260 },
  dropdownRow: {
    minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomWidth: 1, borderBottomColor: EditColors.borderSoft,
  },
  dropdownText: { fontFamily: EditFonts.text600, fontSize: 15, color: EditColors.ink },
  dropdownAddText: { fontFamily: EditFonts.text700, fontSize: 15, color: EditColors.ink },
  showAllLink: {
    fontFamily: EditFonts.text800, fontSize: 14, color: EditColors.ink,
    textDecorationLine: 'underline', textDecorationColor: EditColors.accent,
  },
  chipsWrap: { marginTop: 12 },
  moreChip: {
    height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.accent, alignItems: 'center', justifyContent: 'center',
  },
  moreChipText: { fontFamily: EditFonts.text800, fontSize: 14, color: EditColors.ink },
  hint: { marginTop: 6, fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.textTertiary },
});
