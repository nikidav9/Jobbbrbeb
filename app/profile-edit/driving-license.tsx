import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import {
  EditScreen, RadioCard, Toggle, useUnsavedGuard,
} from '@/components/profile/edit';
import { CarIcon } from '@/components/profile/edit/icons';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { patchPersonal, DRIVING_CATEGORIES } from '@/lib/profileEdit';

/**
 * Экран «Водительские права» — `docs/design/profile-edit/personal/19-driving-license.html`.
 * Есть/нет прав → категории (минимум одна) и «личный автомобиль» при «есть».
 */
export default function DrivingLicenseScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const [busy, setBusy] = useState(false);

  const initial = useMemo(() => {
    const personal = currentUser?.personalDetails;
    const categories = personal?.drivingCategories ?? [];
    const hasLicense = categories.length > 0 || personal?.driversLicense === 'Да';
    return { hasLicense, categories, hasOwnCar: personal?.hasOwnCar ?? false };
  }, [currentUser]);

  const [hasLicense, setHasLicense] = useState(initial.hasLicense);
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [hasOwnCar, setHasOwnCar] = useState(initial.hasOwnCar);

  const dirty = hasLicense !== initial.hasLicense
    || categories.join(',') !== initial.categories.join(',')
    || hasOwnCar !== initial.hasOwnCar;
  const valid = !hasLicense || categories.length > 0;

  const toggleCategory = (value: string) => {
    setCategories((prev) => (
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    ));
  };

  const selectHasLicense = (next: boolean) => {
    setHasLicense(next);
    if (!next) {
      setCategories([]);
      setHasOwnCar(false);
    }
  };

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchPersonal(currentUser, {
        drivingCategories: hasLicense ? categories : [],
        hasOwnCar: hasLicense ? hasOwnCar : false,
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
        title="Водительские права"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <View style={s.radioRow} accessibilityRole="radiogroup" accessibilityLabel="Наличие прав">
          <RadioCard title="Нет прав" selected={!hasLicense} onPress={() => selectHasLicense(false)} />
          <RadioCard title="Есть права" selected={hasLicense} onPress={() => selectHasLicense(true)} />
        </View>

        {hasLicense ? (
          <>
            <View style={{ gap: 10 }}>
              <Text style={s.label}>
                Категории
                {' '}
                <Text style={s.labelOptional}>· можно несколько</Text>
              </Text>
              <View style={s.categoryGroup}>
                {DRIVING_CATEGORIES.map((category) => {
                  const selected = categories.includes(category);
                  return (
                    <TouchableOpacity
                      key={category}
                      activeOpacity={0.75}
                      onPress={() => toggleCategory(category)}
                      style={[s.categoryBtn, selected ? s.categoryBtnSelected : s.categoryBtnDefault]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <Text style={s.categoryText}>{category}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={s.carRow}>
              <View style={s.carIconWrap}>
                <CarIcon size={20} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Toggle
                  value={hasOwnCar}
                  onValueChange={setHasOwnCar}
                  label="Есть личный автомобиль"
                />
              </View>
            </View>
          </>
        ) : null}
      </EditScreen>
      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  radioRow: { flexDirection: 'row', gap: 10 },
  label: { fontFamily: EditFonts.text700, fontSize: 14, color: EditColors.label },
  labelOptional: { fontFamily: EditFonts.text600, color: EditColors.textTertiary },
  categoryGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryBtn: {
    width: 56, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  categoryBtnDefault: { borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface },
  categoryBtnSelected: { borderWidth: 2, borderColor: EditColors.ink, backgroundColor: EditColors.accent },
  categoryText: { fontFamily: EditFonts.heading, fontSize: 16, color: EditColors.ink },
  carRow: {
    minHeight: 64, paddingVertical: 10, paddingLeft: 16, paddingRight: 14, borderRadius: 18,
    backgroundColor: EditColors.surface, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  carIconWrap: {
    flexShrink: 0, width: 40, height: 40, borderRadius: 12, backgroundColor: EditColors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
});
