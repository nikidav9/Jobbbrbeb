import { DeleteAccountSheet } from '@/components/feature/DeleteAccountSheet';
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Linking, ActivityIndicator, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { useApp } from '@/hooks/useApp';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';
import {
  dbChangePassword, dbClearPushToken,
  dbDeleteWebPushSubscription,
  dbGetMarketingConsent, dbSetMarketingConsent,
} from '@/services/db';
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
import { BackButton } from '@/components/ui/BackButton';
import { JT } from '@/constants/jt';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import {
  BottomSheet, ConfirmDialog, Field, HardShadowBox, CloseIcon, CheckIcon, ChevronRightIcon,
} from '@/components/profile/edit';

const NOTIFICATION_CHOICE_KEY = 'jm_notif_prompt_choice';
const DANGER = EditColors.danger;

type NotificationState = 'checking' | 'enabled' | 'disabled' | 'blocked' | 'unavailable' | 'error';
type IonName = React.ComponentProps<typeof Ionicons>['name'];

const ABOUT_DOCS: { key: LegalDocKey; icon: IonName }[] = [
  { key: 'terms', icon: 'document-text-outline' },
  { key: 'privacy', icon: 'shield-checkmark-outline' },
  { key: 'consent', icon: 'checkmark-circle-outline' },
  { key: 'dataPolicy', icon: 'lock-closed-outline' },
  { key: 'marketing', icon: 'megaphone-outline' },
  { key: 'employers', icon: 'business-outline' },
];

// Иконки плиток — пути из docs/design/settings-help/03-settings.html.
const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' } as const;
const stroke = { stroke: JT.ink, strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const ChatIcon = () => (
  <Svg {...iconProps}>
    <Path d="M4 5h16v11H9l-5 4z" {...stroke} />
    <Path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01" stroke={JT.ink} strokeWidth={3} strokeLinecap="round" />
  </Svg>
);
const BellIcon = ({ size = 20, color = JT.ink }: { size?: number; color?: string }) => (
  <Svg {...iconProps} width={size} height={size}>
    <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" {...stroke} stroke={color} />
    <Path d="M10 20a2 2 0 0 0 4 0" {...stroke} stroke={color} />
  </Svg>
);
const KeyIcon = ({ size = 20 }: { size?: number }) => (
  <Svg {...iconProps} width={size} height={size}>
    <Circle cx="8" cy="15" r="4" {...stroke} />
    <Path d="M11 12l8-8M16 7l2 2M14 9l2 2" {...stroke} />
  </Svg>
);
const GiftIcon = () => (
  <Svg {...iconProps}>
    <Rect x="3" y="8" width="18" height="5" rx="1" {...stroke} />
    <Path d="M5 13v8h14v-8M12 8v13" {...stroke} />
    <Path d="M12 8C10 4 6 4 6 6.5S9 8 12 8c3 0 6 .5 6-1.5S14 4 12 8z" {...stroke} />
  </Svg>
);
const RefreshIcon = () => (
  <Svg {...iconProps}>
    <Path d="M20 12a8 8 0 1 1-2.3-5.7" {...stroke} />
    <Path d="M20 4v5h-5" {...stroke} />
  </Svg>
);
const LogoutIcon = () => (
  <Svg {...iconProps}>
    <Path d="M15 4h4v16h-4" stroke={DANGER} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M10 8l-4 4l4 4M6 12h10" stroke={DANGER} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const EyeIcon = ({ color }: { color: string }) => (
  <Svg {...iconProps}>
    <Path d="M2 12s3.5-7 10-7s10 7 10 7s-3.5 7-10 7S2 12 2 12z" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

function Tile({ children, size = 40, radius = 12 }: { children: React.ReactNode; size?: number; radius?: number }) {
  return <View style={[s.tile, { width: size, height: size, borderRadius: radius }]}>{children}</View>;
}

function Row({
  label, icon, ionIcon, value, onPress, last,
}: {
  label: string;
  icon?: React.ReactNode;
  ionIcon?: IonName;
  value?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.row, !last && s.rowBorder]}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
    >
      <Tile>{icon ?? <Ionicons name={ionIcon ?? 'ellipse-outline'} size={20} color={JT.ink} />}</Tile>
      <Text style={s.rowTitle}>{label}</Text>
      {value ? <Text style={s.rowValue}>{value}</Text> : null}
      <ChevronRightIcon size={18} />
    </TouchableOpacity>
  );
}

function SwitchRow({
  label, ionIcon, value, onChange, disabled, hint, last,
}: {
  label: string;
  ionIcon: IonName;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hint: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[s.switchRow, !last && s.rowBorder]}>
      <View style={s.switchTop}>
        <Tile><Ionicons name={ionIcon} size={20} color={JT.ink} /></Tile>
        <Text style={s.rowTitle}>{label}</Text>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          accessibilityLabel={label}
          trackColor={{ false: EditColors.disabledBg, true: JT.accent }}
          thumbColor={JT.surface}
        />
      </View>
      <Text style={s.hint}>{hint}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Text style={s.sectionLabel}>{title}</Text>
      <View style={s.card}>{children}</View>
    </>
  );
}

type BtnKind = 'primary' | 'outline' | 'ghost';
function Btn({
  kind, label, onPress, disabled, danger, icon,
}: { kind: BtnKind; label: string; onPress: () => void; disabled?: boolean; danger?: boolean; icon?: React.ReactNode }) {
  const inner = (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      style={[
        s.btn,
        kind === 'primary' && (disabled ? s.btnDisabled : s.btnPrimary),
        kind === 'outline' && (disabled ? s.btnDisabled : s.btnOutline),
        kind === 'ghost' && s.btnGhost,
        danger && !disabled && { borderColor: DANGER },
        icon ? { flexDirection: 'row', gap: 8 } : null,
      ]}
    >
      {icon}
      <Text
        style={[
          s.btnText,
          kind === 'ghost' && s.btnGhostText,
          disabled && kind !== 'ghost' && s.btnTextDisabled,
          danger && !disabled && { color: DANGER },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
  if (kind === 'primary' && !disabled) {
    return <HardShadowBox radius={29} offset={4}>{inner}</HardShadowBox>;
  }
  return inner;
}

function SheetHeader({ title, tile, onClose }: { title: string; tile: React.ReactNode; onClose: () => void }) {
  return (
    <View style={s.sheetHeader}>
      <Tile size={44} radius={13}>{tile}</Tile>
      <Text style={s.sheetTitle} numberOfLines={1}>{title}</Text>
      <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityLabel="Закрыть" accessibilityRole="button">
        <CloseIcon size={16} />
      </TouchableOpacity>
    </View>
  );
}

function PasswordField({
  label, value, onChangeText, placeholder, error,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Field
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        right={(
          <TouchableOpacity
            onPress={() => setVisible(v => !v)}
            style={s.eye}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Скрыть пароль' : 'Показать пароль'}
          >
            <EyeIcon color={value ? JT.ink : EditColors.textTertiary} />
          </TouchableOpacity>
        )}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const { currentUser, logout, showToast } = useApp();
  const insets = useSafeAreaInsets();
  useWarmSystemBar();

  const [showPassword, setShowPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [wrongOldPassword, setWrongOldPassword] = useState(false);

  const [showLogout, setShowLogout] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [notificationState, setNotificationState] = useState<NotificationState>('checking');
  const [notificationBusy, setNotificationBusy] = useState(false);

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

  // Статус «Вкл/Выкл» в строке настроек показываем по реальному состоянию.
  useEffect(() => {
    refreshNotificationState().catch(() => {});
  }, []);

  const openNotificationSettings = () => {
    setShowNotificationSettings(true);
    refreshNotificationState().catch(() => {});
  };

  const enableNotifications = async () => {
    if (!currentUser || notificationBusy) return;
    setNotificationBusy(true);
    setNotificationMessage('');
    try {
      // Отдельное согласие на трансграничную передачу для пушей больше не
      // нужно: пуш обезличен (push_privacy.php, docs/MAP.md). Проверка здесь
      // оставалась и не давала включить уведомления — дать согласие было негде.
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
    setWrongOldPassword(false);
    try {
      const result = await dbChangePassword(currentUser.id, oldPassword, newPassword);
      if (!result.ok) {
        setWrongOldPassword(true);
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

  const closePasswordSheet = () => {
    setShowPassword(false);
    setOldPassword(''); setNewPassword(''); setConfirmPassword('');
    setWrongOldPassword(false);
  };

  const goSetPasswordByCode = () => {
    router.push({ pathname: '/reset-password', params: { returnTo: 'profile-settings', mode: 'set' } });
  };

  if (!currentUser) return <View style={s.screen} />;

  const isWorker = currentUser.role === 'worker';
  const noPassword = currentUser.hasPassword === false;
  const passwordFilled = !!oldPassword && !!newPassword && !!confirmPassword;
  const mismatch = !!confirmPassword && newPassword !== confirmPassword;
  const tooShort = !!newPassword && newPassword.length < 6;
  const canSavePassword = passwordFilled && !mismatch && !tooShort && !savingPassword;
  const notificationValue = notificationState === 'checking' ? '' : notificationState === 'enabled' ? 'Вкл' : 'Выкл';

  const notificationTitle = {
    checking: 'Проверяем состояние…',
    enabled: 'Уведомления включены',
    disabled: 'Уведомления выключены',
    blocked: 'Уведомления заблокированы',
    unavailable: 'Уведомления недоступны',
    error: 'Что-то пошло не так',
  }[notificationState];

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <BackButton
          onPress={() => router.replace('/(tabs)/profile')}
          label="Назад в профиль"
          style={s.backBtn}
        />
        <Text style={s.headerTitle} pointerEvents="none">Настройки</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Section title="Аккаунт">
          <Row
            label="Помощь и обратная связь"
            icon={<ChatIcon />}
            onPress={() => router.push('/support')}
          />
          {/* Банк ответов на вопросы работодателей: что Юпитер подставит сам. */}
          <Row
            label="Мои ответы для работодателей"
            ionIcon="document-text-outline"
            onPress={() => router.push('/jupiter-answers')}
          />
          <Row
            label="Уведомления"
            icon={<BellIcon />}
            value={notificationValue}
            onPress={openNotificationSettings}
          />
          {/* Аккаунт по коду из письма пароля не имеет: «Сменить» с полем
              «текущий пароль» ему не пройти. Такому сразу — задать по коду. */}
          <Row
            label={currentUser.hasPassword === false ? 'Задать пароль' : 'Сменить пароль'}
            icon={<KeyIcon />}
            onPress={() => {
              // Регистрация «почта → код» (27.09.2026) пароля не заводит —
              // «Сменить пароль» на таком аккаунте всегда отвечал бы «неверный
              // пароль». Ведём сразу туда, откуда пароль реально берётся.
              if (noPassword) goSetPasswordByCode();
              else setShowPassword(true);
            }}
          />
          {!currentUser.isGuest ? (
            <SwitchRow
              label="Рекламные рассылки"
              ionIcon="megaphone-outline"
              value={adsOn}
              onChange={toggleAds}
              disabled={adsBusy}
              hint={(
                <>
                  Подборки вакансий, новые функции и акции JobToo — на почту и в уведомлениях.
                  Коды входа и служебные письма приходят независимо от этой настройки.{' '}
                  <Text
                    style={s.hintLink}
                    onPress={() => router.push({ pathname: '/legal', params: { doc: 'marketing' } })}
                  >
                    Условия
                  </Text>
                </>
              )}
            />
          ) : null}
          <Row
            label="Удалить аккаунт"
            ionIcon="trash-outline"
            onPress={() => setShowDelete(true)}
            last
          />
        </Section>

        <Section title="JobToo">
          {isWorker ? (
            <Row label="Пригласить друга" icon={<GiftIcon />} onPress={() => router.push('/invite')} />
          ) : null}
          {isWorker ? (
            <Row
              label="Показать обучение снова"
              icon={<RefreshIcon />}
              onPress={async () => {
                await resetOnboarding(currentUser.id);
                router.replace('/(tabs)/feed');
              }}
            />
          ) : null}
          <Row
            label={refreshBusy ? 'Обновляем…' : 'Очистить кеш и обновить'}
            ionIcon="refresh-circle-outline"
            onPress={clearCacheAndRefresh}
          />
          {ABOUT_DOCS.map((doc, index) => (
            <Row
              key={doc.key}
              label={LEGAL_DOCS[doc.key].title}
              ionIcon={doc.icon}
              onPress={() => router.push({ pathname: '/legal', params: { doc: doc.key } })}
              last={index === ABOUT_DOCS.length - 1}
            />
          ))}
        </Section>

        <View style={{ marginTop: 28 }}>
          <Btn kind="outline" danger icon={<LogoutIcon />} label="Выйти из аккаунта" onPress={() => setShowLogout(true)} />
        </View>

        <Text style={s.footer}>
          Настройки профиля и приватные документы доступны только владельцу аккаунта.
        </Text>
      </ScrollView>

      <ConfirmDialog
        visible={showLogout}
        title="Выйти из аккаунта?"
        message="Чтобы вернуться, понадобится снова войти."
        confirmLabel="Выйти"
        cancelLabel="Отмена"
        onConfirm={async () => {
          setShowLogout(false);
          await performLogout();
        }}
        onCancel={() => setShowLogout(false)}
        onDismiss={() => setShowLogout(false)}
      />

      <BottomSheet visible={showNotificationSettings} onClose={() => setShowNotificationSettings(false)}>
        <SheetHeader title="Уведомления" tile={<BellIcon size={22} />} onClose={() => setShowNotificationSettings(false)} />
        <View style={s.statusBox}>
          {notificationState === 'checking' ? (
            <View style={s.statusCircleOff}><ActivityIndicator size="small" color={JT.accent} /></View>
          ) : notificationState === 'enabled' ? (
            <View style={s.statusCircleOn}><CheckIcon size={18} color={JT.accent} /></View>
          ) : (
            <View style={s.statusCircleOff}><BellIcon size={18} color={notificationState === 'blocked' || notificationState === 'error' ? DANGER : JT.ink} /></View>
          )}
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.statusTitle}>{notificationTitle}</Text>
            {notificationMessage ? <Text style={s.small}>{notificationMessage}</Text> : null}
          </View>
        </View>
        <View style={{ marginTop: 22 }}>
          {notificationState !== 'enabled' ? (
            <Btn
              kind="primary"
              label={notificationBusy ? 'Подключаем…' : 'Включить уведомления'}
              onPress={enableNotifications}
              disabled={notificationBusy}
            />
          ) : (
            <Btn
              kind="outline"
              label={notificationBusy ? 'Отключаем…' : 'Отключить уведомления'}
              onPress={disableNotifications}
              disabled={notificationBusy}
            />
          )}
        </View>
        {Platform.OS !== 'web' && notificationState === 'blocked' ? (
          <View style={{ marginTop: 10 }}>
            <Btn
              kind="outline"
              label="Открыть настройки устройства"
              onPress={() => {
                Linking.openSettings().catch(() => {
                  showToast('Не удалось открыть настройки устройства', 'error');
                });
              }}
            />
          </View>
        ) : null}
        <View style={{ marginTop: 4 }}>
          <Btn kind="ghost" label="Закрыть" onPress={() => setShowNotificationSettings(false)} />
        </View>
      </BottomSheet>

      <BottomSheet visible={showPassword} onClose={closePasswordSheet}>
        <SheetHeader title="Сменить пароль" tile={<KeyIcon size={22} />} onClose={closePasswordSheet} />
        <View style={s.form}>
          <PasswordField
            label="Текущий пароль"
            value={oldPassword}
            onChangeText={t => { setOldPassword(t); setWrongOldPassword(false); }}
            error={wrongOldPassword ? 'Неверный текущий пароль' : undefined}
          />
          <PasswordField
            label="Новый пароль"
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Минимум 6 символов"
            error={tooShort ? 'Пароль должен быть не менее 6 символов' : undefined}
          />
          <PasswordField
            label="Повторите новый пароль"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Ещё раз"
            error={mismatch ? 'Пароли не совпадают' : undefined}
          />
        </View>
        {/* Аккаунт без пароля (регистрация «почта → код») никогда не
            пройдёт проверку текущего пароля — сервер отвечает
            wrong_password намеренно. Путь такому человеку — код из письма. */}
        <TouchableOpacity
          onPress={() => { closePasswordSheet(); goSetPasswordByCode(); }}
          accessibilityRole="button"
          style={{ alignSelf: 'center', marginTop: 18 }}
        >
          <Text style={s.link}>Нет пароля? Задайте его по коду из письма</Text>
        </TouchableOpacity>
        <View style={{ marginTop: 20 }}>
          <Btn
            kind="primary"
            label={savingPassword ? 'Сохраняем…' : 'Сохранить'}
            onPress={savePassword}
            disabled={!canSavePassword}
          />
        </View>
        <View style={{ marginTop: 4 }}>
          <Btn kind="ghost" label="Отмена" onPress={closePasswordSheet} />
        </View>
      </BottomSheet>

      <DeleteAccountSheet
        visible={showDelete}
        onClose={() => setShowDelete(false)}
        onDeleted={async () => {
          setShowDelete(false);
          await logout();
          showToast('Аккаунт удалён', 'success');
          router.replace('/');
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: JT.background },
  // Свой фон и zIndex: контент при прокрутке уходит под шапку (как в EditScreen).
  header: {
    paddingHorizontal: 20, paddingBottom: 12, minHeight: 44, justifyContent: 'center',
    backgroundColor: JT.background, zIndex: 1,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.surface, zIndex: 1, shadowOpacity: 0, elevation: 0,
  },
  headerTitle: {
    position: 'absolute', left: 0, right: 0, bottom: 12, textAlign: 'center',
    lineHeight: 44, fontFamily: EditFonts.heading, fontSize: 20, letterSpacing: -0.2, color: JT.ink,
  },
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48 },
  sectionLabel: {
    marginTop: 14, marginBottom: 10, fontFamily: EditFonts.heading, fontSize: 15, color: JT.ink,
  },
  card: { backgroundColor: JT.surface, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 4 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowBorder: { borderBottomWidth: 1.5, borderBottomColor: '#EFE7DC' },
  rowTitle: { flex: 1, fontFamily: EditFonts.text700, fontSize: 16, color: JT.ink },
  rowValue: { fontFamily: EditFonts.text800, fontSize: 13, color: EditColors.textTertiary },
  tile: { width: 40, height: 40, borderRadius: 12, backgroundColor: JT.accentSoft, alignItems: 'center', justifyContent: 'center' },
  switchRow: { paddingVertical: 12, gap: 8 },
  switchTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hint: { fontFamily: EditFonts.text600, fontSize: 13, lineHeight: 19, color: EditColors.textTertiary },
  hintLink: { fontFamily: EditFonts.text800, color: JT.ink, textDecorationLine: 'underline' },
  footer: {
    marginTop: 20, fontFamily: EditFonts.text600, fontSize: 12, lineHeight: 18,
    color: EditColors.textTertiary, textAlign: 'center',
  },
  btn: { height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', width: '100%' },
  btnPrimary: { borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.accent },
  btnOutline: { borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface },
  btnDisabled: { backgroundColor: EditColors.disabledBg },
  btnGhost: { height: 48 },
  btnText: { fontFamily: EditFonts.text800, fontSize: 17, color: JT.ink },
  btnTextDisabled: { color: EditColors.placeholder },
  btnGhostText: { color: EditColors.textTertiary },
  sheetHeader: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetTitle: { flex: 1, minWidth: 0, fontFamily: EditFonts.heading, fontSize: 19, letterSpacing: -0.19, color: JT.ink },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: EditColors.border,
    backgroundColor: JT.surface, alignItems: 'center', justifyContent: 'center',
  },
  form: { marginTop: 20, gap: 16 },
  eye: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  error: { fontFamily: EditFonts.text700, fontSize: 13, color: DANGER },
  link: {
    fontFamily: EditFonts.text800, fontSize: 14, color: JT.ink, textDecorationLine: 'underline',
  },
  small: { fontFamily: EditFonts.text600, fontSize: 13, lineHeight: 19, color: EditColors.textTertiary },
  statusBox: {
    marginTop: 20, padding: 16, borderRadius: 18, backgroundColor: JT.background,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  statusCircleOn: { width: 40, height: 40, borderRadius: 20, backgroundColor: JT.ink, alignItems: 'center', justifyContent: 'center' },
  statusCircleOff: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: JT.surface,
    borderWidth: 2, borderStyle: 'dashed', borderColor: JT.ink, alignItems: 'center', justifyContent: 'center',
  },
  statusTitle: { fontFamily: EditFonts.text800, fontSize: 16, color: JT.ink },
});
