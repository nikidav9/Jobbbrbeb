from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


feed = 'app/(tabs)/feed.tsx'

old_shift = '''  const closeVacancy = (id: string) => {
    if (closingIds.has(id)) return;
    setConfirmClose(null);
    setClosingIds(prev => new Set([...prev, id]));
    showToast('Вакансия закрыта', 'success');
    dbUpdateVacancy(id, { status: 'closed' })
      .then(() => refreshVacancies().catch(() => {}))
      .catch(e => console.warn('[closeVacancy]', e));
  };
'''
new_shift = '''  const closeVacancy = async (id: string) => {
    if (closingIds.has(id)) return;
    setConfirmClose(null);
    setClosingIds(prev => new Set([...prev, id]));
    try {
      await dbUpdateVacancy(id, { status: 'closed' });
      // Успех показываем только после подтверждения сервера. closingIds
      // оставляем до refresh: если сам refresh сорвётся, уже закрытая на
      // сервере вакансия не должна на мгновение вернуться в «Активные».
      showToast('Вакансия закрыта', 'success');
      refreshVacancies().catch(() => {});
    } catch (e) {
      setClosingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showToast('Не удалось закрыть вакансию. Проверьте связь.', 'error');
      console.warn('[closeVacancy]', e);
    }
  };
'''
replace_once(feed, old_shift, new_shift, 'shift close')

old_perm = '''  const closePermVacancy = (id: string) => {
    if (closingPermIds.has(id)) return;
    setClosingPermIds(prev => new Set([...prev, id]));
    showToast('Вакансия закрыта', 'success');
    dbClosePermVacancy(id)
      .then(() => refreshPermVacancies().catch(() => {}))
      .catch(e => console.warn('[closePermVacancy]', e));
  };
'''
new_perm = '''  const closePermVacancy = async (id: string) => {
    if (closingPermIds.has(id)) return;
    setClosingPermIds(prev => new Set([...prev, id]));
    try {
      await dbClosePermVacancy(id);
      showToast('Вакансия закрыта', 'success');
      refreshPermVacancies().catch(() => {});
    } catch (e) {
      setClosingPermIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showToast('Не удалось закрыть вакансию. Проверьте связь.', 'error');
      console.warn('[closePermVacancy]', e);
    }
  };
'''
replace_once(feed, old_perm, new_perm, 'permanent close')

test_path = Path('tests/network_action_truth_test.py')
test = test_path.read_text(encoding='utf-8')
vars_anchor = '''perm_delete = feed[perm_delete_start:perm_delete_start + 2600] if perm_delete_start >= 0 else ''
'''
vars_insert = '''perm_delete = feed[perm_delete_start:perm_delete_start + 2600] if perm_delete_start >= 0 else ''
shift_close_start = feed.find('  const closeVacancy = async')
perm_close_start = feed.find('  const closePermVacancy = async')
shift_close = feed[shift_close_start:perm_close_start] if shift_close_start >= 0 and perm_close_start > shift_close_start else ''
perm_close = feed[perm_close_start:shift_delete_start] if perm_close_start >= 0 and shift_delete_start > perm_close_start else ''
'''
if test.count(vars_anchor) != 1:
    raise SystemExit('network test vars anchor not found exactly once')
test = test.replace(vars_anchor, vars_insert, 1)

checks_anchor = '''    'ошибка удаления постоянной вакансии видна': "showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');" in perm_delete,
    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,
'''
checks_insert = '''    'ошибка удаления постоянной вакансии видна': "showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');" in perm_delete,
    'закрытие сменной вакансии ждёт сервер перед успехом': "await dbUpdateVacancy(id, { status: 'closed' });" in shift_close and shift_close.find("await dbUpdateVacancy(id, { status: 'closed' });") < shift_close.find("showToast('Вакансия закрыта', 'success');"),
    'закрытие постоянной вакансии ждёт сервер перед успехом': "await dbClosePermVacancy(id);" in perm_close and perm_close.find('await dbClosePermVacancy(id);') < perm_close.find("showToast('Вакансия закрыта', 'success');"),
    'ошибка закрытия сменной вакансии видна и откатывает UI': "showToast('Не удалось закрыть вакансию. Проверьте связь.', 'error');" in shift_close and 'next.delete(id);' in shift_close,
    'ошибка закрытия постоянной вакансии видна и откатывает UI': "showToast('Не удалось закрыть вакансию. Проверьте связь.', 'error');" in perm_close and 'next.delete(id);' in perm_close,
    'закрытие вакансий больше не fire-and-forget': ".then(() => refreshVacancies()" not in shift_close and ".then(() => refreshPermVacancies()" not in perm_close,
    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,
'''
if test.count(checks_anchor) != 1:
    raise SystemExit('network test checks anchor not found exactly once')
test = test.replace(checks_anchor, checks_insert, 1)
test_path.write_text(test, encoding='utf-8')

print('vacancy close truth patch applied')
