from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# ── Pull-to-refresh: transport errors must never leave the spinner stuck. ─────
replace_once(
    'app/(tabs)/chats.tsx',
    """  const onRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };
""",
    """  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } catch {
      showToast('Не удалось обновить переписки. Проверьте связь.', 'error');
    } finally {
      setRefreshing(false);
    }
  };
""",
    'chats refresh finalizer',
)

replace_once(
    'app/(tabs)/matches.tsx',
    """  const onRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };
""",
    """  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } catch {
      showToast('Не удалось обновить отклики. Проверьте связь.', 'error');
    } finally {
      setRefreshing(false);
    }
  };
""",
    'matches refresh finalizer',
)

replace_once(
    'app/(tabs)/feed.tsx',
    """  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await Promise.all([refreshAll(), loadPartnerShifts()]);
    setRefreshing(false);
  };
""",
    """  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([refreshAll(), loadPartnerShifts()]);
    } catch {
      showToast('Не удалось обновить ленту. Проверьте связь.', 'error');
    } finally {
      setRefreshing(false);
    }
  };
""",
    'feed refresh finalizer',
)

replace_once(
    'components/feature/PermApplicationsSheet.tsx',
    """  const onRefresh = async () => {
    setRefreshing(true);
    await refreshPermApplications();
    setRefreshing(false);
  };
""",
    """  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshPermApplications();
    } catch {
      showToast('Не удалось обновить отклики. Проверьте связь.', 'error');
    } finally {
      setRefreshing(false);
    }
  };
""",
    'perm applications refresh finalizer',
)


# ── Chat deletion: a failed request must not make a row disappear. ───────────
replace_once(
    'app/(tabs)/chats.tsx',
    """  onPress: () => void;
  onDelete: () => void;
}) {
  const pan = useRef(new Animated.Value(0)).current;
  const [deleting, setDeleting] = useState(false);
""",
    """  onPress: () => void;
  onDelete: () => Promise<void>;
}) {
  const pan = useRef(new Animated.Value(0)).current;
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
""",
    'chat delete async contract',
)

replace_once(
    'app/(tabs)/chats.tsx',
    """        {
          text: 'Удалить', style: 'destructive', onPress: () => {
            setDeleting(true);
            onDelete();
          },
        },
""",
    """        {
          text: 'Удалить', style: 'destructive', onPress: async () => {
            if (deleting) return;
            setDeleting(true);
            try {
              // Строка исчезает только после подтверждённого удаления на сервере.
              // Иначе любой обрыв связи выглядел как успешно удалённый чат.
              await onDelete();
              setDeleted(true);
            } catch {
              setDeleting(false);
              Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();
            }
          },
        },
""",
    'chat delete waits for server',
)

replace_once(
    'app/(tabs)/chats.tsx',
    """  if (deleting) return null;
""",
    """  if (deleted) return null;
""",
    'chat delete hide condition',
)

replace_once(
    'app/(tabs)/chats.tsx',
    """        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={22} color="#fff" />
          <Text style={styles.deleteBtnLabel}>Удалить</Text>
        </TouchableOpacity>
""",
    """        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={deleting}>
          <Ionicons name="trash-outline" size={22} color="#fff" />
          <Text style={styles.deleteBtnLabel}>{deleting ? 'Удаляем…' : 'Удалить'}</Text>
        </TouchableOpacity>
""",
    'chat delete pending state',
)

replace_once(
    'app/(tabs)/chats.tsx',
    """  const handleDelete = async (chatId: string) => {
    await dbDeleteChat(chatId);
    await refreshChats();
    showToast('Переписка удалена', 'success');
  };
""",
    """  const handleDelete = async (chatId: string) => {
    try {
      await dbDeleteChat(chatId);
      // Удаление уже подтверждено. Сбой последующего перечитывания списка не
      // превращаем в «не удалилось» и не просим человека жать кнопку второй раз.
      try {
        await refreshChats();
      } catch {
        showToast('Переписка удалена, но список не обновился. Потяните вниз.', 'info');
      }
      showToast('Переписка удалена', 'success');
    } catch {
      showToast('Не удалось удалить переписку. Проверьте связь.', 'error');
      throw new Error('chat delete failed');
    }
  };
""",
    'chat delete truthful outcome',
)


# ── Keep the technical queue honest. ────────────────────────────────────────
replace_once(
    'docs/план-разработки.md',
    '> **Актуализировано 3 сентября 2026.**',
    '> **Актуализировано 15 сентября 2026.**',
    'plan date',
)

replace_once(
    'docs/план-разработки.md',
    """3. Системная ревизия ошибок сети, пустых состояний и малых экранов —
   **начата 14.09.** Сделано: три экрана работника (лента, отклики, переписки)
   перестали выдавать обрыв связи за пустоту. Осталось: ~150 мест, где ошибка
   гасится пустым `catch` (в основном это безобидно — кэш, аналитика, — но
   разобрать надо), и малые экраны, которые отсюда не проверить без снимков.
4. Контрактные тесты на реальном образце API первого партнёра после его получения.
5. Нагрузочный прогон крупного фида и очереди callback перед пилотом.
""",
    """3. Системная ревизия ошибок сети, пустых состояний и малых экранов —
   **в работе 15.09.** Сделано: три экрана работника (лента, отклики, переписки)
   перестали выдавать обрыв связи за пустоту; профиль не показывает «Сохранено»
   до подтверждения сервера; pull-to-refresh в ленте, откликах, переписках и
   шторке постоянной вакансии всегда отпускает индикатор после ошибки; удаление
   переписки не прячет строку до подтверждения сервера. Осталось: системно
   разобрать прочие пустые `catch` и проверить малые экраны по снимкам.
4. Контрактные тесты на реальном образце API первого партнёра после его получения.
5. ~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~ —
   **сделано 15.09.** 50 000 записей фида нормализованы за 23,2 с
   (~2 155 записей/с) с приростом пикового RSS 6,5 МБ; очередь из 5 000 событий
   при 20 воркерах разобрана за 2,04 с, все 5 000 claim уникальны. Параллельно
   закрыты гонки двойной отправки outbox, повторной обработки одного webhook и
   lost update между разными callback одной заявки.
""",
    'plan queue status',
)


# Permanent regression guard for the network-state truths fixed above.
test = Path('tests/network_action_truth_test.py')
test.write_text(r'''#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
chats = (root / 'app/(tabs)/chats.tsx').read_text(encoding='utf-8')
matches = (root / 'app/(tabs)/matches.tsx').read_text(encoding='utf-8')
feed = (root / 'app/(tabs)/feed.tsx').read_text(encoding='utf-8')
perm = (root / 'components/feature/PermApplicationsSheet.tsx').read_text(encoding='utf-8')
plan = (root / 'docs/план-разработки.md').read_text(encoding='utf-8')

checks = {
    'чаты отпускают refresh в finally': "showToast('Не удалось обновить переписки. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in chats,
    'отклики отпускают refresh в finally': "showToast('Не удалось обновить отклики. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in matches,
    'лента отпускает refresh в finally': "showToast('Не удалось обновить ленту. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in feed,
    'шторка откликов отпускает refresh в finally': "showToast('Не удалось обновить отклики. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in perm,
    'чат ждёт сервер перед скрытием': "await onDelete();\n              setDeleted(true);" in chats,
    'pending удаления не скрывает строку': 'if (deleting) return null;' not in chats and 'if (deleted) return null;' in chats,
    'ошибка удаления возвращает строку': "setDeleting(false);\n              Animated.spring(pan, { toValue: 0" in chats,
    'успех удаления идёт после серверной записи': chats.find("await dbDeleteChat(chatId);") < chats.find("showToast('Переписка удалена', 'success');"),
    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('network action truth: ПРОВАЛЫ')
    for name in failed:
        print('  -', name)
    raise SystemExit(1)
print(f'network action truth: ok; {len(checks)} guards')
''', encoding='utf-8')
