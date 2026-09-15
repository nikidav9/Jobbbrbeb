from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# ── Notification bell: transport failure is not an empty list / successful mutation. ──
replace_once(
    'components/ui/NotifBell.tsx',
    """  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);""",
    """  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);""",
    'notification states',
)

replace_once(
    'components/ui/NotifBell.tsx',
    """  const fetchNotifs = useCallback(async (uid: string) => {
    setLoading(true);
    try {
      const rows = await dbGetNotifications(uid);
      setNotifs(rows.map((n: any) => ({
        id: n.id, title: n.title, body: n.body,
        isRead: n.is_read, createdAt: n.created_at,
        type: n.type ?? null,
        // payload приходит объектом (jsonb) либо строкой — принимаем оба вида
        payload: typeof n.payload === 'string'
          ? (() => { try { return JSON.parse(n.payload); } catch { return null; } })()
          : (n.payload ?? null),
      })));
      app?.refreshNotifications?.();
    } catch {
      // keep current list on error
    } finally {
      setLoading(false);
    }
  }, [app]);""",
    """  const fetchNotifs = useCallback(async (uid: string) => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const rows = await dbGetNotifications(uid);
      setNotifs(rows.map((n: any) => ({
        id: n.id, title: n.title, body: n.body,
        isRead: n.is_read, createdAt: n.created_at,
        type: n.type ?? null,
        // payload приходит объектом (jsonb) либо строкой — принимаем оба вида
        payload: typeof n.payload === 'string'
          ? (() => { try { return JSON.parse(n.payload); } catch { return null; } })()
          : (n.payload ?? null),
      })));
      app?.refreshNotifications?.();
    } catch {
      // Уже загруженный список оставляем на экране, но явно помечаем его как
      // не обновившийся. Пустой локальный массив при обрыве — не «уведомлений нет».
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [app]);""",
    'notification fetch truth',
)

replace_once(
    'components/ui/NotifBell.tsx',
    """  async function handleMarkAll() {
    if (!userId) return;
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
    await dbMarkAllNotifsRead(userId).catch(() => {});
    app?.markAllNotifsRead?.();
  }""",
    """  async function handleMarkAll() {
    if (!userId) return;
    try {
      await dbMarkAllNotifsRead(userId);
      setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
      app?.markAllNotifsRead?.();
    } catch {
      app?.showToast?.('Не удалось отметить уведомления прочитанными', 'error');
    }
  }""",
    'mark all truth',
)

replace_once(
    'components/ui/NotifBell.tsx',
    """  async function handleTap(n: Notif) {
    setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
    dbMarkNotifRead(n.id).catch(() => {});
    app?.markNotifRead?.(n.id);

    // Уведомление — это ссылка: открываем экран, о котором оно говорит""",
    """  async function handleTap(n: Notif) {
    // Навигацию не задерживаем запросом «прочитано», но и не оставляем локальный
    // счётчик в ложном состоянии, если сервер запись не принял.
    if (!n.isRead) {
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      app?.markNotifRead?.(n.id);
      void dbMarkNotifRead(n.id).catch(() => {
        setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: false } : x));
        app?.refreshNotifications?.();
      });
    }

    // Уведомление — это ссылка: открываем экран, о котором оно говорит""",
    'tap read rollback',
)

replace_once(
    'components/ui/NotifBell.tsx',
    """  async function handleDelete(id: string) {
    setNotifs(prev => prev.filter(n => n.id !== id));
    await dbDeleteNotif(id).catch(() => {});
    app?.refreshNotifications?.();
  }

  async function handleDeleteAll() {
    if (!userId) return;
    if (!confirmDeleteAll) { setConfirmDeleteAll(true); return; }
    setConfirmDeleteAll(false);
    setNotifs([]);
    await dbDeleteAllNotifs(userId).catch(() => {});
    app?.refreshNotifications?.();
  }""",
    """  async function handleDelete(id: string) {
    try {
      await dbDeleteNotif(id);
      setNotifs(prev => prev.filter(n => n.id !== id));
      app?.refreshNotifications?.();
    } catch {
      app?.showToast?.('Не удалось удалить уведомление', 'error');
    }
  }

  async function handleDeleteAll() {
    if (!userId) return;
    if (!confirmDeleteAll) { setConfirmDeleteAll(true); return; }
    setConfirmDeleteAll(false);
    try {
      await dbDeleteAllNotifs(userId);
      setNotifs([]);
      app?.refreshNotifications?.();
    } catch {
      app?.showToast?.('Не удалось удалить уведомления', 'error');
    }
  }""",
    'notification deletion truth',
)

replace_once(
    'components/ui/NotifBell.tsx',
    """            <ScrollView contentContainerStyle={s.list}>
              {loading ? (""",
    """            {!loading && loadFailed && notifs.length > 0 ? (
              <View style={{ paddingHorizontal: rs(20), paddingVertical: rs(10), backgroundColor: Colors.surface, gap: rs(4) }}>
                <Text style={{ color: Colors.textPrimary, fontWeight: '700', textAlign: 'center', fontSize: rf(12.5) }}>
                  Не удалось обновить уведомления
                </Text>
                <TouchableOpacity onPress={() => userId && void fetchNotifs(userId)} activeOpacity={0.8}>
                  <Text style={{ color: Colors.primary, fontWeight: '700', textAlign: 'center', fontSize: rf(12.5) }}>Повторить</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <ScrollView contentContainerStyle={s.list}>
              {loading ? (""",
    'stale notification warning',
)

replace_once(
    'components/ui/NotifBell.tsx',
    """              ) : notifs.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name=\"notifications-outline\" size={56} color={Colors.textMuted} style={{ marginBottom: 16 }} />
                  <Text style={s.emptyTitle}>Нет уведомлений</Text>
                  <Text style={s.emptySub}>Здесь будут появляться важные уведомления</Text>
                </View>""",
    """              ) : loadFailed && notifs.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name=\"cloud-offline-outline\" size={52} color={Colors.textMuted} style={{ marginBottom: 16 }} />
                  <Text style={s.emptyTitle}>Не удалось загрузить уведомления</Text>
                  <Text style={s.emptySub}>Проверьте связь и попробуйте ещё раз.</Text>
                  <TouchableOpacity onPress={() => userId && void fetchNotifs(userId)} activeOpacity={0.8} style={{ marginTop: rs(12) }}>
                    <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: rf(14) }}>Повторить</Text>
                  </TouchableOpacity>
                </View>
              ) : notifs.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name=\"notifications-outline\" size={56} color={Colors.textMuted} style={{ marginBottom: 16 }} />
                  <Text style={s.emptyTitle}>Нет уведомлений</Text>
                  <Text style={s.emptySub}>Здесь будут появляться важные уведомления</Text>
                </View>""",
    'empty notifications truth',
)

# ── Telegram reminder banner: same robust deep-link path as the header button. ──
replace_once(
    'components/TelegramLinkBanner.tsx',
    """import { dbGetUserById } from '@/services/db';""",
    """import { dbGetUserById, dbTgPrepareLink } from '@/services/db';""",
    'telegram banner import',
)

replace_once(
    'components/TelegramLinkBanner.tsx',
    """  const [linked, setLinked] = useState<boolean>(!!app?.currentUser?.telegramId);

  useEffect(() => {""",
    """  const [linked, setLinked] = useState<boolean>(!!app?.currentUser?.telegramId);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {""",
    'telegram banner state',
)

replace_once(
    'components/TelegramLinkBanner.tsx',
    """  if (!userId || !isEmployer || linked || isTelegramMiniApp()) return null;

  return (
    <TouchableOpacity
      style={st.banner}
      onPress={() => Linking.openURL(`${BOT_URL}?start=link_${userId}`).catch(() => {})}
      activeOpacity={0.85}
    >""",
    """  if (!userId || !isEmployer || linked || isTelegramMiniApp()) return null;

  const openTelegram = () => {
    setLinkError('');
    // Как и большая кнопка в шапке, заранее регистрируем намерение привязки:
    // если чат с ботом уже существовал, Telegram может прислать голый /start.
    void dbTgPrepareLink(userId).catch(() => {
      setLinkError('Не удалось подготовить привязку. Проверьте связь и попробуйте ещё раз.');
    });
    Linking.openURL(`${BOT_URL}?start=link_${userId}`).catch(() => {
      setLinkError('Не удалось открыть Telegram. Откройте вручную: t.me/JobToo_bot');
    });
  };

  return (
    <TouchableOpacity
      style={st.banner}
      onPress={openTelegram}
      activeOpacity={0.85}
    >""",
    'telegram banner action',
)

replace_once(
    'components/TelegramLinkBanner.tsx',
    """        <Text style={st.title}>Привяжите Telegram</Text>
        <Text style={st.sub}>Отклики на эту вакансию придут вам в Телеграм с кнопками «Одобрить / Отклонить»</Text>""",
    """        <Text style={st.title}>Привяжите Telegram</Text>
        {linkError ? (
          <Text style={st.error}>{linkError}</Text>
        ) : (
          <Text style={st.sub}>Отклики на эту вакансию придут вам в Телеграм с кнопками «Одобрить / Отклонить»</Text>
        )}""",
    'telegram banner error render',
)

replace_once(
    'components/TelegramLinkBanner.tsx',
    """  sub: { fontSize: rf(12), color: Colors.textSecondary, marginTop: rs(2), lineHeight: rf(16) },
  cta:""",
    """  sub: { fontSize: rf(12), color: Colors.textSecondary, marginTop: rs(2), lineHeight: rf(16) },
  error: { fontSize: rf(12), color: Colors.red, marginTop: rs(2), lineHeight: rf(16) },
  cta:""",
    'telegram banner style',
)

# ── Regression guards. ───────────────────────────────────────────────────────
test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = """// ── Уведомления: ошибка сети не выглядит пустотой/успехом ────────────────────
$bell = (string)file_get_contents(__DIR__ . '/../components/ui/NotifBell.tsx');
check('уведомления: ошибка загрузки хранится отдельно', str_contains($bell, 'loadFailed'));
check('уведомления: ошибка загрузки не выглядит пустым списком',
    str_contains($bell, 'Не удалось загрузить уведомления') && str_contains($bell, 'Повторить'));
check('уведомления: прочитать все меняет UI только после сервера',
    (bool)preg_match('~await dbMarkAllNotifsRead\\(userId\\);[\\s\\S]{0,180}setNotifs~', $bell));
check('уведомления: удаление одного меняет UI только после сервера',
    (bool)preg_match('~await dbDeleteNotif\\(id\\);[\\s\\S]{0,180}setNotifs~', $bell));
check('уведомления: удаление всех меняет UI только после сервера',
    (bool)preg_match('~await dbDeleteAllNotifs\\(userId\\);[\\s\\S]{0,180}setNotifs\\(\\[\\]\\)~', $bell));

$tgBanner = (string)file_get_contents(__DIR__ . '/../components/TelegramLinkBanner.tsx');
check('telegram banner: готовит резервную привязку', str_contains($tgBanner, 'void dbTgPrepareLink(userId).catch'));
check('telegram banner: ошибка открытия видна', str_contains($tgBanner, 'Не удалось открыть Telegram. Откройте вручную'));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
