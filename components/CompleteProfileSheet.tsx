import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { JT, JT_FONT } from '@/constants/jt';
import { JTButton, JTInput } from '@/components/ui/jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { useApp } from '@/hooks/useApp';
import { uploadAvatar } from '@/services/avatarUpload';
import { rs, rf } from '@/constants/scale';

/**
 * Разовая просьба к тем, кто зарегистрировался раньше: указать возраст и,
 * если захотят, добавить фото.
 *
 * Новичков про это спрашивает регистрация, а у тех, кто пришёл до неё, поля
 * пустые: возраст не был указан ни у кого из 301 работника, фото — у четверых.
 * Директор смотрит на безликую строку и не отвечает.
 *
 * Показывается один раз. Отказ запоминаем так же, как согласие: человека,
 * который закрыл карточку, спрашивать снова — это уже не просьба, а
 * навязчивость.
 */

const SEEN_KEY = 'jm_complete_profile_prompt_v1';
const SHOW_DELAY_MS = 2500;
const MIN_AGE = 18;
const MAX_AGE = 75;

export default function CompleteProfileSheet() {
  const insets = useSafeAreaInsets();
  const { currentUser, updateUser, showToast, emailAuthReady, consentPending } = useApp();

  const [visible, setVisible] = useState(false);
  const [age, setAge] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsAge = !!currentUser && !currentUser.isGuest && !currentUser.age;
  const needsPhoto = !!currentUser && !currentUser.isGuest && !currentUser.avatarUrl;

  // Старому аккаунту без почты сначала — окно «Укажите почту»
  // (EmailRequiredGate). Этот лист — системный Modal и лёг бы поверх него.
  const emailPending = !!currentUser && !currentUser.isGuest && !currentUser.emailVerifiedAt && emailAuthReady;

  useEffect(() => {
    if (!currentUser || currentUser.isGuest) return;
    // Окно «Примите документы» — тоже сначала (см. consentPending).
    if (emailPending || consentPending) return;
    if (!needsAge && !needsPhoto) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const seen = await AsyncStorage.getItem(SEEN_KEY);
        if (!alive || seen) return;
        setVisible(true);
      } catch {
        // Нет доступа к хранилищу — лучше не показать, чем показывать каждый раз.
      }
    }, SHOW_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [currentUser?.id, needsAge, needsPhoto, emailPending, consentPending]);

  const remember = () => AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});

  const close = () => {
    remember();
    setVisible(false);
  };

  const pickPhoto = async () => {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.9, allowsEditing: true, aspect: [1, 1],
    });
    if (!res.canceled && res.assets?.[0]?.uri) setPhotoUri(res.assets[0].uri);
  };

  const save = async () => {
    if (!currentUser || saving) return;
    const n = Number(age);
    if (needsAge && (!Number.isFinite(n) || n < MIN_AGE || n > MAX_AGE)) {
      showToast(`Возраст от ${MIN_AGE} до ${MAX_AGE} лет`, 'error');
      return;
    }
    setSaving(true);
    try {
      let avatarUrl = currentUser.avatarUrl;
      let photoUploadFailed = false;
      if (photoUri) {
        try {
          avatarUrl = await uploadAvatar(photoUri, currentUser.id);
        } catch {
          photoUploadFailed = true;
        }
      }

      // Если менялось только фото и оно не загрузилось, серверу нечего
      // сохранять. Оставляем sheet открытым: человек может повторить попытку,
      // а просьба не будет ошибочно помечена как завершённая.
      if (photoUploadFailed && !needsAge) {
        showToast('Фото не загрузилось. Проверьте связь и попробуйте ещё раз.', 'error');
        return;
      }

      await updateUser({
        ...currentUser,
        age: needsAge ? n : currentUser.age,
        avatarUrl,
      });

      if (photoUploadFailed) {
        // Возраст к этому моменту уже подтверждён сервером. Фото — нет.
        // Не закрываем sheet и не remember(): после rerender останется только
        // недостающая фотография, которую можно отправить ещё раз.
        showToast('Возраст сохранён. Фото не загрузилось — попробуйте ещё раз.', 'error');
        return;
      }

      remember();
      setVisible(false);
      showToast('Спасибо, профиль стал полнее', 'success');
    } catch {
      showToast('Не удалось сохранить. Попробуйте позже.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!visible || !currentUser || currentUser.isGuest) return null;

  const isWorker = currentUser.role === 'worker';

  // Стиль JT (01.10.2026, просьба владельца): кремовая карточка с чёрным
  // контуром и жёсткой тенью — как окно «да/нет» и окна профиля.
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <View style={st.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.center}>
          <HardShadowBox offset={5} radius={rs(24)} style={st.cardWrap}>
            <View style={[st.card, { paddingBottom: rs(12) + insets.bottom / 2 }]}>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={st.title} accessibilityRole="header">Заполните профиль до конца</Text>
                <Text style={st.sub}>
                  {isWorker
                    ? 'Работодатели чаще отвечают тем, чья карточка не пустая. Это займёт полминуты.'
                    : 'Работники охотнее откликаются, когда видят, кто за вакансией. Это займёт полминуты.'}
                </Text>

                {needsPhoto ? (
                  <TouchableOpacity style={st.photoRow} onPress={pickPhoto} activeOpacity={0.85}
                    accessibilityRole="button" accessibilityLabel="Добавить фото">
                    <View style={st.photoBtn}>
                      {photoUri ? (
                        <Image source={{ uri: photoUri }} style={st.photo} contentFit="cover" />
                      ) : (
                        <Ionicons name="camera-outline" size={rs(24)} color={JT.ink} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.photoTitle}>{photoUri ? 'Фото выбрано' : 'Добавить фото'}</Text>
                      <Text style={st.photoHint}>По желанию — с фото отвечают охотнее</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={rs(18)} color={JT.textTertiary} />
                  </TouchableOpacity>
                ) : null}

                {needsAge ? (
                  <JTInput
                    label="Возраст"
                    value={age}
                    onChangeText={t => setAge(t.replace(/\D/g, '').slice(0, 2))}
                    placeholder="25"
                    keyboardType="number-pad"
                    maxLength={2}
                    style={st.ageInput}
                  />
                ) : null}

                <JTButton label="Сохранить" onPress={save} busy={saving} arrow={false} style={st.primary} />

                <TouchableOpacity onPress={close} disabled={saving} style={st.skipBtn} accessibilityRole="button">
                  <Text style={st.skip}>Не сейчас</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </HardShadowBox>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,20,20,0.45)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: rs(20) },
  cardWrap: { width: '100%', maxWidth: 420, maxHeight: '85%' },
  card: {
    backgroundColor: JT.background, borderRadius: rs(24), borderWidth: 2, borderColor: JT.ink,
    paddingHorizontal: rs(22), paddingTop: rs(24),
  },
  title: { fontFamily: JT_FONT.head, fontSize: rf(19), lineHeight: rf(24), color: JT.ink },
  sub: {
    marginTop: rs(10), marginBottom: rs(18),
    fontFamily: JT_FONT.medium, fontSize: rf(15), lineHeight: rf(21), color: JT.textSecondary,
  },

  photoRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    backgroundColor: JT.surface, borderRadius: rs(18), borderWidth: 2, borderColor: JT.ink,
    padding: rs(12), marginBottom: rs(16),
  },
  photoBtn: {
    width: rs(52), height: rs(52), borderRadius: rs(26), overflow: 'hidden',
    backgroundColor: JT.accentSoft, borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  photo: { width: '100%', height: '100%' },
  photoTitle: { fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.ink },
  photoHint: { fontFamily: JT_FONT.medium, fontSize: rf(13), color: JT.textTertiary, marginTop: rs(2), lineHeight: rf(17) },

  ageInput: { width: rs(120) },
  primary: { marginTop: rs(6) },
  skipBtn: { minHeight: rs(48), alignItems: 'center', justifyContent: 'center', marginTop: rs(6) },
  skip: { fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.textTertiary },
});
