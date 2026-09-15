#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one anchor, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'app/user-profile.tsx',
    "  const [stats, setStats] = useState<UserStats | null>(null);",
    "  const [stats, setStats] = useState<UserStats | null>(null);\n  const [statsLoadFailed, setStatsLoadFailed] = useState(false);\n  const [statsRetry, setStatsRetry] = useState(0);",
)

replace_once(
    'app/user-profile.tsx',
    "  // Отзывчивость считает сервер: сообщения всех чатов на клиент не грузятся.\n  useEffect(() => {\n    if (!userId) return;\n    dbUserStats(userId).then(setStats).catch(() => {});\n  }, [userId]);",
    "  // Отзывчивость считает сервер: сообщения всех чатов на клиент не грузятся.\n  // При смене профиля не показываем статистику предыдущего человека, а сетевой\n  // сбой не выдаём за отсутствие данных — пользователь может повторить запрос.\n  useEffect(() => {\n    if (!userId) return;\n    setStats(null);\n    setStatsLoadFailed(false);\n    let cancelled = false;\n    dbUserStats(userId)\n      .then(next => { if (!cancelled) setStats(next); })\n      .catch(() => { if (!cancelled) setStatsLoadFailed(true); });\n    return () => { cancelled = true; };\n  }, [userId, statsRetry]);",
)

replace_once(
    'app/user-profile.tsx',
    "              const rate = enough ? replyRateLabel(enough.answered, enough.chats) : null;\n              if (!seen && !speed && !rate) return null;",
    "              const rate = enough ? replyRateLabel(enough.answered, enough.chats) : null;\n              if (!seen && !speed && !rate && !statsLoadFailed) return null;",
)

replace_once(
    'app/user-profile.tsx',
    "                  {speed ? (\n                    <InfoRow label=\"Скорость\" value={<Text style={styles.valText}>{speed}</Text>} />\n                  ) : null}\n                </View>",
    "                  {speed ? (\n                    <InfoRow label=\"Скорость\" value={<Text style={styles.valText}>{speed}</Text>} />\n                  ) : null}\n                  {statsLoadFailed ? (\n                    <View style={{ marginTop: rs(10), gap: rs(6) }}>\n                      <Text style={{ color: Colors.red, fontSize: rf(13), fontWeight: '600' }}>\n                        Не удалось загрузить отзывчивость\n                      </Text>\n                      <TouchableOpacity onPress={() => setStatsRetry(x => x + 1)} activeOpacity={0.8}>\n                        <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: rf(13) }}>Повторить</Text>\n                      </TouchableOpacity>\n                    </View>\n                  ) : null}\n                </View>",
)

replace_once(
    'tests/offline_states_test.php',
    "check('чужой профиль: отзывы имеют отдельную ошибку',\n    str_contains($userProfile, 'ratingsLoadFailed') && str_contains($userProfile, 'Не удалось загрузить отзывы'));",
    "check('чужой профиль: отзывы имеют отдельную ошибку',\n    str_contains($userProfile, 'ratingsLoadFailed') && str_contains($userProfile, 'Не удалось загрузить отзывы'));\ncheck('чужой профиль: ошибка отзывчивости не выглядит отсутствием данных',\n    str_contains($userProfile, 'statsLoadFailed') && str_contains($userProfile, 'Не удалось загрузить отзывчивость'));\ncheck('чужой профиль: отзывчивость можно загрузить повторно',\n    str_contains($userProfile, 'setStatsRetry(x => x + 1)'));\ncheck('чужой профиль: старый ответ статистики не попадает в новый профиль',\n    str_contains($userProfile, 'let cancelled = false;')\n    && str_contains($userProfile, 'if (!cancelled) setStats(next);')\n    && str_contains($userProfile, 'return () => { cancelled = true; };'));",
)

print('profile stats truth patch applied')
