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
    'app/chat-room.tsx',
    "  const [likeStatus, setLikeStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);\n  const listRef = useRef<FlatList<Message>>(null);",
    "  const [likeStatus, setLikeStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);\n  const [likeStatusLoadFailed, setLikeStatusLoadFailed] = useState(false);\n  const [likeStatusRetry, setLikeStatusRetry] = useState(0);\n  const listRef = useRef<FlatList<Message>>(null);",
)

replace_once(
    'app/chat-room.tsx',
    "    if (chat.bulletinId || chat.workerSlotId) { setLikeStatus(null); return; }",
    "    if (chat.bulletinId || chat.workerSlotId) {\n      setLikeStatus(null);\n      setLikeStatusLoadFailed(false);\n      return;\n    }",
)

replace_once(
    'app/chat-room.tsx',
    "    // Постоянная вакансия — статус берём из отклика, а не из лайков\n    if (permVacancy) {",
    "    // Постоянная вакансия — статус берём из отклика, а не из лайков\n    if (permVacancy) {\n      setLikeStatusLoadFailed(false);",
)

replace_once(
    'app/chat-room.tsx',
    "    dbGetLikeByVacancyWorker(chat.vacancyId, chat.workerId).then(like => {\n      if (!like) { setLikeStatus('pending'); return; }\n      if (like.isMatch || like.employerLiked === true) setLikeStatus('approved');\n      else if (like.employerLiked === false) setLikeStatus('rejected');\n      else setLikeStatus('pending');\n    }).catch(() => {});\n  }, [chat?.id, currentUser?.id, permVacancy?.id, permApp?.status]);",
    "    // Новый чат не должен на мгновение наследовать решение из предыдущего.\n    // И старый сетевой ответ не должен перезаписать уже открытый другой чат.\n    setLikeStatus(null);\n    setLikeStatusLoadFailed(false);\n    let cancelled = false;\n    dbGetLikeByVacancyWorker(chat.vacancyId, chat.workerId).then(like => {\n      if (cancelled) return;\n      if (!like) { setLikeStatus('pending'); return; }\n      if (like.isMatch || like.employerLiked === true) setLikeStatus('approved');\n      else if (like.employerLiked === false) setLikeStatus('rejected');\n      else setLikeStatus('pending');\n    }).catch(() => {\n      if (!cancelled) setLikeStatusLoadFailed(true);\n    });\n    return () => { cancelled = true; };\n  }, [chat?.id, currentUser?.id, permVacancy?.id, permApp?.status, likeStatusRetry]);",
)

replace_once(
    'app/chat-room.tsx',
    "      {/* Employer decision bar — shown at the top */}\n      {isEmployer && !isChatWithoutVacancy && likeStatus === 'pending' ? (",
    "      {/* Employer decision bar — shown at the top */}\n      {isEmployer && !isChatWithoutVacancy && likeStatusLoadFailed ? (\n        <View style={styles.decisionBar}>\n          <View style={styles.decisionStatusRow}>\n            <Ionicons name=\"cloud-offline-outline\" size={16} color={Colors.red} />\n            <Text style={[styles.decisionBarLabel, { color: Colors.red }]}>\n              Не удалось загрузить статус отклика\n            </Text>\n          </View>\n          <TouchableOpacity onPress={() => setLikeStatusRetry(x => x + 1)} activeOpacity={0.8}>\n            <Text style={{ color: Colors.primary, fontWeight: '700' }}>Повторить</Text>\n          </TouchableOpacity>\n        </View>\n      ) : isEmployer && !isChatWithoutVacancy && likeStatus === 'pending' ? (",
)

replace_once(
    'tests/network_action_truth_test.py',
    "feed = (root / 'app/(tabs)/feed.tsx').read_text(encoding='utf-8')\nrate = (root / 'app/rate.tsx').read_text(encoding='utf-8')",
    "feed = (root / 'app/(tabs)/feed.tsx').read_text(encoding='utf-8')\nchat_room = (root / 'app/chat-room.tsx').read_text(encoding='utf-8')\nrate = (root / 'app/rate.tsx').read_text(encoding='utf-8')",
)

replace_once(
    'tests/network_action_truth_test.py',
    "    'ошибка сохранения остаётся для неуспешной записи': \"showToast('Ошибка при сохранении', 'error');\" in rate_submit,\n    'план фиксирует нагрузочный прогон':",
    "    'ошибка сохранения остаётся для неуспешной записи': \"showToast('Ошибка при сохранении', 'error');\" in rate_submit,\n    'статус отклика не наследуется от прошлого чата': \"setLikeStatus(null);\\n    setLikeStatusLoadFailed(false);\\n    let cancelled = false;\" in chat_room,\n    'устаревший ответ статуса отклика игнорируется': \"if (cancelled) return;\" in chat_room and \"return () => { cancelled = true; };\" in chat_room,\n    'сбой загрузки статуса отклика виден': \"setLikeStatusLoadFailed(true);\" in chat_room and 'Не удалось загрузить статус отклика' in chat_room,\n    'статус отклика можно загрузить повторно': \"setLikeStatusRetry(x => x + 1)\" in chat_room and 'likeStatusRetry]);' in chat_room,\n    'план фиксирует нагрузочный прогон':",
)

print('chat like status truth patch applied')
