import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  KeyboardAvoidingView, Platform, Alert, Linking, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { useApp } from '@/hooks/useApp';
import {
  dbChangePassword, dbDeleteAccount, dbClearPushToken,
  dbDeleteWebPushSubscription, dbGetCrossBorderConsent,
} from '@/services/db';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { resetOnboarding } from '@/components/OnboardingOverlay';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoNotifications from 'expo-notifications';
import { LEGAL_DOCS, type LegalDocKey } from '@/constants/legal';
import {
  NOTIFICATION_DISABLED_KEY, registerForPushNotifications,
} from '@/services/notifications';
import { registerWebPush, getWebPushDebug, isWebPushRegistered } from '@/lib/webPush';

const NOTIFICATION_CHOICE_KEY = 'jm_notif_prompt_choice';

type NotificationState = 'checking' | 'enabled' | 'disabled' | 'blocked' | 'unavailable' | 'error';

const ABOUT_DOCS: {
  key: LegalDocKey;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { key: 'terms', icon: 'document-text-outline' },
  { key: 'privacy', icon: 'shield-checkmark-outline' },
  { key: 'consent', icon: 'checkmark-circle-outline' },
  { key: 'crossBorderConsent', icon: 'globe-outline' },
  { key: 'dataPolicy', icon: 'lock-closed-outline' },
];

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

  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [notificationState, setNotificationState] = useState<NotificationState>('checking');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');

  const refreshNotificationState = async () => {
    setNotificationState('checking');
    setNotificationMessage('');
    const disabled = await AsyncStorage.getItem(NOTIFICATION_DISABLED_KEY).catch(() => null);
    if (disabled === '1') {
      setNotificationState('disabled');
      setNotificationMessage('Уведомления отключены в JobToo.');
      return;
    }

    if (Platform.OS === 'web') {
      const BrowserNotification = (globalThis as any).Notification;
      if (!BrowserNotification) {
        setNotificationState('unavailable');
        setNotificationMessage('Этот браузер не поддерживает push-уведомления.');
        return;
      }
      if (BrowserNotification.permission === 'granted') {
        if (isWebPushRegistered()) {
          setNotificationState('enabled');
          setNotificationMessage('Уведомления включены и web-push подключён.');
        } else {
          setNotificationState('disabled');
          setNotificationMessage('Разрешение уже выдано, но доставка push ещё не подключена. Нажмите «Включить уведомления».');
        }
      } else if (BrowserNotification.permission === 'denied') {
        setNotificationState('blocked');
        setNotificationMessage('Уведомления заблокированы в настройках браузера или iPhone.');
      } else {
        setNotificationState('disabled');
        setNotificationMessage('Уведомления ещё не включены.');
      }
      return;
    }

    try {
      const permission = await ExpoNotifications.getPermissionsAsync();
      if (permission.status === 'granted') {
        setNotificationState('enabled');
        setNotificationMessage('Уведомления разрешены на этом устройстве.');
      } else if (permission.status === 'denied' && permission.canAskAgain === false) {
        setNotificationState('blocked');
        setNotificationMessage('Уведомления запрещены системой. Откройте настройки устройства.');
      } else {
        setNotificationState('disabled');
        setNotificationMessage('Уведомления ещё не включены.');
      }
    } catch {
      setNotificationState('error');
      setNotificationMessage('Не удалось проверить разрешение на уведомления.');
    }
  };

  const openNotificationSettings = () => {
    setShowNotificationSettings(true);
    refreshNotificationState().catch(() => {});
  };

  const enableNotifications = async () => {
    if (!currentUser || notificationBusy) return;
    setNotificationBusy(true);
    setNotificationMessage('');
    try {
      const crossBorder = await dbGetCrossBorderConsent(currentUser.id).catch(() => null);
      if (crossBorder?.accepted !== true) {
        setNotificationState('error');
        setNotificationMessage('Сначала подтвердите отдельное согласие на трансграничную передачу данных для push-уведомлений.');
        return;
      }

      await AsyncStorage.removeItem(NOTIFICATION_DISABLED_KEY).catch(() => {});
      let ok = false;

      if (Platform.OS === 'web') {
        ok = await registerWebPush(currentUser.id);
        if (!ok) {
          const BrowserNotification = (globalThis as any).Notification;
          if (BrowserNotification?.permission === 'denied') {
            setNotificationState('blocked');
            setNotificationMessage('Разрешение заблокировано. На iPhone откройте Настройки → Уведомления → JobToo.');
            return;
          }
        }
      } else {
        let permission = await ExpoNotifications.getPermissionsAsync();
        if (permission.status !== 'granted' && permission.canAskAgain !== false) {
          permission = await ExpoNotifications.requestPermissionsAsync();
        }
        if (permission.status === 'granted') {
          ok = await registerForPushNotifications(currentUser.id);
        } else if (permission.canAskAgain === false) {
          setNotificationState('blocked');
          setNotificationMessage('Разрешение заблокировано системой. Откройте настройки устройства.');
          return;
        }
      }

      if (!ok) {
        setNotificationState('error');
        setNotificationMessage(
          Platform.OS === 'web'
            ? (getWebPushDebug() || 'Не удалось подключить web-push. Попробуйте ещё раз.')
            : 'Разрешение получено, но push-токен не зарегистрировался. Проверьте интернет и повторите.',
        );
        return;
      }

      await AsyncStorage.setItem(NOTIFICATION_CHOICE_KEY, 'enabled').catch(() => {});
      setNotificationState('enabled');
      setNotificationMessage('Уведомления включены и устройство зарегистрировано.');
      showToast('Уведомления включены', 'success');
    } catch (error) {
      setNotificationState('error');
      setNotificationMessage(error instanceof Error ? error.message : 'Не удалось включить уведомления.');
    } finally {
      setNotificationBusy(false);
    }
  };

  const disableNotifications = async () => {
    if (!currentUser || notificationBusy) return;
    setNotificationBusy(true);
    try {
      await AsyncStorage.setItem(NOTIFICATION_DISABLED_KEY, '1');
      await AsyncStorage.removeItem(NOTIFICATION_CHOICE_KEY).catch(() => {});
      if (Platform.OS === 'web') {
        await dbDeleteWebPushSubscription(currentUser.id);
      } else {
        await dbClearPushToken(currentUser.id);
      }
      setNotificationState('disabled');
      setNotificationMessage('Уведомления отключены в JobToo.');
      showToast('Уведомления отключены', 'success');
    } catch (error) {
      setNotificationState('error');
      setNotificationMessage(error instanceof Error ? error.message : 'Не удалось отключить уведомления.');
    } finally {
      setNotificationBusy(false);
    }
  };

  const performLogout = async () => {
    try {
      await logout();
    } catch {
      showToast('Не удалось корректно завершить сессию, но локальный вход будет сброшен.', 'error');
    } finally {
      router.replace('/');
    }
  };

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
      router.replace('/');
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
            onPress={openNotificationSettings}
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
          {ABOUT_DOCS.map((doc, index) => (
            <SettingsRow
              key={doc.key}
              label={LEGAL_DOCS[doc.key].title}
              icon={doc.icon}
              onPress={() => router.push({ pathname: '/legal', params: { doc: doc.key } })}
              last={index === ABOUT_DOCS.length - 1}
            />
          ))}
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
                  onPress: performLogout,
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
        visible={showNotificationSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNotificationSettings(false)}
      >
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowNotificationSettings(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Уведомления</Text>
            <View style={s.notificationStatus}>
              {notificationState === 'checking'
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : (
                  <Ionicons
                    name={
                      notificationState === 'enabled'
                        ? 'checkmark-circle'
                        : notificationState === 'blocked'
                        ? 'alert-circle'
                        : 'notifications-off-outline'
                    }
                    size={rf(22)}
                    color={
                      notificationState === 'enabled'
                        ? Colors.green
                        : notificationState === 'blocked' || notificationState === 'error'
                        ? Colors.red
                        : Colors.textSecondary
                    }
                  />
                )}
              <Text style={s.notificationStatusText}>
                {notificationMessage || 'Проверяем состояние уведомлений…'}
              </Text>
            </View>

            <View style={s.sheetActions}>
              {notificationState !== 'enabled' ? (
                <PrimaryButton
                  label={notificationBusy ? 'Подключаем…' : 'Включить уведомления'}
                  onPress={enableNotifications}
                  disabled={notificationBusy}
                />
              ) : (
                <PrimaryButton
                  label={notificationBusy ? 'Отключаем…' : 'Отключить уведомления'}
                  onPress={disableNotifications}
                  disabled={notificationBusy}
                  secondary
                />
              )}
              {Platform.OS !== 'web' && notificationState === 'blocked' ? (
                <PrimaryButton
                  label="Открыть настройки устройства"
                  onPress={() => {
                    Linking.openSettings().catch(() => {
                      showToast('Не удалось открыть настройки устройства', 'error');
                    });
                  }}
                  secondary
                />
              ) : null}
              <PrimaryButton label="Закрыть" onPress={() => setShowNotificationSettings(false)} secondary />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
  notificationStatus: {
    marginTop: rs(18),
    minHeight: rs(64),
    borderRadius: rs(14),
    backgroundColor: '#F6F7F8',
    paddingHorizontal: rs(14),
    paddingVertical: rs(12),
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(10),
  },
  notificationStatusText: {
    flex: 1,
    fontSize: rf(12.5),
    lineHeight: rf(18),
    color: Colors.textSecondary,
  },
  sheetActions: { gap: rs(9), marginTop: rs(18) },
});
