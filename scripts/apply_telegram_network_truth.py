from pathlib import Path

P = Path('components/TelegramConnectButton.tsx')
T = Path('tests/offline_states_test.php')
s = P.read_text()


def once(old: str, new: str, label: str) -> None:
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    s = s.replace(old, new, 1)


once(
"""  const [busy, setBusy] = useState(false);
  // Телеграм может не открыться — не установлен, запрещены переходы.
  // Молчать нельзя: человек жмёт кнопку и не понимает, живая она вообще или нет.
  const [failed, setFailed] = useState(false);""",
"""  const [busy, setBusy] = useState(false);
  // Телеграм может не открыться — не установлен, запрещены переходы.
  // Молчать нельзя: человек жмёт кнопку и не понимает, живая она вообще или нет.
  const [failed, setFailed] = useState(false);
  const [statusFailed, setStatusFailed] = useState(false);
  const [actionError, setActionError] = useState('');""",
'state')

once(
"""  const refreshStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const u = await dbGetUserById(userId);
      setLinked(!!u?.telegramId);
    } catch {}
  }, [userId]);""",
"""  const refreshStatus = useCallback(async () => {
    if (!userId) return;
    setStatusFailed(false);
    try {
      const u = await dbGetUserById(userId);
      setLinked(!!u?.telegramId);
    } catch {
      // При первом открытии linked=null. Без отдельной ошибки модалка могла
      // крутить спиннер бесконечно и выдавать обрыв сети за «ещё грузимся».
      setStatusFailed(true);
    }
  }, [userId]);""",
'refresh status')

once(
"""  const connect = () => {
    setFailed(false);
    // Заявку серверу шлём параллельно, а НЕ перед переходом. Она нужна на
    // случай, когда чат с ботом уже был: Telegram тогда не доносит метку из
    // ссылки и присылает голый «/start», и бот привязывает по заявке.
    // Но ждать её ответа нельзя:
    //  • в браузере открыть Телеграм разрешено только внутри самого нажатия —
    //    после await это уже «всплывающее окно», и его молча блокируют;
    //  • если сеть подвисла, запрос висел без ограничения по времени, и
    //    кнопка просто ничего не делала — ни перехода, ни слова о причине.
    // Пока человек переключается в Телеграм, заявка успевает дойти.
    dbTgPrepareLink(userId);
    Linking.openURL(`${BOT_URL}?start=link_${userId}`).catch(() => setFailed(true));
  };""",
"""  const connect = () => {
    setFailed(false);
    setActionError('');
    // Заявку серверу шлём параллельно, а НЕ перед переходом. Она нужна на
    // случай, когда чат с ботом уже был: Telegram тогда не доносит метку из
    // ссылки и присылает голый «/start», и бот привязывает по заявке.
    // Но ждать её ответа нельзя:
    //  • в браузере открыть Телеграм разрешено только внутри самого нажатия —
    //    после await это уже «всплывающее окно», и его молча блокируют;
    //  • если сеть подвисла, запрос висел без ограничения по времени, и
    //    кнопка просто ничего не делала — ни перехода, ни слова о причине.
    // Пока человек переключается в Телеграм, заявка успевает дойти. Promise
    // всё равно завершаем catch: fire-and-forget не должен стать unhandled rejection.
    void dbTgPrepareLink(userId).catch(() => {
      setActionError('Не удалось подготовить привязку. Вернитесь в JobToo и попробуйте ещё раз.');
    });
    Linking.openURL(`${BOT_URL}?start=link_${userId}`).catch(() => setFailed(true));
  };""",
'connect')

once(
"""  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await dbUnbindTelegram(userId);
      setLinked(false);
    } catch {} finally {
      setBusy(false);
    }
  };""",
"""  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try {
      await dbUnbindTelegram(userId);
      setLinked(false);
    } catch {
      setActionError('Не удалось отключить Telegram. Проверьте связь и попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const openBot = () => {
    setActionError('');
    Linking.openURL(BOT_URL).catch(() => {
      setActionError('Не удалось открыть Telegram. Откройте бота вручную: t.me/JobToo_bot');
    });
  };""",
'disconnect/open')

once(
"""            {linked === null ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <ActivityIndicator color={TG_BLUE} />
              </View>
            ) : linked ? (""",
"""            {linked === null && statusFailed ? (
              <View style={st.statusErrorBox}>
                <Text style={st.statusErrorTitle}>Не удалось проверить Telegram</Text>
                <Text style={st.statusErrorText}>Проверьте связь и попробуйте ещё раз.</Text>
                <TouchableOpacity onPress={() => void refreshStatus()} activeOpacity={0.8}>
                  <Text style={st.retryText}>Повторить</Text>
                </TouchableOpacity>
              </View>
            ) : linked === null ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <ActivityIndicator color={TG_BLUE} />
              </View>
            ) : linked ? (""",
'status render')

once(
"""                <TouchableOpacity style={st.secondaryBtn} onPress={() => Linking.openURL(BOT_URL).catch(() => {})} activeOpacity={0.8}>
                  <Text style={st.secondaryText}>Открыть бота</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.dangerBtn} onPress={disconnect} disabled={busy} activeOpacity={0.7}>
                  <Text style={st.dangerText}>{busy ? 'Отключаем…' : 'Отключить уведомления'}</Text>
                </TouchableOpacity>""",
"""                <TouchableOpacity style={st.secondaryBtn} onPress={openBot} activeOpacity={0.8}>
                  <Text style={st.secondaryText}>Открыть бота</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.dangerBtn} onPress={disconnect} disabled={busy} activeOpacity={0.7}>
                  <Text style={st.dangerText}>{busy ? 'Отключаем…' : 'Отключить уведомления'}</Text>
                </TouchableOpacity>
                {actionError ? <Text style={st.actionError}>{actionError}</Text> : null}""",
'linked actions')

once(
"""                {failed ? (
                  <Text style={st.failHint}>
                    Телеграм не открылся. Проверьте, что он установлен, и откройте бота
                    вручную: t.me/JobToo_bot — там нажмите «Start».
                  </Text>
                ) : (
                  <Text style={st.hint}>
                    Откроется Телеграм — нажмите «Start». Вернитесь сюда, статус обновится сам.
                  </Text>
                )}""",
"""                {failed ? (
                  <Text style={st.failHint}>
                    Телеграм не открылся. Проверьте, что он установлен, и откройте бота
                    вручную: t.me/JobToo_bot — там нажмите «Start».
                  </Text>
                ) : actionError ? (
                  <Text style={st.failHint}>{actionError}</Text>
                ) : (
                  <Text style={st.hint}>
                    Откроется Телеграм — нажмите «Start». Вернитесь сюда, статус обновится сам.
                  </Text>
                )}""",
'unlinked action error')

once(
"""  failHint: { fontSize: rf(12.5), lineHeight: rf(17), color: Colors.red, textAlign: 'center', marginTop: rs(10) },
  connectedBox:""",
"""  failHint: { fontSize: rf(12.5), lineHeight: rf(17), color: Colors.red, textAlign: 'center', marginTop: rs(10) },
  actionError: { fontSize: rf(12.5), lineHeight: rf(17), color: Colors.red, textAlign: 'center', marginTop: rs(8) },
  statusErrorBox: { alignItems: 'center', gap: rs(8), paddingVertical: rs(24), paddingHorizontal: rs(12) },
  statusErrorTitle: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  statusErrorText: { fontSize: rf(13), color: Colors.textMuted, textAlign: 'center' },
  retryText: { fontSize: rf(14), fontWeight: '700', color: TG_BLUE, marginTop: rs(2) },
  connectedBox:""",
'styles')

P.write_text(s)

t = T.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = """// ── Telegram: пользовательские сетевые действия не молчат ───────────────────
$tg = (string)file_get_contents(__DIR__ . '/../components/TelegramConnectButton.tsx');
check('telegram: ошибка первого статуса не оставляет вечный спиннер',
    str_contains($tg, 'statusFailed') && str_contains($tg, 'Не удалось проверить Telegram'));
check('telegram: отключение сообщает об ошибке',
    str_contains($tg, 'Не удалось отключить Telegram. Проверьте связь и попробуйте ещё раз.'));
check('telegram: открытие бота сообщает об ошибке',
    str_contains($tg, 'Не удалось открыть Telegram. Откройте бота вручную'));
check('telegram: fire-and-forget заявка не даёт unhandled rejection',
    str_contains($tg, 'void dbTgPrepareLink(userId).catch'));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
T.write_text(t.replace(anchor, addition, 1))
