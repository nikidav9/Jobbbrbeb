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
profile = (root / 'app/(tabs)/profile.tsx').read_text(encoding='utf-8')
plan = (root / 'docs/план-разработки.md').read_text(encoding='utf-8')

# 17.09: раздел подработки удалён, закрытия и удаления смены в ленте больше
# нет. Остались только постоянные вакансии.
perm_delete_start = feed.find('  const deletePermVacancy = async')
perm_delete = feed[perm_delete_start:perm_delete_start + 2600] if perm_delete_start >= 0 else ''
perm_close_start = feed.find('  const closePermVacancy = async')
perm_close = feed[perm_close_start:perm_delete_start] if perm_close_start >= 0 and perm_delete_start > perm_close_start else ''
rate_submit_start = rate.find('  const submit = async')
rate_submit_end = rate.find('  const skip =', rate_submit_start)
rate_submit = rate[rate_submit_start:rate_submit_end] if rate_submit_start >= 0 and rate_submit_end > rate_submit_start else ''
perm_apply_start = perm_detail.find('  const sendApply = async')
perm_apply_end = perm_detail.find('  const toggleSave = async', perm_apply_start)
perm_apply = perm_detail[perm_apply_start:perm_apply_end] if perm_apply_start >= 0 and perm_apply_end > perm_apply_start else ''
employer_approve_start = matches.find('  const approvePermApp = async')
employer_reject_start = matches.find('  const rejectPermApp = async', employer_approve_start)
employer_finish_start = matches.find('  const finishPermApp = async', employer_reject_start)
employer_render_start = matches.find('  const approveInfo =', employer_finish_start)
employer_approve = matches[employer_approve_start:employer_reject_start] if employer_approve_start >= 0 and employer_reject_start > employer_approve_start else ''
employer_reject = matches[employer_reject_start:employer_finish_start] if employer_reject_start >= 0 and employer_finish_start > employer_reject_start else ''
employer_finish = matches[employer_finish_start:employer_render_start] if employer_finish_start >= 0 and employer_render_start > employer_finish_start else ''
sheet_approve_start = perm.find('  const approve = async')
sheet_reject_start = perm.find('  const reject = async', sheet_approve_start)
sheet_render_start = perm.find('  const approvingWorker =', sheet_reject_start)
sheet_approve = perm[sheet_approve_start:sheet_reject_start] if sheet_approve_start >= 0 and sheet_reject_start > sheet_approve_start else ''
sheet_reject = perm[sheet_reject_start:sheet_render_start] if sheet_reject_start >= 0 and sheet_render_start > sheet_reject_start else ''

rating_write = 'const { bothRated } = await dbSubmitRatingAndMaybeDelete({'
rating_refresh = "try {\n        await refreshAll();\n      } catch {\n        // Следующий обычный refresh подтянет уже сохранённое состояние.\n      }"
rating_success = "showToast('Оценка сохранена! Спасибо 🌟', 'success');"

checks = {
    'чаты отпускают refresh в finally': "showToast('Не удалось обновить переписки. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in chats,
    'отклики отпускают refresh в finally': "showToast('Не удалось обновить отклики. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in matches,
    'лента отпускает refresh в finally': "showToast('Не удалось обновить вакансии. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in feed,
    'шторка откликов отпускает refresh в finally': "showToast('Не удалось обновить отклики. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in perm,
    'чат ждёт сервер перед скрытием': "await onDelete();\n              setDeleted(true);" in chats,
    'pending удаления не скрывает строку': 'if (deleting) return null;' not in chats and 'if (deleted) return null;' in chats,
    'ошибка удаления возвращает строку': "setDeleting(false);\n              Animated.spring(pan, { toValue: 0" in chats,
    'успех удаления идёт после серверной записи': chats.find("await dbDeleteChat(chatId);") < chats.find("showToast('Переписка удалена', 'success');"),
    'постоянная вакансия видна до подтверждения удаления': 'if (deletedPermIds.has(v.id)) return false;' in feed and 'if (deletingPermIds.has(v.id)) return false;' not in feed,
    'постоянная вакансия ждёт сервер': "await dbDeletePermVacancy(id);" in perm_delete and perm_delete.find("await dbDeletePermVacancy(id);") < perm_delete.find("setDeletedPermIds(prev"),
    'ошибка удаления постоянной вакансии видна': "showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');" in perm_delete,
    'закрытие постоянной вакансии ждёт сервер перед успехом': "await dbClosePermVacancy(id);" in perm_close and perm_close.find('await dbClosePermVacancy(id);') < perm_close.find("showToast('Вакансия закрыта', 'success');"),
    'ошибка закрытия постоянной вакансии видна и откатывает UI': "showToast('Не удалось закрыть вакансию. Проверьте связь.', 'error');" in perm_close and 'next.delete(id);' in perm_close,
    'закрытие вакансий больше не fire-and-forget': ".then(() => refreshPermVacancies()" not in perm_close,
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
    'одобрение постоянного кандидата фиксирует локальный статус после RPC': "setLocalPermStatus(prev => ({ ...prev, [app.id]: 'approved' }));" in employer_approve and employer_approve.find('await dbApprovePermApplication') < employer_approve.find('setLocalPermStatus'),
    'refresh после одобрения не отменяет успех': "refreshPermApplications().catch(() => {})" in employer_approve and "refreshChats(currentUser).catch(() => {})" in employer_approve and employer_approve.find("showToast('Одобрено! Чат открыт 🎉'") > employer_approve.find('refreshChats'),
    'отказ постоянному кандидату фиксируется до refresh': "[app.id]: 'rejected'" in employer_reject and employer_reject.find("await dbSetPermApplicationStatus(app.id, 'rejected');") < employer_reject.find("[app.id]: 'rejected'"),
    'refresh после отказа изолирован': "try {\n        await refreshPermApplications();\n      } catch {" in employer_reject and employer_reject.find("showToast('Отклонено', 'success');") > employer_reject.find('await refreshPermApplications();'),
    'завершение постоянного кандидата фиксируется до refresh': "[app.id]: 'hired'" in employer_finish and employer_finish.find("await dbSetPermApplicationStatus(app.id, 'hired');") < employer_finish.find("[app.id]: 'hired'"),
    'refresh после hired изолирован': "try {\n        await refreshPermApplications();\n      } catch {" in employer_finish and employer_finish.find('status_check') > employer_finish.find("showToast('Кандидат закрыт."),
    'локальный статус переставляет карточку между вкладками': "localPermStatus[app.id] ? { ...app, status: localPermStatus[app.id] } : app" in matches,
    'шторка одобрения тоже не зависит от refresh': "refreshPermApplications().catch(() => {})" in sheet_approve and "refreshChats(currentUser).catch(() => {})" in sheet_approve and "[app.id]: 'approved'" in sheet_approve,
    'шторка отказа сохраняет серверную правду локально': "[app.id]: 'rejected'" in sheet_reject and "try {\n        await refreshPermApplications();\n      } catch {" in sheet_reject,
    'статус отклика не наследуется от прошлого чата': "setLikeStatus(null);\n    setLikeStatusLoadFailed(false);\n    let cancelled = false;" in chat_room,
    'устаревший ответ статуса отклика игнорируется': "if (cancelled) return;" in chat_room and "return () => { cancelled = true; };" in chat_room,
    'сбой загрузки статуса отклика виден': "setLikeStatusLoadFailed(true);" in chat_room and 'Не удалось загрузить статус отклика' in chat_room,
    'статус отклика можно загрузить повторно': "setLikeStatusRetry(x => x + 1)" in chat_room and 'likeStatusRetry]);' in chat_room,
    'refresh постоянной ленты завершается в finally': "showToast('Не удалось обновить вакансии. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);" in feed,
    'статус согласий не проглатывает сетевую ошибку': 'setConsentLoadFailed(true);' in profile and 'Не удалось проверить статус согласий' in profile,
    'статус согласий можно проверить повторно': 'setConsentRetry(value => value + 1)' in profile and 'consentRetry]);' in profile,
    'успешная загрузка согласий снимает ошибку': ('setConsent(core);' in profile or 'setConsent(c);' in profile) and 'setConsentLoadFailed(false);' in profile,
    'план фиксирует завершение сетевой ревизии': '~~Системная ревизия ошибок сети, пустых состояний и малых экранов~~' in plan and '**сделано 15.09.**' in plan,
    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('network action truth: ПРОВАЛЫ')
    for name in failed:
        print('  -', name)
    raise SystemExit(1)
print(f'network action truth: ok; {len(checks)} guards')
