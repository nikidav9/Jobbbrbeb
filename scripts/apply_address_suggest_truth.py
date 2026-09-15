from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# Service must not turn a transport failure into a legitimate empty result.
replace_once(
    'services/db.ts',
    """export async function dbAddressSuggest(query: string): Promise<AddressSuggestion[]> {
  if (query.trim().length < 3) return [];
  try {
    return await withTimeout(proxy<AddressSuggestion[]>('addressSuggest', [query]), 9000);
  } catch {
    return [];
  }
}""",
    """export async function dbAddressSuggest(query: string): Promise<AddressSuggestion[]> {
  if (query.trim().length < 3) return [];
  // Ошибку сети не превращаем в []: вызывающему коду важно отличать
  // «ничего не найдено» от «подсказки сейчас не загрузились».
  return withTimeout(proxy<AddressSuggestion[]>('addressSuggest', [query]), 9000);
}""",
    'address suggest service truth',
)

replace_once(
    'components/feature/AddressSuggestField.tsx',
    """  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [picked, setPicked] = useState<AddressSuggestion | null>(null);""",
    """  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [retrySeq, setRetrySeq] = useState(0);
  const [picked, setPicked] = useState<AddressSuggestion | null>(null);""",
    'address suggest state',
)

replace_once(
    'components/feature/AddressSuggestField.tsx',
    """    setResults([]);
    setTouched(false);
    setPicked(null);
    setOpen(true);""",
    """    setResults([]);
    setTouched(false);
    setSearchFailed(false);
    setPicked(null);
    setOpen(true);""",
    'address modal reset',
)

replace_once(
    'components/feature/AddressSuggestField.tsx',
    """  const onType = (t: string) => {
    setQuery(t);
    if (picked && picked.name !== t) setPicked(null); // текст изменили — координаты сбрасываем
  };""",
    """  const onType = (t: string) => {
    setQuery(t);
    setSearchFailed(false);
    if (picked && picked.name !== t) setPicked(null); // текст изменили — координаты сбрасываем
  };""",
    'address typing reset',
)

replace_once(
    'components/feature/AddressSuggestField.tsx',
    """    if (q.length < 3 || (picked && picked.name === q)) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const my = ++reqId.current;
    timer.current = setTimeout(async () => {
      const r = await dbAddressSuggest(q);
      if (my !== reqId.current) return;
      setResults(r);
      setLoading(false);
      setTouched(true);
    }, 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, open, picked]);""",
    """    if (q.length < 3 || (picked && picked.name === q)) {
      setResults([]);
      setLoading(false);
      setSearchFailed(false);
      return;
    }
    setLoading(true);
    setSearchFailed(false);
    const my = ++reqId.current;
    timer.current = setTimeout(async () => {
      try {
        const r = await dbAddressSuggest(q);
        if (my !== reqId.current) return;
        setResults(r);
        setTouched(true);
      } catch {
        if (my !== reqId.current) return;
        setResults([]);
        setTouched(false);
        setSearchFailed(true);
      } finally {
        if (my === reqId.current) setLoading(false);
      }
    }, 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, open, picked, retrySeq]);""",
    'address request truth',
)

replace_once(
    'components/feature/AddressSuggestField.tsx',
    """              ListEmptyComponent={
                loading || (picked && picked.name === trimmed) ? null : (
                  <Text style={s.hint}>
                    {trimmed.length < 3
                      ? 'Введите улицу и дом — подскажем адрес'
                      : touched
                        ? 'Ничего не нашлось. Можно подтвердить адрес как есть.'
                        : 'Введите улицу и дом — подскажем адрес'}
                  </Text>
                )
              }""",
    """              ListEmptyComponent={
                loading || (picked && picked.name === trimmed) ? null : searchFailed ? (
                  <View style={s.searchError}>
                    <Text style={s.hint}>Не удалось загрузить подсказки. Проверьте связь или подтвердите адрес как есть.</Text>
                    <TouchableOpacity onPress={() => setRetrySeq(x => x + 1)} activeOpacity={0.8}>
                      <Text style={s.retry}>Повторить</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={s.hint}>
                    {trimmed.length < 3
                      ? 'Введите улицу и дом — подскажем адрес'
                      : touched
                        ? 'Ничего не нашлось. Можно подтвердить адрес как есть.'
                        : 'Введите улицу и дом — подскажем адрес'}
                  </Text>
                )
              }""",
    'address error render',
)

replace_once(
    'components/feature/AddressSuggestField.tsx',
    """  hint: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', paddingVertical: rs(24), paddingHorizontal: rs(8) },
  footer:""",
    """  hint: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', paddingVertical: rs(24), paddingHorizontal: rs(8) },
  searchError: { alignItems: 'center', paddingHorizontal: rs(8) },
  retry: { color: Colors.primary, fontSize: rf(14), fontWeight: '700', paddingVertical: rs(8), paddingHorizontal: rs(18) },
  footer:""",
    'address error styles',
)

# Regression guards.
test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = """// ── Адрес: таймаут подсказок не выглядит как ноль результатов ───────────────
$dbSrc = (string)file_get_contents(__DIR__ . '/../services/db.ts');
$addr = (string)file_get_contents(__DIR__ . '/../components/feature/AddressSuggestField.tsx');
check('адрес: сервис не превращает ошибку в пустой массив',
    !preg_match("~dbAddressSuggest[\\s\\S]{0,320}catch \\{[\\s\\S]{0,80}return \\[\\]~", $dbSrc));
check('адрес: ошибка подсказок хранится отдельно', str_contains($addr, 'searchFailed'));
check('адрес: ошибка подсказок не выглядит как ничего не найдено',
    str_contains($addr, 'Не удалось загрузить подсказки') && str_contains($addr, 'Повторить'));
check('адрес: настоящий пустой поиск всё ещё объяснён',
    str_contains($addr, 'Ничего не нашлось. Можно подтвердить адрес как есть.'));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
