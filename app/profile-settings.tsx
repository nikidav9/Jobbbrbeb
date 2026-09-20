import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  KeyboardAvoidingView, Platform, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { useApp } from '@/hooks/useApp';
import { dbChangePassword, dbDeleteAccount } from '@/services/db';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { resetOnboarding } from '@/components/OnboardingOverlay';

type RowProps = {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
};

function SettingsRow({ label, icon, onPress, danger, last }: RowProps) {
  return (
    <TouchableOpacity
      style={[s.row, !last && s.rowBorder]}
      onPress={onPress}
      activeOpacity={0.72}
    >
      {icon ? (
        <View style={[s.rowIcon, danger && s.rowIconDanger]}>
          <Ionicons
            name={icon}
            size={rf(18)}
            color={danger ? Colors.red : Colors.textSecondary}
          />
        </View>
      ) : null}
      <Text style={[s.rowLabel, danger && s.rowLabelDanger]}>{label}</Text>
      {!danger ? <Ionicons name="chevron-forward" size={rf(17)} color={Colors.textMuted} /> : null}
    </TouchableOpacity>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const { currentUser, logout, showToast } = useApp();

  const [showPassword, setShowPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const savePassword = async () => {
    if (!currentUser || savingPassword) return;
    if (newPassword.length < 6) {
      showToast('Пароль должен быть не менее 6 символов', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Пароли не совпадают', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      const result = await dbChangePassword(currentUser.id, oldPassword, newPassword);
      if (!result.ok) {
        showToast('Неверный текущий пароль', 'error');
        return;
      }
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      showToast('Пароль изменён', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось сменить пароль', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const deleteAccount = async () => {
    if (!currentUser || deleting || !deletePassword.trim()) return;
    setDeleting(true);
    try {
      await dbDeleteAccount(currentUser.id, deletePassword);
      setShowDelete(false);
      setDeletePassword('');
      await logout();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось удалить аккаунт', 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (!currentUser) return <SafeAreaView style={s.safe} />;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity
          style={s.backButton}
          onPress={() => router.back()}
          activeOpacity={0.72}
        >
          <Ionicons name="chevron-back" size={rf(25)} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Настройки</Text>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection title="Аккаунт">
          <SettingsRow
            label="Помощь и обратная связь"
            icon="chatbubble-ellipses-outline"
            onPress={() => router.push('/support')}
          />
          <SettingsRow
            label="Настройки уведомлений"
            icon="notifications-outline"
            onPress={() => {
              Linking.openSettings().catch(() => {
                showToast('Не удалось открыть настройки устройства', 'error');
              });
            }}
          />
          <SettingsRow
            label="Сменить пароль"
            icon="key-outline"
            onPress={() => setShowPassword(true)}
            last
          />
        </SettingsSection>

        {currentUser.role === 'worker' ? (
          <SettingsSection title="JobToo">
            <SettingsRow
              label="Пригласить друга"
              icon="gift-outline"
              onPress={() => router.push('/invite')}
            />
            <SettingsRow
              label="Показать обучение снова"
              icon="refresh-outline"
              onPress={async () => {
                await resetOnboarding(currentUser.id);
                router.replace('/(tabs)/feed');
              }}
              last
            />
          </SettingsSection>
        ) : null}

        <SettingsSection title="О приложении">
          <SettingsRow
            label="Политика конфиденциальности"
            icon="shield-checkmark-outline"
            onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })}
          />
          <SettingsRow
            label="Пользовательское соглашение"
            icon="document-text-outline"
            onPress={() => router.push({ pathname: '/legal', params: { doc: 'terms' } })}
          />
          <SettingsRow
            label="Обработка персональных данных"
            icon="lock-closed-outline"
            onPress={() => router.push({ pathname: '/legal', params: { doc: 'dataPolicy' } })}
            last
          />
        </SettingsSection>

        <SettingsSection title="Важное">
          <SettingsRow
            label="Выйти из аккаунта"
            icon="log-out-outline"
            danger
            onPress={() => Alert.alert(
              'Выйти из аккаунта?',
              'Чтобы вернуться, понадобится снова войти.',
              [
                { text: 'Отмена', style: 'cancel' },
                {
                  text: 'Выйти',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await logout();
                    } catch {
                      showToast('Не удалось выйти. Попробуйте ещё раз.', 'error');
                    }
                  },
                },
              ],
            )}
          />
          <SettingsRow
            label="Удалить аккаунт"
            icon="trash-outline"
            danger
            onPress={() => setShowDelete(true)}
            last
          />
        </SettingsSection>

        <Text style={s.footer}>
          Настройки профиля и приватные документы доступны только владельцу аккаунта.
        </Text>
      </ScrollView>

      <Modal
        visible={showPassword}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPassword(false)}
      >
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowPassword(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Сменить пароль</Text>
            <View style={s.form}>
              <AppInput label="Текущий пароль" value={oldPassword} onChangeText={setOldPassword} secureTextEntry />
              <AppInput label="Новый пароль" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
              <AppInput label="Повторите новый пароль" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
            </View>
            <View style={s.sheetActions}>
              <PrimaryButton label="Сохранить" onPress={savePassword} disabled={savingPassword} />
              <PrimaryButton label="Отмена" onPress={() => setShowPassword(false)} secondary />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showDelete}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDelete(false)}
      >
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowDelete(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Удалить аккаунт?</Text>
            <Text style={s.sheetText}>
              Профиль и сохранённые резюме будут удалены. Это действие нельзя отменить.
            </Text>
            <View style={s.form}>
              <AppInput
                label="Пароль"
                value={deletePassword}
                onChangeText={setDeletePassword}
                secureTextEntry
                placeholder="Подтвердите пароль"
              />
            </View>
            <View style={s.sheetActions}>
              <PrimaryButton label={deleting ? 'Удаление…' : 'Удалить аккаунт'} onPress={deleteAccount} disabled={deleting || !deletePassword.trim()} />
              <PrimaryButton label="Отмена" onPress={() => setShowDelete(false)} secondary />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F6F8' },
  header: {
    minHeight: rs(68),
    paddingHorizontal: rs(18),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F6F6F8',
  },
  backButton: {
    width: rs(46),
    height: rs(46),
    borderRadius: rs(23),
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },
  headerTitle: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary },
  headerSpacer: { width: rs(46), height: rs(46) },
  scroll: { paddingHorizontal: rs(18), paddingTop: rs(12), paddingBottom: rs(48), gap: rs(24) },
  section: { gap: rs(10) },
  sectionTitle: { fontSize: rf(17), fontWeight: '800', color: Colors.textPrimary, paddingHorizontal: rs(4) },
  card: { backgroundColor: '#FFFFFF', borderRadius: rs(18), overflow: 'hidden', ...Shadow.card },
  row: {
    minHeight: rs(66),
    paddingHorizontal: rs(15),
    paddingVertical: rs(12),
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(11),
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.divider },
  rowIcon: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(10),
    backgroundColor: '#F4F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: Colors.redLight },
  rowLabel: { flex: 1, fontSize: rf(14.5), fontWeight: '600', color: Colors.textPrimary },
  rowLabelDanger: { color: Colors.red },
  footer: {
    fontSize: rf(11.5),
    lineHeight: rf(17),
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: rs(18),
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: rs(24),
    borderTopRightRadius: rs(24),
    paddingHorizontal: rs(18),
    paddingTop: rs(10),
    paddingBottom: rs(28),
  },
  sheetHandle: {
    width: rs(42),
    height: rs(5),
    borderRadius: rs(3),
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: rs(14),
  },
  sheetTitle: { fontSize: rf(19), fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  sheetText: {
    fontSize: rf(12.5),
    lineHeight: rf(18),
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: rs(8),
  },
  form: { gap: rs(10), marginTop: rs(18) },
  sheetActions: { gap: rs(9), marginTop: rs(18) },
});
