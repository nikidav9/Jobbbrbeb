/**
 * «Гражданство / разрешение на работу» — `docs/design/profile-edit/personal/14-work-permit.html`.
 * Гражданство — выбор страны через `OptionSheet`; страны без визы — чипы с множественным
 * выбором (`WORK_PERMIT_COUNTRIES`). `PersonalDetails.workAuthorization` на экране не
 * показывается: `patchPersonal` сам собирает его из `workAuthorizationCountries` через
 * запятую (легаси-строка, которую читают карточка и Jupiter) — отдельного поля выбора
 * для него в макете нет.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '@/hooks/useApp';
import {
  EditScreen, FieldLabel, SelectField, OptionSheet, ChipGroup, Chip, SuggestChip, useUnsavedGuard,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { patchPersonal, WORK_PERMIT_COUNTRIES } from '@/lib/profileEdit';

/** Гражданство: список стран для поиска в шторке. Своего справочника стран
 *  в проекте нет (`WORK_PERMIT_COUNTRIES` — про визовый статус, не про гражданство). */
const CITIZENSHIP_COUNTRIES = [
  'Россия', 'Беларусь', 'Казахстан', 'Армения', 'Кыргызстан', 'Узбекистан',
  'Таджикистан', 'Азербайджан', 'Украина', 'Молдова', 'Грузия', 'Туркменистан',
  'Сербия', 'Германия', 'Польша', 'Турция', 'Китай', 'Индия', 'Вьетнам',
  'США', 'Другое',
].map((v) => ({ label: v, value: v }));

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

export default function WorkPermitScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const [citizenshipSheetVisible, setCitizenshipSheetVisible] = useState(false);

  const initialCitizenship = currentUser?.personalDetails?.citizenship ?? '';
  const initialCountries = currentUser?.personalDetails?.workAuthorizationCountries ?? [];

  const [citizenship, setCitizenship] = useState(initialCitizenship);
  const [countries, setCountries] = useState<string[]>(initialCountries);

  const dirty = citizenship !== initialCitizenship || !sameSet(countries, initialCountries);
  const valid = true;

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchPersonal(currentUser, {
        citizenship: citizenship || undefined,
        workAuthorizationCountries: countries,
      }));
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
        title="Разрешение на работу"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <SelectField
          label="Гражданство"
          value={citizenship}
          placeholder="Выберите страну"
          onPress={() => setCitizenshipSheetVisible(true)}
        />

        <View style={s.section}>
          <FieldLabel label="Где можете работать без визы и оформления разрешения" />
          <Text style={s.hint}>Можно выбрать несколько</Text>
          <ChipGroup>
            {WORK_PERMIT_COUNTRIES.map((country) => {
              const selected = countries.includes(country);
              if (country === 'Другая страна' && !selected) {
                return (
                  <SuggestChip
                    key={country}
                    label={country}
                    onPress={() => setCountries((cur) => toggle(cur, country))}
                  />
                );
              }
              return (
                <Chip
                  key={country}
                  label={country}
                  selected={selected}
                  onPress={() => setCountries((cur) => toggle(cur, country))}
                />
              );
            })}
          </ChipGroup>
        </View>
      </EditScreen>

      <OptionSheet
        visible={citizenshipSheetVisible}
        title="Гражданство"
        options={CITIZENSHIP_COUNTRIES}
        selected={citizenship}
        searchable
        onSelect={(value) => { setCitizenship(value); setCitizenshipSheetVisible(false); }}
        onClose={() => setCitizenshipSheetVisible(false)}
      />

      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  section: { gap: 10 },
  hint: {
    marginTop: -2, fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.textTertiary,
  },
});
