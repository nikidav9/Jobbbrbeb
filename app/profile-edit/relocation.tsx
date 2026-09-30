import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { patchPersonal, RELOCATION_VARIANTS, POPULAR_RELOCATION_CITIES } from '@/lib/profileEdit';
import {
  EditScreen, RadioCard, SectionTitle, Chip, ChipGroup, SuggestChip, RemovableChip, Field,
  useUnsavedGuard,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

// Последний пункт списка — не город, а триггер поля «свой город».
const POPULAR_CITY_CHIPS = POPULAR_RELOCATION_CITIES.slice(0, -1);
const OTHER_CITY_LABEL = POPULAR_RELOCATION_CITIES[POPULAR_RELOCATION_CITIES.length - 1];

// Варианты, при которых имеет смысл выбирать города.
const VARIANTS_WITH_CITIES = new Set(['Готов к переезду', 'Хочу переехать']);

function sameCities(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  return a.every((city, i) => city === b[i]);
}

export default function RelocationScreen() {
  const { currentUser, updateUser, showToast } = useApp();

  const initialRelocation = currentUser?.personalDetails?.relocation ?? '';
  const initialCities = useMemo(
    () => currentUser?.personalDetails?.relocationCities ?? [],
    [currentUser],
  );

  const [relocation, setRelocation] = useState(initialRelocation);
  const [cities, setCities] = useState<string[]>(initialCities);
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherCity, setOtherCity] = useState('');
  const [busy, setBusy] = useState(false);

  const showCities = VARIANTS_WITH_CITIES.has(relocation);
  const effectiveCities = showCities ? cities : [];
  const customCities = cities.filter((city) => !POPULAR_CITY_CHIPS.includes(city));

  const dirty = relocation !== initialRelocation || !sameCities(effectiveCities, initialCities);
  const valid = relocation.length > 0;

  const toggleCity = (city: string) => {
    setCities((prev) => (prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]));
  };

  const addOtherCity = () => {
    const value = otherCity.trim();
    if (!value) return;
    setCities((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setOtherCity('');
  };

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchPersonal(currentUser, {
        relocation,
        relocationCities: showCities ? cities : [],
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
        title="Переезд"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => {
          if (await save()) leave();
        }}
      >
        <View>
          <Text style={s.subtitle}>Готовы ли вы переехать ради работы</Text>
          <View style={s.radioGroup} accessibilityRole="radiogroup" accessibilityLabel="Готовность к переезду">
            {RELOCATION_VARIANTS.map((variant) => (
              <RadioCard
                key={variant.value}
                title={variant.value}
                subtitle={variant.description}
                selected={relocation === variant.value}
                onPress={() => setRelocation(variant.value)}
              />
            ))}
          </View>
        </View>

        {showCities ? (
          <View style={{ gap: 10 }}>
            <SectionTitle>Куда готовы переехать</SectionTitle>
            <ChipGroup>
              {POPULAR_CITY_CHIPS.map((city) => (
                <Chip
                  key={city}
                  label={city}
                  selected={cities.includes(city)}
                  onPress={() => toggleCity(city)}
                />
              ))}
              {customCities.map((city) => (
                <RemovableChip key={city} label={city} onRemove={() => toggleCity(city)} />
              ))}
              <SuggestChip label={OTHER_CITY_LABEL} onPress={() => setShowOtherInput((v) => !v)} />
            </ChipGroup>

            {showOtherInput ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Field
                    value={otherCity}
                    onChangeText={setOtherCity}
                    placeholder="Свой город"
                    onSubmitEditing={addOtherCity}
                    returnKeyType="done"
                  />
                </View>
                <SuggestChip label="Добавить" onPress={addOtherCity} />
              </View>
            ) : null}
          </View>
        ) : null}
      </EditScreen>
      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  subtitle: {
    fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20, color: EditColors.textTertiary,
  },
  radioGroup: { marginTop: 22, gap: 10 },
});
