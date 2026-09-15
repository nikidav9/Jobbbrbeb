from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'services/notifications.ts',
    """export async function registerForPushNotifications(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!Device.isDevice) {
    console.info('[push] Skipped push token registration: simulator/emulator detected.');
    return;
  }

  // Never trigger the OS permission dialog here — boot-time calls must stay
  // silent. The dialog is requested only from NotificationPermissionSheet.
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    console.info('[push] Permission not granted yet: skipping token registration.');
    return;
  }

  await setupAndroidChannels();

  const projectId = getExpoProjectId();
  if (!projectId) {
    console.warn('[push] Missing EAS projectId. Build with EAS and keep expo.extra.eas.projectId in app config.');
    return;
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await dbSavePushToken(userId, token);
    console.info('[push] Expo push token saved for user:', userId);
  } catch (error) {
    console.warn('[push] Failed to register Expo push token:', error);
  }
}""",
    """export async function registerForPushNotifications(userId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!Device.isDevice) {
    console.info('[push] Skipped push token registration: simulator/emulator detected.');
    return false;
  }

  try {
    // Never trigger the OS permission dialog here — boot-time calls must stay
    // silent. The dialog is requested only from NotificationPermissionSheet.
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      console.info('[push] Permission not granted yet: skipping token registration.');
      return false;
    }

    await setupAndroidChannels();

    const projectId = getExpoProjectId();
    if (!projectId) {
      console.warn('[push] Missing EAS projectId. Build with EAS and keep expo.extra.eas.projectId in app config.');
      return false;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await dbSavePushToken(userId, token);
    console.info('[push] Expo push token saved for user:', userId);
    return true;
  } catch (error) {
    console.warn('[push] Failed to register Expo push token:', error);
    return false;
  }
}""",
    'push registration result contract',
)

replace_once(
    'components/NotificationPermissionSheet.tsx',
    """          const { status } = await Notifications.getPermissionsAsync();
          if (status === 'granted') {
            await AsyncStorage.setItem(CHOICE_KEY, 'enabled');
            return;
          }
          // iOS: after a hard OS-level deny the dialog can't be re-shown — stop nagging""",
    """          const { status } = await Notifications.getPermissionsAsync();
          if (status === 'granted') {
            // Разрешение ОС само по себе ещё не означает работающий push:
            // токен должен реально получиться и сохраниться на сервере.
            const ok = await withTimeout(registerForPushNotifications(userId), ENABLE_TIMEOUT_MS).catch(() => false);
            if (ok) {
              await AsyncStorage.setItem(CHOICE_KEY, 'enabled');
              return;
            }
            // Токен не зарегистрировался — показываем лист и даём повторить.
          }
          // iOS: after a hard OS-level deny the dialog can't be re-shown — stop nagging""",
    'already granted native push verification',
)

replace_once(
    'components/NotificationPermissionSheet.tsx',
    """      } else {
        const { status } = await withTimeout(Notifications.requestPermissionsAsync(), ENABLE_TIMEOUT_MS);
        if (status === 'granted') {
          await AsyncStorage.setItem(CHOICE_KEY, 'enabled');
          if (userId) registerForPushNotifications(userId).catch(() => {});
        }
        close();
      }""",
    """      } else {
        const { status } = await withTimeout(Notifications.requestPermissionsAsync(), ENABLE_TIMEOUT_MS);
        if (status === 'granted') {
          const ok = userId
            ? await withTimeout(registerForPushNotifications(userId), ENABLE_TIMEOUT_MS)
            : false;
          if (ok) {
            await AsyncStorage.setItem(CHOICE_KEY, 'enabled');
            close();
          } else {
            setErrorMsg('Разрешение получено, но push-токен не зарегистрировался. Проверьте связь и попробуйте ещё раз.');
          }
        } else {
          // Пользователь отказал на уровне ОС. Не выдаём это за включённые
          // уведомления; лист просто закроется и сможет появиться позже.
          close();
        }
      }""",
    'native enable waits for saved token',
)

# Static regression guards live with the other network-truth checks.
test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = """// ── Push: разрешение ОС не выдаётся за рабочую доставку ─────────────────────
$push = (string)file_get_contents(__DIR__ . '/../services/notifications.ts');
$pushSheet = (string)file_get_contents(__DIR__ . '/../components/NotificationPermissionSheet.tsx');
check('push: регистрация возвращает явный результат',
    str_contains($push, 'Promise<boolean>') && str_contains($push, 'return true;') && str_contains($push, 'return false;'));
check('push: экран ждёт регистрацию токена после уже выданного разрешения',
    (bool)preg_match('~status === \'granted\'[\\s\\S]{0,420}withTimeout\\(registerForPushNotifications\\(userId\\)~', $pushSheet));
check('push: enabled сохраняется только после успешной регистрации',
    (bool)preg_match('~if \\(ok\\) \\{[\\s\\S]{0,180}AsyncStorage\\.setItem\\(CHOICE_KEY, \'enabled\'\\)~', $pushSheet));
check('push: ошибка токена объяснена и не закрывает лист как успех',
    str_contains($pushSheet, 'push-токен не зарегистрировался'));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
