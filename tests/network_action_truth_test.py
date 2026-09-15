#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
chats = (root / 'app/(tabs)/chats.tsx').read_text(encoding='utf-8')
matches = (root / 'app/(tabs)/matches.tsx').read_text(encoding='utf-8')
feed = (root / 'app/(tabs)/feed.tsx').read_text(encoding='utf-8')
perm = (root / 'components/feature/PermApplicationsSheet.tsx').read_text(encoding='utf-8')
plan = (root / 'docs/план-разработки.md').read_text(encoding='utf-8')

shift_delete_start = feed.find('  const deleteVacancy = async')
perm_delete_start = feed.find('  const deletePermVacancy = async')
shift_delete = feed[shift_delete_start:perm_delete_start] if shift_delete_start >= 0 and perm_delete_start > shift_delete_start else ''
perm_delete = feed[perm_delete_start:perm_delete_start + 2600] if perm_delete_start >= 0 else ''

checks = {
    'чаты отпускают refresh в finally': "showToast('Не удалось обновить переписки. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in chats,
    'отклики отпускают refresh в finally': "showToast('Не удалось обновить отклики. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in matches,
    'лента отпускает refresh в finally': "showToast('Не удалось обновить ленту. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in feed,
    'шторка откликов отпускает refresh в finally': "showToast('Не удалось обновить отклики. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in perm,
    'чат ждёт сервер перед скрытием': "await onDelete();\n              setDeleted(true);" in chats,
    'pending удаления не скрывает строку': 'if (deleting) return null;' not in chats and 'if (deleted) return null;' in chats,
    'ошибка удаления возвращает строку': "setDeleting(false);\n              Animated.spring(pan, { toValue: 0" in chats,
    'успех удаления идёт после серверной записи': chats.find("await dbDeleteChat(chatId);") < chats.find("showToast('Переписка удалена', 'success');"),
    'сменная вакансия видна до подтверждения удаления': 'if (deletedIds.has(v.id)) return false;' in feed and 'if (deletingIds.has(v.id)) return false;' not in feed,
    'постоянная вакансия видна до подтверждения удаления': 'if (deletedPermIds.has(v.id)) return false;' in feed and 'if (deletingPermIds.has(v.id)) return false;' not in feed,
    'сменная вакансия ждёт сервер': "await dbDeleteVacancy(id);" in shift_delete and shift_delete.find("await dbDeleteVacancy(id);") < shift_delete.find("setDeletedIds(prev"),
    'постоянная вакансия ждёт сервер': "await dbDeletePermVacancy(id);" in perm_delete and perm_delete.find("await dbDeletePermVacancy(id);") < perm_delete.find("setDeletedPermIds(prev"),
    'ошибка удаления сменной вакансии видна': "showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');" in shift_delete,
    'ошибка удаления постоянной вакансии видна': "showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');" in perm_delete,
    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('network action truth: ПРОВАЛЫ')
    for name in failed:
        print('  -', name)
    raise SystemExit(1)
print(f'network action truth: ok; {len(checks)} guards')
