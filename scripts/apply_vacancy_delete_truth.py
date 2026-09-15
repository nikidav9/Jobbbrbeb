from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


feed_path = Path('app/(tabs)/feed.tsx')
feed = feed_path.read_text(encoding='utf-8')

# Pending deletion must not look like a completed deletion. Keep a separate
# confirmed-deleted set: the row remains visible while the request is in flight,
# and disappears only after the server confirms the mutation.
replace_once(
    'app/(tabs)/feed.tsx',
    """  const [closingPermIds, setClosingPermIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
""",
    """  const [closingPermIds, setClosingPermIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
""",
    'temporary and confirmed shift vacancy deletion state',
)
replace_once(
    'app/(tabs)/feed.tsx',
    """  const [appsVacancyId, setAppsVacancyId] = useState<string | null>(null);
  const [deletingPermIds, setDeletingPermIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
""",
    """  const [appsVacancyId, setAppsVacancyId] = useState<string | null>(null);
  const [deletingPermIds, setDeletingPermIds] = useState<Set<string>>(new Set());
  const [deletedPermIds, setDeletedPermIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
""",
    'temporary and confirmed permanent vacancy deletion state',
)
replace_once(
    'app/(tabs)/feed.tsx',
    "    if (deletingIds.has(v.id)) return false;",
    "    if (deletedIds.has(v.id)) return false;",
    'shift vacancy hides only after confirmed deletion',
)
replace_once(
    'app/(tabs)/feed.tsx',
    "    if (deletingPermIds.has(v.id)) return false;",
    "    if (deletedPermIds.has(v.id)) return false;",
    'permanent vacancy hides only after confirmed deletion',
)

feed = feed_path.read_text(encoding='utf-8')
old_handlers = """  const deleteVacancy = (id: string) => {
    setConfirmDelete(null);
    setDeletingIds(prev => new Set([...prev, id]));
    showToast('Вакансия удалена', 'success');
    dbDeleteVacancy(id)
      .then(() => refreshVacancies().catch(() => {}))
      .catch(e => console.warn('[deleteVacancy]', e));
  };

  const deletePermVacancy = (id: string) => {
    setConfirmDeletePerm(null);
    setDeletingPermIds(prev => new Set([...prev, id]));
    showToast('Вакансия удалена', 'success');
    dbDeletePermVacancy(id)
      .then(() => refreshPermVacancies().catch(() => {}))
      .catch(e => console.warn('[deletePermVacancy]', e));
  };
"""
new_handlers = """  const deleteVacancy = async (id: string) => {
    if (deletingIds.has(id)) return;
    setConfirmDelete(null);
    setDeletingIds(prev => new Set([...prev, id]));
    try {
      await dbDeleteVacancy(id);
      // Строку прячем только после подтверждения сервера. До этого пользователь
      // видит прежнее состояние, а не ложный успешный результат.
      setDeletedIds(prev => new Set([...prev, id]));
      try {
        await refreshVacancies();
        showToast('Вакансия удалена', 'success');
      } catch {
        showToast('Вакансия удалена, но список не обновился. Потяните вниз.', 'info');
      }
    } catch (e) {
      showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');
      console.warn('[deleteVacancy]', e);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const deletePermVacancy = async (id: string) => {
    if (deletingPermIds.has(id)) return;
    setConfirmDeletePerm(null);
    setDeletingPermIds(prev => new Set([...prev, id]));
    try {
      await dbDeletePermVacancy(id);
      setDeletedPermIds(prev => new Set([...prev, id]));
      try {
        await refreshPermVacancies();
        showToast('Вакансия удалена', 'success');
      } catch {
        showToast('Вакансия удалена, но список не обновился. Потяните вниз.', 'info');
      }
    } catch (e) {
      showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');
      console.warn('[deletePermVacancy]', e);
    } finally {
      setDeletingPermIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };
"""
if feed.count(old_handlers) != 1:
    raise SystemExit(f'delete handlers: expected exactly one match, got {feed.count(old_handlers)}')
feed_path.write_text(feed.replace(old_handlers, new_handlers, 1), encoding='utf-8')

# Strengthen the existing truthfulness regression guard instead of adding a
# one-off test that future CI could forget to run.
test_path = Path('tests/network_action_truth_test.py')
test = test_path.read_text(encoding='utf-8')
old_setup = """plan = (root / 'docs/план-разработки.md').read_text(encoding='utf-8')

checks = {
"""
new_setup = """plan = (root / 'docs/план-разработки.md').read_text(encoding='utf-8')

shift_delete_start = feed.find('  const deleteVacancy = async')
perm_delete_start = feed.find('  const deletePermVacancy = async')
shift_delete = feed[shift_delete_start:perm_delete_start] if shift_delete_start >= 0 and perm_delete_start > shift_delete_start else ''
perm_delete = feed[perm_delete_start:perm_delete_start + 2600] if perm_delete_start >= 0 else ''

checks = {
"""
if test.count(old_setup) != 1:
    raise SystemExit(f'network truth setup: expected 1, got {test.count(old_setup)}')
test = test.replace(old_setup, new_setup, 1)
old_tail = """    'успех удаления идёт после серверной записи': chats.find(\"await dbDeleteChat(chatId);\") < chats.find(\"showToast('Переписка удалена', 'success');\"),
    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,
}
"""
new_tail = """    'успех удаления идёт после серверной записи': chats.find(\"await dbDeleteChat(chatId);\") < chats.find(\"showToast('Переписка удалена', 'success');\"),
    'сменная вакансия видна до подтверждения удаления': 'if (deletedIds.has(v.id)) return false;' in feed and 'if (deletingIds.has(v.id)) return false;' not in feed,
    'постоянная вакансия видна до подтверждения удаления': 'if (deletedPermIds.has(v.id)) return false;' in feed and 'if (deletingPermIds.has(v.id)) return false;' not in feed,
    'сменная вакансия ждёт сервер': \"await dbDeleteVacancy(id);\" in shift_delete and shift_delete.find(\"await dbDeleteVacancy(id);\") < shift_delete.find(\"setDeletedIds(prev\"),
    'постоянная вакансия ждёт сервер': \"await dbDeletePermVacancy(id);\" in perm_delete and perm_delete.find(\"await dbDeletePermVacancy(id);\") < perm_delete.find(\"setDeletedPermIds(prev\"),
    'ошибка удаления сменной вакансии видна': \"showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');\" in shift_delete,
    'ошибка удаления постоянной вакансии видна': \"showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');\" in perm_delete,
    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,
}
"""
if test.count(old_tail) != 1:
    raise SystemExit(f'network truth checks: expected 1, got {test.count(old_tail)}')
test_path.write_text(test.replace(old_tail, new_tail, 1), encoding='utf-8')

# The two new regression guards from the previous batches must be part of normal
# CI, not only of the one-shot patch workflows that created them.
replace_once(
    '.github/workflows/ci.yml',
    """          python3 tests/chat_match_refresh_test.py
          python3 tests/health_endpoint_test.py
""",
    """          python3 tests/chat_match_refresh_test.py
          python3 tests/network_action_truth_test.py
          python3 tests/perm_app_atomicity_test.py
          python3 tests/health_endpoint_test.py
""",
    'wire network truth and permanent approval atomicity into CI',
)

print('vacancy deletion truth patch applied')
