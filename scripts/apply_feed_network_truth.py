from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


path = 'app/(tabs)/feed.tsx'

# ── Regular partner work: failed load is not a genuine empty feed. ────────────
replace_once(
    path,
    """  const [items, setItems] = useState<ExternalVacancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const rows = await dbGetExternalVacancies();
      setItems(rows.filter(isRegularExternalVacancy));
    } catch {
      showToast('Не удалось обновить регулярные подработки', 'error');
    } finally {""",
    """  const [items, setItems] = useState<ExternalVacancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setLoadFailed(false);
    try {
      const rows = await dbGetExternalVacancies();
      setItems(rows.filter(isRegularExternalVacancy));
    } catch {
      setLoadFailed(true);
      showToast('Не удалось обновить регулярные подработки', 'error');
    } finally {""",
    'regular feed error state',
)

replace_once(
    path,
    """  if (items.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={[rl.wrap, { flexGrow: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.primary} colors={[Colors.primary]} />}
      >
        <View style={rl.ring}>
          <Ionicons name=\"repeat-outline\" size={30} color={Colors.primary} />
        </View>
        <Text style={rl.title}>Регулярных подработок пока нет</Text>
        <Text style={rl.desc}>Потяните вниз, чтобы обновить предложения партнёров.</Text>
      </ScrollView>
    );
  }""",
    """  if (items.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={[rl.wrap, { flexGrow: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.primary} colors={[Colors.primary]} />}
      >
        <View style={rl.ring}>
          <Ionicons name={loadFailed ? 'cloud-offline-outline' : 'repeat-outline'} size={30} color={Colors.primary} />
        </View>
        {loadFailed ? (
          <>
            <Text style={rl.title}>Не удалось загрузить регулярные подработки</Text>
            <Text style={rl.desc}>Проверьте связь и попробуйте ещё раз.</Text>
            <TouchableOpacity onPress={() => void load()} activeOpacity={0.8} style={{ marginTop: rs(12) }}>
              <Text style={{ color: Colors.primary, fontWeight: '700' }}>Повторить</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={rl.title}>Регулярных подработок пока нет</Text>
            <Text style={rl.desc}>Потяните вниз, чтобы обновить предложения партнёров.</Text>
          </>
        )}
      </ScrollView>
    );
  }""",
    'regular feed error render',
)

# ── Employer applicant lists: failed fetch must not become “no applicants”. ──
replace_once(
    path,
    """  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const listSwipe = useSwipeToDismiss(onClose);
  const [localLikes, setLocalLikes] = useState<Like[]>([]);
  const [localWorkers, setLocalWorkers] = useState<User[]>([]);""",
    """  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataLoadFailed, setDataLoadFailed] = useState(false);
  const [dataRetry, setDataRetry] = useState(0);
  const listSwipe = useSwipeToDismiss(onClose);
  const [localLikes, setLocalLikes] = useState<Like[]>([]);
  const [localWorkers, setLocalWorkers] = useState<User[]>([]);""",
    'worker list load state',
)

replace_once(
    path,
    """    const init = async () => {
      setDataLoading(true);
      try {
        const vacLikes = await dbGetLikesByVacancy(vacancyId);""",
    """    const init = async () => {
      setDataLoading(true);
      setDataLoadFailed(false);
      try {
        const vacLikes = await dbGetLikesByVacancy(vacancyId);""",
    'worker list reset failure',
)

replace_once(
    path,
    """      } catch (e) {
        console.warn('[WorkerListModal] init error', e);
      } finally {
        setDataLoading(false);
      }
    };
    init();
  }, [vacancyId]);""",
    """      } catch (e) {
        console.warn('[WorkerListModal] init error', e);
        setDataLoadFailed(true);
      } finally {
        setDataLoading(false);
      }
    };
    init();
  }, [vacancyId, dataRetry]);""",
    'worker list capture failure',
)

replace_once(
    path,
    """          {dataLoading ? (
            <View style={wS.empty}>
              <ActivityIndicator size=\"large\" color={Colors.primary} />
              <Text style={[wS.emptyTxt, { marginTop: 12 }]}>Загрузка данных...</Text>
            </View>
          ) : filteredLikes.length === 0 ? (""",
    """          {dataLoading ? (
            <View style={wS.empty}>
              <ActivityIndicator size=\"large\" color={Colors.primary} />
              <Text style={[wS.emptyTxt, { marginTop: 12 }]}>Загрузка данных...</Text>
            </View>
          ) : dataLoadFailed ? (
            <View style={wS.empty}>
              <EmptyIcon name=\"cloud-offline-outline\" />
              <Text style={wS.emptyTxt}>Не удалось загрузить список</Text>
              <TouchableOpacity onPress={() => setDataRetry(x => x + 1)} activeOpacity={0.8} style={{ marginTop: rs(12) }}>
                <Text style={{ color: Colors.primary, fontWeight: '700' }}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : filteredLikes.length === 0 ? (""",
    'worker list error render',
)

# ── Saved shift: only mutate UI after server confirmation. ────────────────────
replace_once(
    path,
    """  const pendingLikeIds = useRef<Set<string>>(new Set());
  const swipingRef = useRef(false);
  const messagingRef = useRef(false);""",
    """  const pendingLikeIds = useRef<Set<string>>(new Set());
  const savedMutationIds = useRef<Set<string>>(new Set());
  const swipingRef = useRef(false);
  const messagingRef = useRef(false);""",
    'shift saved mutation guard',
)

replace_once(
    path,
    """  const toggleSavedShift = useCallback(() => {
    if (!currentCard || 'external' in currentCard) return;
    const user = currentUser;
    if (!user) return;
    if (user.isGuest) { promptRegister({ vacancyKind: 'shift' }); return; }
    const id = currentCard.id;
    if (savedIds.includes(id)) {
      optimisticRemoveSaved(id);
      dbRemoveSaved(user.id, id).catch(() => {});
    } else {
      optimisticAddSaved(id);
      dbAddSaved(user.id, id).catch(() => {});
      showToast('Добавлено в избранное', 'success');
    }
  }, [currentCard, currentUser, savedIds, optimisticAddSaved, optimisticRemoveSaved, promptRegister, showToast]);""",
    """  const toggleSavedShift = useCallback(async () => {
    if (!currentCard || 'external' in currentCard) return;
    const user = currentUser;
    if (!user) return;
    if (user.isGuest) { promptRegister({ vacancyKind: 'shift' }); return; }
    const id = currentCard.id;
    if (savedMutationIds.current.has(id)) return;
    savedMutationIds.current.add(id);
    try {
      if (savedIds.includes(id)) {
        await dbRemoveSaved(user.id, id);
        optimisticRemoveSaved(id);
        showToast('Удалено из избранного', 'success');
      } else {
        await dbAddSaved(user.id, id);
        optimisticAddSaved(id);
        showToast('Добавлено в избранное', 'success');
      }
    } catch {
      showToast(savedIds.includes(id) ? 'Не удалось удалить из избранного' : 'Не удалось добавить в избранное', 'error');
    } finally {
      savedMutationIds.current.delete(id);
    }
  }, [currentCard, currentUser, savedIds, optimisticAddSaved, optimisticRemoveSaved, promptRegister, showToast]);""",
    'shift saved truth',
)

# ── Saved permanent vacancy in the feed: same rule. ───────────────────────────
replace_once(
    path,
    """  const [superJobConnectFor, setSuperJobConnectFor] = useState<ExternalVacancy | null>(null);
  const [superJobConnecting, setSuperJobConnecting] = useState(false);
  const [superJobConnectError, setSuperJobConnectError] = useState<string | null>(null);

  const externalLoadId = useRef(0);""",
    """  const [superJobConnectFor, setSuperJobConnectFor] = useState<ExternalVacancy | null>(null);
  const [superJobConnecting, setSuperJobConnecting] = useState(false);
  const [superJobConnectError, setSuperJobConnectError] = useState<string | null>(null);
  const permSavedMutationIds = useRef<Set<string>>(new Set());

  const externalLoadId = useRef(0);""",
    'permanent saved mutation guard',
)

replace_once(
    path,
    """  const toggleSaved = (v: PermVacancy) => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      promptRegister({ vacancyId: v.id, vacancyKind: 'permanent' });
      return;
    }
    if (permSavedIds.includes(v.id)) {
      optimisticRemovePermSaved(v.id);
      dbRemovePermSaved(currentUser.id, v.id).catch(() => {});
      showToast('Удалено из избранного', 'success');
    } else {
      optimisticAddPermSaved(v.id);
      dbAddPermSaved(currentUser.id, v.id).catch(() => {});
      showToast('Сохранено в избранное', 'success');
    }
  };""",
    """  const toggleSaved = async (v: PermVacancy) => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      promptRegister({ vacancyId: v.id, vacancyKind: 'permanent' });
      return;
    }
    if (permSavedMutationIds.current.has(v.id)) return;
    permSavedMutationIds.current.add(v.id);
    try {
      if (permSavedIds.includes(v.id)) {
        await dbRemovePermSaved(currentUser.id, v.id);
        optimisticRemovePermSaved(v.id);
        showToast('Удалено из избранного', 'success');
      } else {
        await dbAddPermSaved(currentUser.id, v.id);
        optimisticAddPermSaved(v.id);
        showToast('Сохранено в избранное', 'success');
      }
    } catch {
      showToast(permSavedIds.includes(v.id) ? 'Не удалось удалить из избранного' : 'Не удалось сохранить в избранное', 'error');
    } finally {
      permSavedMutationIds.current.delete(v.id);
    }
  };""",
    'permanent saved truth',
)

# Regression guards.
test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = """// ── Лента: ошибки загрузки/избранного не выдаются за пустоту/успех ───────────
$feedTruth = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
check('регулярные подработки: ошибка не выглядит пустой выдачей',
    str_contains($feedTruth, 'Не удалось загрузить регулярные подработки') &&
    str_contains($feedTruth, 'loadFailed'));
check('список откликов работодателя: ошибка не выглядит пустым списком',
    str_contains($feedTruth, 'dataLoadFailed') && str_contains($feedTruth, 'Не удалось загрузить список'));
check('избранное смены: добавление подтверждается сервером до UI',
    (bool)preg_match('~await dbAddSaved\\(user\\.id, id\\);[\\s\\S]{0,140}optimisticAddSaved~', $feedTruth));
check('избранное смены: удаление подтверждается сервером до UI',
    (bool)preg_match('~await dbRemoveSaved\\(user\\.id, id\\);[\\s\\S]{0,140}optimisticRemoveSaved~', $feedTruth));
check('избранное работы: добавление подтверждается сервером до UI',
    (bool)preg_match('~await dbAddPermSaved\\(currentUser\\.id, v\\.id\\);[\\s\\S]{0,160}optimisticAddPermSaved~', $feedTruth));
check('избранное работы: удаление подтверждается сервером до UI',
    (bool)preg_match('~await dbRemovePermSaved\\(currentUser\\.id, v\\.id\\);[\\s\\S]{0,160}optimisticRemovePermSaved~', $feedTruth));
check('избранное ленты: сетевые ошибки видны',
    str_contains($feedTruth, 'Не удалось добавить в избранное') &&
    str_contains($feedTruth, 'Не удалось сохранить в избранное'));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
