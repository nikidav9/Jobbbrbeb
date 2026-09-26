import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  KeyboardAvoidingView, Platform, Linking, ActivityIndicator, Switch, Alert,
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
  jupiterLiveState, jupiterSetLive,
  dbGetMarketingConsent, dbSetMarketingConsent,
} from '@/services/db';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { resetOnboarding } from '@/components/OnboardingOverlay';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoNotifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import { LEGAL_DOCS, type LegalDocKey } from '@/constants/legal';
import {
  NOTIFICATION_DISABLED_KEY, registerForPushNotifications,
} from '@/services/notifications';
import { registerWebPush, getWebPushDebug, isWebPushRegistered } from '@/lib/webPush';
import { clearRuntimeCache } from '@/services/storage';

const NOTIFICATION_CHOICE_KEY = 'jm_notif_prompt_choice';

type NotificationState = 'checking' | 'enabled' | 'disabled' | 'blocked' | 'unavailable' | 'error';

const ABOUT_DOCS: {
  key: LegalDocKey;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { key: 'terms', icon: 'document-text-outline' },
  { key: 'privacy', icon: 'shield-checkmark-outline' },
  { key: 'consent', icon: 'checkmark-circle-outline' },
  { key: 'dataPolicy', icon: 'lock-closed-outline' },
  { key: 'marketing', icon: 'megaphone-outline' },
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

  const [showLogout, setShowLogout] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [notificationState, setNotificationState] = useState<NotificationState>('checking');
  const [notificationBusy, setNotificationBusy] = useState(false);

  const [jupiterLive, setJupiterLive] = useState(false);
  const [jupiterBusy, setJupiterBusy] = useState(false);

  useEffect(() => {
    if (!currentUser || currentUser.isGuest || currentUser.role !== 'worker') return;
    jupiterLiveState(currentUser.id)
      .then(state => setJupiterLive(state.enabled))
      .catch(error => console.warn('[jupiterLiveState]', error));
  }, [currentUser]);

  const toggleJupiterLive = async (next: boolean) => {
    if (!currentUser) return;
    if (!next) {
      const message = 'Выключить автоотклик? Новые отклики не будут отправляться, неотправленные остановятся. Уже отправленные работодателю отозвать через JobToo нельзя.';
      const confirmed = Platform.OS === 'web'
        ? typeof window !== 'undefined' && window.confirm(message)
        : await new Promise<boolean>(resolve => Alert.alert('Автоотклик Юпитера', message, [
            { text: 'Отмена', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Выключить', style: 'destructive', onPress: () => resolve(true) },
          ], { cancelable: true, onDismiss: () => resolve(false) }));
      if (!confirmed) return;
    }
    setJupiterBusy(true);
    try {
      await jupiterSetLive(currentUser.id, next);
      setJupiterLive(next);
    } catch (error) {
      console.warn('[jupiterSetLive]', error);
      showToast('Не удалось изменить автоотклик', 'error');
    } finally {
      setJupiterBusy(false);
    }
  };
  // Рекламная рассылка (38-ФЗ, ст. 18): переключатель — и способ дать
  // согласие, и способ его отозвать. Показываем то, что записано на сервере.
  const [adsOn, setAdsOn] = useState(false);
  const [adsBusy, setAdsBusy] = useState(false);

  useEffect(() => {
    if (!currentUser || currentUser.isGuest) return;
    dbGetMarketingConsent(currentUser.id)
      .then(st => setAdsOn(st.on))
      .catch(error => console.warn('[dbGetMarketingConsent]', error));
  }, [currentUser]);

  const toggleAds = async (next: boolean) => {
    if (!currentUser) return;
    setAdsBusy(true);
    try {
      const st = await dbSetMarketingConsent(currentUser.id, next, LEGAL_DOCS.marketing.version, 'settings');
      setAdsOn(st.on);
      showToast(st.on ? 'Рекламная рассылка включена' : 'Рекламная рассылка отключена', 'success');
    } catch (error) {
      console.warn('[dbSetMarketingConsent]', error);
      showToast(error instanceof Error ? error.message : 'Не удалось изменить рассылку', 'error');
    } finally {
      setAdsBusy(false);
    }
  };
  const [notificationMessage, setNotificationMessage] = useState('');
  const [refreshBusy, setRefreshBusy] = useState(false);

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

  const clearCacheAndRefresh = async () => {
    if (refreshBusy) return;
    setRefreshBusy(true);

    try {
      // Чистим только временные данные. Сессию, push-настройки и онбординг
      // сохраняем, поэтому после обновления пользователь остаётся в аккаунте.
      await clearRuntimeCache();

      if (Platform.OS === 'web') {
        const web = globalThis as any;
        if (web.caches?.keys) {
          const names: string[] = await web.caches.keys();
          await Promise.all(
            names
              .filter(name => name.startsWith('jobtoo-app-shell-'))
              .map(name => web.caches.delete(name)),
          );
        }

        showToast('Кеш очищен. Загружаем свежую версию…', 'success');

        // Cache-buster заставляет браузер запросить актуальный app shell,
        // а удалённый service-worker cache уже не сможет вернуть старую сборку.
        setTimeout(() => {
          try {
            const url = new URL(web.location.href);
            url.searchParams.set('_jt_refresh', Date.now().toString());
            web.location.replace(url.toString());
          } catch {
            web.location.reload();
          }
        }, 250);
        return;
      }

      if (!__DEV__ && Updates.isEnabled) {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          showToast('Обновление загружено. Перезапускаем JobToo…', 'success');
        } else {
          showToast('Кеш очищен. Обновляем данные приложения…', 'success');
        }

        // Внутренний reload: приложение не нужно закрывать вручную и вход
        // в аккаунт не сбрасывается.
        await Updates.reloadAsync();
        return;
      }

      // В dev/сборках без expo-updates всё равно очищаем данные и возвращаемся
      // в профиль; production-сборки проходят ветку reloadAsync выше.
      showToast('Кеш очищен', 'success');
      router.replace('/(tabs)/profile');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Не удалось очистить кеш и обновить приложение',
        'error',
      );
    } finally {
      setRefreshBusy(false);
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
          onPress={() => router.replace('/(tabs)/profile')}
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

        {currentUser.role === 'worker' ? (
          <SettingsSection title="Юпитер">
            <View style={[s.row, { alignItems: 'flex-start' }]}>
              <View style={s.rowIcon}>
                <Ionicons name="rocket-outline" size={rf(18)} color={Colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: rs(11) }}>
                  <Text style={[s.rowLabel, { flex: 1 }]}>Автоотклик Юпитера</Text>
                  <Switch
                    value={jupiterLive}
                    onValueChange={toggleJupiterLive}
                    disabled={jupiterBusy}
                  />
                </View>
                <Text style={s.jupiterHint}>
                  Юпитер сам отправляет отклики на вакансии с сайтов компаний. Капчу, коды и согласия,
                  которые компания просит от своего имени, вы проходите сами.
                </Text>
              </View>
            </View>
          </SettingsSection>
        ) : null}

        {!currentUser.isGuest ? (
          <SettingsSection title="Рассылки">
            <View style={[s.row, { alignItems: 'flex-start' }]}>
              <View style={s.rowIcon}>
                <Ionicons name="megaphone-outline" size={rf(18)} color={Colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: rs(11) }}>
                  <Text style={[s.rowLabel, { flex: 1 }]}>Рекламные рассылки</Text>
                  <Switch
                    value={adsOn}
                    onValueChange={toggleAds}
                    disabled={adsBusy}
                    accessibilityLabel="Рекламные рассылки"
                  />
                </View>
                <Text style={s.jupiterHint}>
                  Подборки вакансий, новые функции и акции JobToo — на почту и в уведомлениях.
                  Коды входа и служебные письма приходят независимо от этой настройки.{' '}
                  <Text
                    style={{ color: Colors.primary }}
                    onPress={() => router.push({ pathname: '/legal', params: { doc: 'marketing' } })}
                  >
                    Условия
                  </Text>
                </Text>
              </View>
            </View>
          </SettingsSection>
        ) : null}

        <SettingsSection title="Приложение">
          <SettingsRow
            label={refreshBusy ? 'Обновляем…' : 'Очистить кеш и обновить'}
            icon="refresh-circle-outline"
            onPress={clearCacheAndRefresh}
            last
          />
        </SettingsSection>

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
            onPress={() => setShowLogout(true)}
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
        visible={showLogout}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogout(false)}
      >
        <View style={s.confirmOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowLogout(false)}
          />
          <View style={s.confirmCard}>
            <View style={s.confirmIcon}>
              <Ionicons name="log-out-outline" size={rf(24)} color={Colors.red} />
            </View>
            <Text style={s.confirmTitle}>Выйти из аккаунта?</Text>
            <Text style={s.confirmText}>
              Чтобы вернуться, понадобится снова войти по номеру телефона.
            </Text>
            <View style={s.confirmActions}>
              <PrimaryButton
                label="Выйти"
                onPress={async () => {
                  setShowLogout(false);
                  await performLogout();
                }}
              />
              <PrimaryButton
                label="Отмена"
                onPress={() => setShowLogout(false)}
                secondary
              />
            </View>
          </View>
        </View>
      </Modal>

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
  jupiterHint: { fontSize: rf(12), lineHeight: rf(16.5), color: Colors.textMuted, marginTop: rs(6) },
  footer: {
    fontSize: rf(11.5),
    lineHeight: rf(17),
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: rs(18),
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: rs(22),
  },
  confirmCard: {
    width: '100%',
    maxWidth: rs(380),
    borderRadius: rs(22),
    backgroundColor: '#FFFFFF',
    paddingHorizontal: rs(20),
    paddingVertical: rs(22),
    ...Shadow.card,
  },
  confirmIcon: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(24),
    backgroundColor: Colors.redLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  confirmTitle: {
    marginTop: rs(14),
    fontSize: rf(19),
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  confirmText: {
    marginTop: rs(7),
    fontSize: rf(12.5),
    lineHeight: rf(18),
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  confirmActions: { gap: rs(9), marginTop: rs(20) },
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
