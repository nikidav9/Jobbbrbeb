from pathlib import Path
import re


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) Проверка телефона не имеет права превращать сетевую ошибку в «номер свободен».
db_path = Path('services/db.ts')
db = db_path.read_text(encoding='utf-8')
pattern = re.compile(
    r"export async function dbCheckPhoneExists\(phone: string\): Promise<boolean> \{[\s\S]*?\n\}\n\nexport async function dbGetUserByPhone"
)
match = pattern.search(db)
if not match:
    raise SystemExit('dbCheckPhoneExists block not found')
new_block = """export async function dbCheckPhoneExists(phone: string): Promise<boolean> {
  // Ошибка запроса — это НЕ ответ «номер свободен». Экран регистрации сам
  // показывает понятный текст и оставляет человека на первом шаге для повтора.
  // Если проглотить ошибку здесь, внешний catch никогда не сработает и при
  // обрыве связи мы разрешим создать второй аккаунт с тем же номером.
  return proxy<boolean>('dbCheckPhoneExists', [phone]);
}

export async function dbGetUserByPhone"""
db = db[:match.start()] + new_block + db[match.end():]
db_path.write_text(db, encoding='utf-8')


# 2) Проверку юридического согласия делаем fail-closed, но не тупиком:
# отдельное состояние ошибки с Повторить/Выйти. До ответа базы приложение не
# должно считать отсутствие ответа подтверждением актуального согласия.
consent_path = Path('components/ConsentGate.tsx')
consent = consent_path.read_text(encoding='utf-8')

replace_once(
    'components/ConsentGate.tsx',
    """  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
""",
    """  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkFailed, setCheckFailed] = useState(false);
  const [checkRetry, setCheckRetry] = useState(0);
""",
    'consent check state',
)
replace_once(
    'components/ConsentGate.tsx',
    """    if (!user || user.isGuest) { setChecked(false); setNeeded(false); return; }
    let alive = true;
    setChecked(false);
""",
    """    if (!user || user.isGuest) {
      setChecked(false);
      setNeeded(false);
      setCheckFailed(false);
      return;
    }
    let alive = true;
    setChecked(false);
    setCheckFailed(false);
""",
    'consent check reset',
)
replace_once(
    'components/ConsentGate.tsx',
    """        setNeeded(needsReconsent(c?.stamp));
        setChecked(true);
      })
      .catch(() => {
        // Не достучались до базы — молчим и пропускаем. Показать окно из-за
        // сорвавшегося запроса значит запереть человека на ровном месте:
        // он нажмёт «Принять», согласие снова не запишется, и так по кругу.
        if (alive) { setNeeded(false); setChecked(true); }
      });
    return () => { alive = false; };
  }, [user?.id]);
""",
    """        setNeeded(needsReconsent(c?.stamp));
        setCheckFailed(false);
        setChecked(true);
      })
      .catch(() => {
        // Невозможность проверить согласие — не доказательство, что оно есть.
        // Не пропускаем человека дальше молча: показываем понятную ошибку и
        // даём повторить проверку или выйти из аккаунта.
        if (alive) { setCheckFailed(true); setChecked(true); }
      });
    return () => { alive = false; };
  }, [user?.id, checkRetry]);
""",
    'consent fail-closed check',
)
replace_once(
    'components/ConsentGate.tsx',
    """  if (!user || !checked || !needed) return null;

  const дата = formatLegalDate(LEGAL_DOCS.terms.version);
""",
    """  if (!user || !checked) return null;

  if (checkFailed) {
    return (
      <View style={[styles.overlay, { paddingTop: insets.top + rs(24) }]}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="cloud-offline-outline" size={rf(26)} color={Colors.primary} />
          </View>
          <Text style={styles.title}>Не удалось проверить документы</Text>
          <Text style={styles.lead}>
            Сервер не ответил, поэтому JobToo не может подтвердить, что у аккаунта есть актуальное согласие. Проверьте связь и повторите проверку.
          </Text>
          <TouchableOpacity
            style={styles.accept}
            activeOpacity={0.85}
            onPress={() => setCheckRetry(v => v + 1)}
          >
            <Text style={styles.acceptText}>Повторить</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.leave} activeOpacity={0.7} onPress={() => app?.logout()}>
            <Text style={styles.leaveText}>Выйти</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!needed) return null;

  const дата = formatLegalDate(LEGAL_DOCS.terms.version);
""",
    'consent failure UI',
)

# 3) Усиливаем существующий regression-набор: именно сервис не должен глотать
# ошибку телефона, а ConsentGate — пропускать аккаунт при сорванной проверке.
test_path = Path('tests/offline_states_test.php')
test = test_path.read_text(encoding='utf-8')
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────\n"
if test.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected one, got {test.count(anchor)}')
insert = r'''// ── Fail-closed там, где отсутствие ответа меняет право продолжать ────────────
$dbService = (string)file_get_contents(__DIR__ . '/../services/db.ts');
$phoneStart = strpos($dbService, 'export async function dbCheckPhoneExists');
$phoneEnd = strpos($dbService, 'export async function dbGetUserByPhone', $phoneStart === false ? 0 : $phoneStart);
$phoneBody = ($phoneStart !== false && $phoneEnd !== false)
    ? substr($dbService, $phoneStart, $phoneEnd - $phoneStart)
    : '';
check('регистрация: сервис не превращает ошибку телефона в false',
    $phoneBody !== '' &&
    str_contains($phoneBody, "return proxy<boolean>('dbCheckPhoneExists', [phone]);") &&
    !str_contains($phoneBody, 'catch { return false; }'));

$consentGate = (string)file_get_contents(__DIR__ . '/../components/ConsentGate.tsx');
check('согласие: ошибка первичной проверки хранится отдельно',
    str_contains($consentGate, 'checkFailed') && str_contains($consentGate, 'setCheckFailed(true)'));
check('согласие: ошибка проверки не пропускает в приложение',
    !str_contains($consentGate, 'setNeeded(false); setChecked(true);') &&
    str_contains($consentGate, 'Не удалось проверить документы'));
check('согласие: после ошибки есть повтор и выход',
    str_contains($consentGate, 'setCheckRetry(v => v + 1)') &&
    str_contains($consentGate, '<Text style={styles.acceptText}>Повторить</Text>') &&
    str_contains($consentGate, 'onPress={() => app?.logout()}'));

'''
test_path.write_text(test.replace(anchor, insert + anchor, 1), encoding='utf-8')

print('fail-closed network patch applied')
