#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
chats = (root / 'app/(tabs)/chats.tsx').read_text(encoding='utf-8')
matches = (root / 'app/(tabs)/matches.tsx').read_text(encoding='utf-8')
feed = (root / 'app/(tabs)/feed.tsx').read_text(encoding='utf-8')
chat_room = (root / 'app/chat-room.tsx').read_text(encoding='utf-8')
rate = (root / 'app/rate.tsx').read_text(encoding='utf-8')
perm_detail = (root / 'app/perm-vacancy-detail.tsx').read_text(encoding='utf-8')
perm = (root / 'components/feature/PermApplicationsSheet.tsx').read_text(encoding='utf-8')
plan = (root / 'docs/план-разработки.md').read_text(encoding='utf-8')

shift_delete_start = feed.find('  const deleteVacancy = async')
perm_delete_start = feed.find('  const deletePermVacancy = async')
shift_delete = feed[shift_delete_start:perm_delete_start] if shift_delete_start >= 0 and perm_delete_start > shift_delete_start else ''
perm_delete = feed[perm_delete_start:perm_delete_start + 2600] if perm_delete_start >= 0 else ''
shift_close_start = feed.find('  const closeVacancy = async')
perm_close_start = feed.find('  const closePermVacancy = async')
shift_close = feed[shift_close_start:perm_close_start] if shift_close_start >= 0 and perm_close_start > shift_close_start else ''
perm_close = feed[perm_close_start:shift_delete_start] if perm_close_start >= 0 and shift_delete_start > perm_close_start else ''
rate_submit_start = rate.find('  const submit = async')
rate_submit_end = rate.find('  const skip =', rate_submit_start)
rate_submit = rate[rate_submit_start:rate_submit_end] if rate_submit_start >= 0 and rate_submit_end > rate_submit_start else ''
perm_apply_start = perm_detail.find('  const sendApply = async')
perm_apply_end = perm_detail.find('  const toggleSave = async', perm_apply_start)
perm_apply = perm_detail[perm_apply_start:perm_apply_end] if perm_apply_start >= 0 and perm_apply_end > perm_apply_start else ''

rating_write = 'const { bothRated } = await dbSubmitRatingAndMaybeDelete({'
rating_refresh = "try {\n        await refreshAll();\n      } catch {\n        // Следующий обычный refresh подтянет уже сохранённое состояние.\n      }"
rating_success = "showToast('Оценка сохранена! Спасибо 🌟', 'success');"

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
    'закрытие сменной вакансии ждёт сервер перед успехом': "await dbUpdateVacancy(id, { status: 'closed' });" in shift_close and shift_close.find("await dbUpdateVacancy(id, { status: 'closed' });") < shift_close.find("showToast('Вакансия закрыта', 'success');"),
    'закрытие постоянной вакансии ждёт сервер перед успехом': "await dbClosePermVacancy(id);" in perm_close and perm_close.find('await dbClosePermVacancy(id);') < perm_close.find("showToast('Вакансия закрыта', 'success');"),
    'ошибка закрытия сменной вакансии видна и откатывает UI': "showToast('Не удалось закрыть вакансию. Проверьте связь.', 'error');" in shift_close and 'next.delete(id);' in shift_close,
    'ошибка закрытия постоянной вакансии видна и откатывает UI': "showToast('Не удалось закрыть вакансию. Проверьте связь.', 'error');" in perm_close and 'next.delete(id);' in perm_close,
    'закрытие вакансий больше не fire-and-forget': ".then(() => refreshVacancies()" not in shift_close and ".then(() => refreshPermVacancies()" not in perm_close,
    'оценка ждёт подтверждение серверной записи': rating_write in rate_submit,
    'refresh оценки изолирован после успешной записи': rating_refresh in rate_submit and rate_submit.find(rating_write) < rate_submit.find(rating_refresh),
    'сбой refresh оценки не отменяет успешный результат': rating_refresh in rate_submit and rate_submit.find(rating_refresh) < rate_submit.find(rating_success),
    'ошибка сохранения остаётся для неуспешной записи': "showToast('Ошибка при сохранении', 'error');" in rate_submit,
    'постоянный отклик ждёт серверную запись': "await dbApplyPermVacancy(vacancy.id, currentUser.id, vacancy.employerId, message);" in perm_apply,
    'успешный постоянный отклик фиксируется локально до refresh': "setApplySubmitted(true);" in perm_apply and perm_apply.find('await dbApplyPermVacancy') < perm_apply.find('setApplySubmitted(true);'),
    'refresh постоянного отклика изолирован после записи': "try {\n        await refreshPermApplications();\n      } catch {" in perm_apply and perm_apply.find('setApplySubmitted(true);') < perm_apply.find('await refreshPermApplications();'),
    'сбой refresh не отменяет успех постоянного отклика': "showToast('Отклик отправлен! 📨', 'success');" in perm_apply and perm_apply.find('await refreshPermApplications();') < perm_apply.find("showToast('Отклик отправлен! 📨', 'success');"),
    'после подтверждённой записи нельзя отправить постоянный отклик повторно': "const isApplied = !!myApp || applySubmitted;" in perm_detail,
    'локально подтверждённый отклик показывает ожидание': "const appStatus = myApp ? STATUS_MAP[myApp.status] : (applySubmitted ? STATUS_MAP.pending : null);" in perm_detail,
    'статус отклика не наследуется от прошлого чата': "setLikeStatus(null);\n    setLikeStatusLoadFailed(false);\n    let cancelled = false;" in chat_room,
    'устаревший ответ статуса отклика игнорируется': "if (cancelled) return;" in chat_room and "return () => { cancelled = true; };" in chat_room,
    'сбой загрузки статуса отклика виден': "setLikeStatusLoadFailed(true);" in chat_room and 'Не удалось загрузить статус отклика' in chat_room,
    'статус отклика можно загрузить повторно': "setLikeStatusRetry(x => x + 1)" in chat_room and 'likeStatusRetry]);' in chat_room,
    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('network action truth: ПРОВАЛЫ')
    for name in failed:
        print('  -', name)
    raise SystemExit(1)
print(f'network action truth: ok; {len(checks)} guards')
