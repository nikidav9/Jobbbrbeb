import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';

import { JT_FONT } from '@/constants/jt';
/**
 * Последний шаг регистрации: фото, возраст и пара слов о себе.
 *
 * Зачем понадобился. Директор выбирает людей по списку, а в списке смотреть
 * не на что: фото было у 4 человек из 301, «о себе» — у 25, возраст не указал
 * никто, потому что поля просто не было в форме. Половина директоров на
 * отклики не отвечает — и это, среди прочего, следствие того, что откликается
 * безликая строка.
 *
 * Что обязательно, а что нет. Возраст и описание — обязательны: без них
 * карточка снова окажется пустой. Фото — по желанию: заставлять
 * фотографироваться при регистрации значит потерять часть людей на ровном
 * месте, а регистрация у нас единственный шаг, который проходят все.
 *
 * Порог описания намеренно низкий — одна строка. Плюс подсказки в одно
 * нажатие: пустое поле с курсором отпугивает сильнее, чем просьба выбрать.
 */

export const BIO_MIN_LENGTH = 10;
export const BIO_MAX_LENGTH = 300;

// Подсказка прямо в поле, серым: пустое поле с курсором не объясняет, о чём
// писать, и человек пишет «ищу работу» — то есть ничего.
const WORKER_PLACEHOLDER =
  'Есть ли опыт и где работали. Что умеете: собирать заказы, размещать товар, '
  + 'работать с терминалом. Когда удобно выходить.';

const EMPLOYER_PLACEHOLDER =
  'Что за точка и где: адрес, ближайшее метро. Какой коллектив. Сколько заказов '
  + 'в смену. Как устроена разгрузка — подвал, рампа, лифт.';

const MIN_AGE = 18;
const MAX_AGE = 75;

type Props = {
  role: 'worker' | 'employer';
  age: string;
  onAgeChange: (v: string) => void;
  bio: string;
  onBioChange: (v: string) => void;
  photoUri: string | null;
  onPhotoChange: (uri: string | null) => void;
};

export function AboutYouStep({ role, age, onAgeChange, bio, onBioChange, photoUri, onPhotoChange }: Props) {
  const [picking, setPicking] = useState(false);
  const isWorker = role === 'worker';
  const placeholder = isWorker ? WORKER_PLACEHOLDER : EMPLOYER_PLACEHOLDER;

  const pick = async () => {
    if (picking) return;
    setPicking(true);
    try {
      // На вебе разрешения не спрашивают — там это обычный выбор файла.
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (!res.canceled && res.assets?.[0]?.uri) onPhotoChange(res.assets[0].uri);
    } finally {
      setPicking(false);
    }
  };

  return (
    <View>
      <Text style={st.title}>{isWorker ? 'Расскажите о себе' : 'Расскажите о компании'}</Text>
      <Text style={st.subtitle}>
        {isWorker
          ? 'Работодатель увидит это, когда вы откликнетесь на вакансию'
          : 'Это увидят работники в вашей карточке'}
      </Text>

      {/* Фото — по желанию */}
      <View style={st.photoRow}>
        <TouchableOpacity style={st.photoBtn} onPress={pick} activeOpacity={0.8} disabled={picking}>
          {picking ? (
            <ActivityIndicator color={Colors.primary} />
          ) : photoUri ? (
            <Image source={{ uri: photoUri }} style={st.photo} contentFit="cover" />
          ) : (
            <Ionicons name="camera-outline" size={rs(26)} color={Colors.textMuted} />
          )}
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.photoTitle}>Хотите добавить фото?</Text>
          <Text style={st.photoHint}>
            Необязательно. Но с фото {isWorker ? 'на отклик отвечают заметно охотнее' : 'к вакансии больше доверия'}.
          </Text>
          {photoUri ? (
            <TouchableOpacity onPress={() => onPhotoChange(null)}>
              <Text style={st.photoRemove}>Убрать фото</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Возраст — обязателен */}
      <Text style={st.label}>Возраст</Text>
      <TextInput
        value={age}
        onChangeText={t => onAgeChange(t.replace(/\D/g, '').slice(0, 2))}
        placeholder="25"
        placeholderTextColor={Colors.textMuted}
        keyboardType="number-pad"
        style={st.ageInput}
        maxLength={2}
      />
      {age !== '' && !isAgeValid(age) ? (
        <Text style={st.err}>Возраст от {MIN_AGE} до {MAX_AGE} лет</Text>
      ) : null}

      {/* О себе — обязательно */}
      <Text style={st.label}>{isWorker ? 'О себе' : 'О компании'}</Text>
      <TextInput
        value={bio}
        onChangeText={onBioChange}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        style={st.bioInput}
        multiline
        maxLength={BIO_MAX_LENGTH}
      />
      <Text style={[st.counter, bio.trim().length < BIO_MIN_LENGTH && st.counterLow]}>
        {bio.trim().length < BIO_MIN_LENGTH
          ? `Ещё ${BIO_MIN_LENGTH - bio.trim().length} символов`
          : `${bio.trim().length} из ${BIO_MAX_LENGTH}`}
      </Text>
    </View>
  );
}

export function isAgeValid(age: string): boolean {
  const n = Number(age);
  return Number.isFinite(n) && n >= MIN_AGE && n <= MAX_AGE;
}

export function isAboutYouComplete(age: string, bio: string): boolean {
  return isAgeValid(age) && bio.trim().length >= BIO_MIN_LENGTH;
}

const st = StyleSheet.create({
  title: { fontSize: rf(24), fontFamily: JT_FONT.heavy, color: Colors.textPrimary, marginBottom: rs(6) },
  subtitle: { fontFamily: JT_FONT.medium, fontSize: rf(14), color: Colors.textMuted, marginBottom: rs(18) },

  photoRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    backgroundColor: '#F9FAFB', borderRadius: Radius.lg, padding: rs(12), marginBottom: rs(18),
  },
  photoBtn: {
    width: rs(64), height: rs(64), borderRadius: rs(32),
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  photoTitle: { fontSize: rf(15), fontFamily: JT_FONT.bold, color: Colors.textPrimary },
  photoHint: { fontFamily: JT_FONT.medium, fontSize: rf(12), color: Colors.textMuted, marginTop: rs(2), lineHeight: rf(16) },
  photoRemove: { fontSize: rf(12), color: Colors.primary, marginTop: rs(6), fontFamily: JT_FONT.semi },

  label: { fontSize: rf(13), fontFamily: JT_FONT.bold, color: Colors.textPrimary, marginBottom: rs(6) },
  ageInput: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: Radius.md,
    paddingHorizontal: rs(14), paddingVertical: rs(12),
    fontFamily: JT_FONT.medium, fontSize: rf(16), color: Colors.textPrimary, width: rs(96), marginBottom: rs(4),
  },
  bioInput: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: Radius.md,
    paddingHorizontal: rs(14), paddingVertical: rs(12),
    fontFamily: JT_FONT.medium, fontSize: rf(15), color: Colors.textPrimary, minHeight: rs(96),
    textAlignVertical: 'top', marginBottom: rs(4),
  },
  counter: { fontFamily: JT_FONT.medium, fontSize: rf(12), color: Colors.textMuted, marginBottom: rs(14), textAlign: 'right' },
  counterLow: { color: '#B45309' },
  err: { fontFamily: JT_FONT.medium, fontSize: rf(12), color: '#DC2626', marginBottom: rs(10) },

});
