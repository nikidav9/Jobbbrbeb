import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Modal,
  ActivityIndicator, ScrollView, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius } from '@/constants/theme';
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
  const { currentUser, updateUser, showToast } = useApp();

  const [visible, setVisible] = useState(false);
  const [age, setAge] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsAge = !!currentUser && !currentUser.isGuest && !currentUser.age;
  const needsPhoto = !!currentUser && !currentUser.isGuest && !currentUser.avatarUrl;

  useEffect(() => {
    if (!currentUser || currentUser.isGuest) return;
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
  }, [currentUser?.id, needsAge, needsPhoto]);

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

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={st.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.center}>
          <View style={[st.card, { paddingBottom: rs(16) + insets.bottom / 2 }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={st.title}>Заполните профиль до конца</Text>
              <Text style={st.sub}>
                {isWorker
                  ? 'Директора чаще отвечают тем, чья карточка не пустая. Это займёт полминуты.'
                  : 'Работники охотнее откликаются, когда видят, кто за вакансией. Это займёт полминуты.'}
              </Text>

              {needsPhoto ? (
                <View style={st.photoRow}>
                  <TouchableOpacity style={st.photoBtn} onPress={pickPhoto} activeOpacity={0.8}>
                    {photoUri ? (
                      <Image source={{ uri: photoUri }} style={st.photo} contentFit="cover" />
                    ) : (
                      <Ionicons name="camera-outline" size={rs(24)} color={Colors.textMuted} />
                    )}
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={st.photoTitle}>Фото — по желанию</Text>
                    <Text style={st.photoHint}>Можно пропустить, но с фото отвечают охотнее.</Text>
                  </View>
                </View>
              ) : null}

              {needsAge ? (
                <>
                  <Text style={st.label}>Возраст</Text>
                  <TextInput
                    value={age}
                    onChangeText={t => setAge(t.replace(/\D/g, '').slice(0, 2))}
                    placeholder="25"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="number-pad"
                    style={st.input}
                    maxLength={2}
                  />
                </>
              ) : null}

              <TouchableOpacity
                style={[st.primary, saving && { opacity: 0.6 }]}
                onPress={save}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryTxt}>Сохранить</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={close} disabled={saving}>
                <Text style={st.skip}>Не сейчас</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: rs(20) },
  card: {
    backgroundColor: '#fff', borderRadius: Radius.xl, padding: rs(20), maxHeight: '80%',
  },
  title: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary, marginBottom: rs(6) },
  sub: { fontSize: rf(14), color: Colors.textMuted, lineHeight: rf(19), marginBottom: rs(16) },

  photoRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    backgroundColor: '#F9FAFB', borderRadius: Radius.lg, padding: rs(12), marginBottom: rs(16),
  },
  photoBtn: {
    width: rs(56), height: rs(56), borderRadius: rs(28), overflow: 'hidden',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    alignItems: 'center', justifyContent: 'center',
  },
  photo: { width: '100%', height: '100%' },
  photoTitle: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  photoHint: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(2), lineHeight: rf(16) },

  label: { fontSize: rf(13), fontWeight: '700', color: Colors.textPrimary, marginBottom: rs(6) },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: Radius.md,
    paddingHorizontal: rs(14), paddingVertical: rs(12),
    fontSize: rf(16), color: Colors.textPrimary, width: rs(96), marginBottom: rs(18),
  },

  primary: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg,
    paddingVertical: rs(14), alignItems: 'center', marginBottom: rs(10),
  },
  primaryTxt: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
  skip: { textAlign: 'center', fontSize: rf(14), color: Colors.textMuted, paddingVertical: rs(6) },
});
