from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


for path, label in [
    ('app/register-worker.tsx', 'worker registration'),
    ('app/register-employer.tsx', 'employer registration'),
]:
    replace_once(
        path,
        """    } catch {
      setStep(2);
    } finally {
      setChecking(false);
    }""",
        """    } catch {
      // Проверка уникальности — часть самой регистрации. При обрыве связи
      // нельзя делать вид, что номер свободен: иначе создадим дубликат.
      setPhoneError('Не удалось проверить номер. Проверьте связь и попробуйте ещё раз.');
    } finally {
      setChecking(false);
    }""",
        label,
    )

support = Path('app/support.tsx')
s = support.read_text()

def support_once(old: str, new: str, label: str) -> None:
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    s = s.replace(old, new, 1)

support_once(
    """  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');""",
    """  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState('');""",
    'support failed state',
)
support_once(
    """  const load = useCallback(async () => {
    if (!currentUser) return;
    try { setMsgs(await dbSupportHistory(currentUser.id)); }
    catch {} finally { setLoading(false); }
  }, [currentUser?.id]);""",
    """  const load = useCallback(async () => {
    if (!currentUser) return;
    try {
      setMsgs(await dbSupportHistory(currentUser.id));
      setLoadFailed(false);
    } catch {
      // Не подменяем сетевую ошибку фразой «Напишите нам»: пустой ответ и
      // непринесённая история — разные состояния.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);""",
    'support load',
)
support_once(
    """            {loading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: rs(24) }} />
            ) : msgs.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>Напишите нам</Text>""",
    """            {loading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: rs(24) }} />
            ) : loadFailed && msgs.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>Не удалось загрузить переписку</Text>
                <Text style={s.emptySub}>Проверьте связь и попробуйте ещё раз.</Text>
                <TouchableOpacity style={s.retryBtn} onPress={() => void load()} activeOpacity={0.85}>
                  <Text style={s.retryTxt}>Повторить</Text>
                </TouchableOpacity>
              </View>
            ) : msgs.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>Напишите нам</Text>""",
    'support error rendering',
)
support_once(
    """  emptySub: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', marginTop: rs(8), lineHeight: rf(20) },

  bubble:""",
    """  emptySub: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', marginTop: rs(8), lineHeight: rf(20) },
  retryBtn: { marginTop: rs(16), backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(22), paddingVertical: rs(11) },
  retryTxt: { color: '#fff', fontSize: rf(14), fontWeight: '700' },

  bubble:""",
    'support retry styles',
)
support.write_text(s)

test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = """// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
addition = """// ── Регистрация и поддержка: сетевой сбой не выдаётся за успех/пустоту ───────
foreach (['app/register-worker.tsx' => 'работник', 'app/register-employer.tsx' => 'работодатель'] as $file => $role) {
    $src = (string)file_get_contents(__DIR__ . '/../' . $file);
    check("регистрация {$role}: сбой проверки номера не пропускает дальше",
        !preg_match('~catch\\s*\\{[\\s\\S]{0,180}setStep\\(2\\)~', $src));
    check("регистрация {$role}: сбой проверки номера объяснён",
        str_contains($src, 'Не удалось проверить номер. Проверьте связь и попробуйте ещё раз.'));
}
$support = (string)file_get_contents(__DIR__ . '/../app/support.tsx');
check('поддержка: ошибка истории хранится отдельно', str_contains($support, 'loadFailed'));
check('поддержка: ошибка истории не выглядит пустым чатом', str_contains($support, 'Не удалось загрузить переписку'));
check('поддержка: историю можно повторить',
    (bool)preg_match('~onPress=\\{\\(\\) => void load\\(\\)\\}[\\s\\S]{0,160}Повторить~', $support));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
