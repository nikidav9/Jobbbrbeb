from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


path = 'app/(tabs)/matches.tsx'

replace_once(
    path,
    """import React, { useState, useEffect, useRef, useMemo } from 'react';""",
    """import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';""",
    'useCallback import',
)

replace_once(
    path,
    """  const [refreshing, setRefreshing] = useState(false);
  const [detailVacancy, setDetailVacancy] = useState<Vacancy | null>(null);
  const [partnerApplications, setPartnerApplications] = useState<PartnerApplication[]>([]);
  const [tab, setTab] = useState<'active' | 'rejected' | 'completed'>('active');
  const tabBarHeight = useBottomTabBarHeight();

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refreshAll(),
      currentUser ? dbGetPartnerApplications(currentUser.id).then(setPartnerApplications) : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  const currentUserId = currentUser?.id ?? '';
  useEffect(() => {
    if (!currentUserId) return;
    dbGetPartnerApplications(currentUserId).then(setPartnerApplications).catch(() => {});
  }, [currentUserId]);""",
    """  const [refreshing, setRefreshing] = useState(false);
  const [detailVacancy, setDetailVacancy] = useState<Vacancy | null>(null);
  const [partnerApplications, setPartnerApplications] = useState<PartnerApplication[]>([]);
  const [partnerApplicationsLoadFailed, setPartnerApplicationsLoadFailed] = useState(false);
  const [tab, setTab] = useState<'active' | 'rejected' | 'completed'>('active');
  const tabBarHeight = useBottomTabBarHeight();

  const currentUserId = currentUser?.id ?? '';
  const loadPartnerApplications = useCallback(async (uid: string): Promise<boolean> => {
    setPartnerApplicationsLoadFailed(false);
    try {
      const rows = await dbGetPartnerApplications(uid);
      setPartnerApplications(rows);
      return true;
    } catch {
      // Не стираем уже показанные отклики: при обрыве они остаются полезным
      // кэшем, но экран честно говорит, что партнёрская часть не обновилась.
      setPartnerApplicationsLoadFailed(true);
      return false;
    }
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        refreshAll(),
        currentUser ? loadPartnerApplications(currentUser.id) : Promise.resolve(true),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!currentUserId) return;
    void loadPartnerApplications(currentUserId);
  }, [currentUserId, loadPartnerApplications]);""",
    'partner applications loading contract',
)

replace_once(
    path,
    """  const offlineHere = offline.likes && myLikes.length === 0;""",
    """  const offlineHere =
    (offline.likes && myLikes.length === 0) ||
    (partnerApplicationsLoadFailed && partnerApplications.length === 0 && myLikes.length === 0);""",
    'partner applications offline truth',
)

replace_once(
    path,
    """      <View style={s.tabStrip}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={s.tabItem} onPress={() => setTab(t.key)} activeOpacity={0.8}>
            <Text
              style={[s.tabLabel, tab === t.key && s.tabLabelActive]}
              numberOfLines=\"1\"
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {t.label}{t.count > 0 ? ` (${t.count})` : ''}
            </Text>
            {tab === t.key ? <View style={s.tabUnderline} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      {shownItems.length === 0 ? (""",
    """      <View style={s.tabStrip}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={s.tabItem} onPress={() => setTab(t.key)} activeOpacity={0.8}>
            <Text
              style={[s.tabLabel, tab === t.key && s.tabLabelActive]}
              numberOfLines=\"1\"
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {t.label}{t.count > 0 ? ` (${t.count})` : ''}
            </Text>
            {tab === t.key ? <View style={s.tabUnderline} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      {partnerApplicationsLoadFailed ? (
        <View style={{ marginHorizontal: rs(16), marginTop: rs(10), padding: rs(12), borderRadius: Radius.md, backgroundColor: Colors.surface }}>
          <Text style={{ color: Colors.textPrimary, fontWeight: '700', textAlign: 'center' }}>
            Не удалось обновить отклики партнёров
          </Text>
          <Text style={{ color: Colors.textMuted, fontSize: rf(12), textAlign: 'center', marginTop: rs(4) }}>
            Уже загруженные отклики сохранены. Проверьте связь и повторите.
          </Text>
          <TouchableOpacity
            onPress={() => currentUserId && void loadPartnerApplications(currentUserId)}
            activeOpacity={0.8}
            style={{ marginTop: rs(8), alignSelf: 'center' }}
          >
            <Text style={{ color: Colors.primary, fontWeight: '700' }}>Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {shownItems.length === 0 ? (""",
    'partner applications warning render',
)

# Regression guards.
test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = """// ── Партнёрские отклики: ошибка не выглядит пустым/полным списком ────────────
$matchesTruth = (string)file_get_contents(__DIR__ . '/../app/(tabs)/matches.tsx');
check('партнёрские отклики: ошибка хранится отдельно',
    str_contains($matchesTruth, 'partnerApplicationsLoadFailed'));
check('партнёрские отклики: ошибка видна и есть повтор',
    str_contains($matchesTruth, 'Не удалось обновить отклики партнёров') &&
    str_contains($matchesTruth, 'loadPartnerApplications(currentUserId)'));
check('партнёрские отклики: refresh всегда снимает спиннер',
    str_contains($matchesTruth, 'Promise.allSettled') &&
    (bool)preg_match('~finally \\{[\\s\\S]{0,100}setRefreshing\\(false\\)~', $matchesTruth));
check('партнёрские отклики: старый молчаливый fetch удалён',
    !str_contains($matchesTruth, 'dbGetPartnerApplications(currentUserId).then(setPartnerApplications).catch(() => {})'));
check('партнёрские отклики: общая пустота учитывает их сбой',
    str_contains($matchesTruth, 'partnerApplicationsLoadFailed && partnerApplications.length === 0 && myLikes.length === 0'));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
