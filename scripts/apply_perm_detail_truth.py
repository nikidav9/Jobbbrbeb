from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


path = 'app/perm-vacancy-detail.tsx'

replace_once(
    path,
    """  const [applyOpen, setApplyOpen] = useState(false);
  const [authModalDismissed, setAuthModalDismissed] = useState(Platform.OS === 'web');
  const [guestVacancy, setGuestVacancy] = useState<any>(null);""",
    """  const [applyOpen, setApplyOpen] = useState(false);
  const [authModalDismissed, setAuthModalDismissed] = useState(Platform.OS === 'web');
  const [guestVacancy, setGuestVacancy] = useState<any>(null);
  const [guestVacancyChecked, setGuestVacancyChecked] = useState(false);
  const [guestVacancyLoadFailed, setGuestVacancyLoadFailed] = useState(false);
  const [guestVacancyRetry, setGuestVacancyRetry] = useState(0);
  const [savingFavorite, setSavingFavorite] = useState(false);""",
    'detail truth states',
)

replace_once(
    path,
    """  useEffect(() => {
    if (!vacancyId || vacancy || currentUser || loading) return;
    dbGetPermVacancies().then(list => {
      const found = list.find((v: any) => v.id === vacancyId);
      if (found) setGuestVacancy(found);
    }).catch(() => {});
  }, [vacancyId, vacancy, currentUser, loading]);
  const employer = vacancy ? users.find(u => u.id === vacancy.employerId) : null;""",
    """  useEffect(() => {
    if (!vacancyId || vacancy || currentUser || loading) return;
    let alive = true;
    setGuestVacancyChecked(false);
    setGuestVacancyLoadFailed(false);
    dbGetPermVacancies().then(list => {
      if (!alive) return;
      const found = list.find((v: any) => v.id === vacancyId);
      if (found) setGuestVacancy(found);
    }).catch(() => {
      if (alive) setGuestVacancyLoadFailed(true);
    }).finally(() => {
      if (alive) setGuestVacancyChecked(true);
    });
    return () => { alive = false; };
  }, [vacancyId, vacancy, currentUser, loading, guestVacancyRetry]);
  const employer = vacancy ? users.find(u => u.id === vacancy.employerId) : null;""",
    'guest vacancy fetch truth',
)

replace_once(
    path,
    """  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>""",
    """  const guestLookupPending = !currentUser && !loading && !!vacancyId && !vacancy && !guestVacancyChecked;

  if (loading || guestLookupPending) {
    return (
      <SafeAreaView style={styles.safe}>""",
    'guest vacancy loading render',
)

replace_once(
    path,
    """        <View style={styles.emptyCenter}>
          <Ionicons name=\"search-outline\" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>Вакансия не найдена</Text>
        </View>
        {authModalJSX}""",
    """        <View style={styles.emptyCenter}>
          {guestVacancyLoadFailed ? (
            <>
              <Ionicons name=\"cloud-offline-outline\" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Не удалось загрузить вакансию</Text>
              <Text style={{ color: Colors.textMuted, textAlign: 'center', marginTop: rs(6) }}>
                Проверьте связь и попробуйте ещё раз.
              </Text>
              <TouchableOpacity
                onPress={() => setGuestVacancyRetry(x => x + 1)}
                activeOpacity={0.8}
                style={{ marginTop: rs(14), backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(22), paddingVertical: rs(11) }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Повторить</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Ionicons name=\"search-outline\" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Вакансия не найдена</Text>
            </>
          )}
        </View>
        {authModalJSX}""",
    'guest vacancy error render',
)

replace_once(
    path,
    """  const toggleSave = async () => {
    if (!currentUser) return;
    if (isSaved) {
      optimisticRemovePermSaved(vacancy.id);
      dbRemovePermSaved(currentUser.id, vacancy.id).catch(() => {});
      showToast('Удалено из избранного', 'success');
    } else {
      optimisticAddPermSaved(vacancy.id);
      dbAddPermSaved(currentUser.id, vacancy.id).catch(() => {});
      showToast('Сохранено ❤️', 'success');
    }
  };""",
    """  const toggleSave = async () => {
    if (!currentUser || savingFavorite) return;
    setSavingFavorite(true);
    try {
      if (isSaved) {
        await dbRemovePermSaved(currentUser.id, vacancy.id);
        optimisticRemovePermSaved(vacancy.id);
        showToast('Удалено из избранного', 'success');
      } else {
        await dbAddPermSaved(currentUser.id, vacancy.id);
        optimisticAddPermSaved(vacancy.id);
        showToast('Сохранено ❤️', 'success');
      }
    } catch {
      showToast(isSaved ? 'Не удалось удалить из избранного' : 'Не удалось сохранить вакансию', 'error');
    } finally {
      setSavingFavorite(false);
    }
  };""",
    'favorite truth',
)

replace_once(
    path,
    """            onPress={toggleSave}
            style={styles.saveHeaderBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={24} color={isSaved ? Colors.red : Colors.textMuted} />""",
    """            onPress={toggleSave}
            style={[styles.saveHeaderBtn, savingFavorite && { opacity: 0.5 }]}
            disabled={savingFavorite}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={24} color={isSaved ? Colors.red : Colors.textMuted} />""",
    'favorite busy state',
)

# Regression guards.
test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = """// ── Постоянная вакансия: сетевой сбой не выглядит удалением/успехом ─────────
$permDetail = (string)file_get_contents(__DIR__ . '/../app/perm-vacancy-detail.tsx');
check('постоянная вакансия: гостевая загрузка имеет отдельную ошибку',
    str_contains($permDetail, 'guestVacancyLoadFailed'));
check('постоянная вакансия: ошибка гостевой загрузки не выглядит 404',
    str_contains($permDetail, 'Не удалось загрузить вакансию') && str_contains($permDetail, 'Повторить'));
check('постоянная вакансия: настоящий not-found сохранён',
    str_contains($permDetail, 'Вакансия не найдена'));
check('избранное постоянной вакансии: UI меняется только после сервера',
    (bool)preg_match('~await dbAddPermSaved\\(currentUser\\.id, vacancy\\.id\\);[\\s\\S]{0,160}optimisticAddPermSaved~', $permDetail) &&
    (bool)preg_match('~await dbRemovePermSaved\\(currentUser\\.id, vacancy\\.id\\);[\\s\\S]{0,160}optimisticRemovePermSaved~', $permDetail));
check('избранное постоянной вакансии: ошибка видна',
    str_contains($permDetail, 'Не удалось сохранить вакансию') && str_contains($permDetail, 'Не удалось удалить из избранного'));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
