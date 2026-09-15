#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one anchor, found {count}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# Employer matches: server-confirmed status is authoritative even if the
# following read fails. Keep a local overlay so the just-resolved card cannot
# immediately offer the same action again while offline.
replace_once(
    'app/(tabs)/matches.tsx',
    "  const [actionLoading, setLoading] = useState<string | null>(null);\n  const [approvingApp, setApprovingApp] = useState<PermApplication | null>(null);",
    "  const [actionLoading, setLoading] = useState<string | null>(null);\n  const [approvingApp, setApprovingApp] = useState<PermApplication | null>(null);\n  const [localPermStatus, setLocalPermStatus] = useState<Record<string, PermApplication['status']>>({});",
)
replace_once(
    'app/(tabs)/matches.tsx',
    "  const myPermApps: PermApplication[] = employerPermApps(permApplications, currentUserId);",
    "  const myPermApps: PermApplication[] = employerPermApps(permApplications, currentUserId).map(app =>\n    localPermStatus[app.id] ? { ...app, status: localPermStatus[app.id] } : app\n  );",
)
replace_once(
    'app/(tabs)/matches.tsx',
    "      const chatId = await dbApprovePermApplication(app.id, message);\n      setApprovingApp(null);\n      await refreshPermApplications();\n      await refreshChats(currentUser);\n      showToast('Одобрено! Чат открыт 🎉', 'match');",
    "      const chatId = await dbApprovePermApplication(app.id, message);\n      setLocalPermStatus(prev => ({ ...prev, [app.id]: 'approved' }));\n      setApprovingApp(null);\n      // Транзакция уже завершилась. Последующие чтения только синхронизируют\n      // локальный список и не имеют права превратить успех в «Ошибка».\n      await Promise.all([\n        refreshPermApplications().catch(() => {}),\n        refreshChats(currentUser).catch(() => {}),\n      ]);\n      showToast('Одобрено! Чат открыт 🎉', 'match');",
)
replace_once(
    'app/(tabs)/matches.tsx',
    "      await dbSetPermApplicationStatus(app.id, 'rejected');\n      await refreshPermApplications();\n      showToast('Отклонено', 'success');",
    "      await dbSetPermApplicationStatus(app.id, 'rejected');\n      setLocalPermStatus(prev => ({ ...prev, [app.id]: 'rejected' }));\n      try {\n        await refreshPermApplications();\n      } catch {\n        // Сервер уже принял решение; локальный статус выше остаётся правдой.\n      }\n      showToast('Отклонено', 'success');",
)
replace_once(
    'app/(tabs)/matches.tsx',
    "      await dbSetPermApplicationStatus(app.id, 'hired');\n      await refreshPermApplications();\n      showToast('Кандидат закрыт. Вакансия осталась в поиске — закрыть её можно во вкладке «Активные»', 'success');",
    "      await dbSetPermApplicationStatus(app.id, 'hired');\n      setLocalPermStatus(prev => ({ ...prev, [app.id]: 'hired' }));\n      try {\n        await refreshPermApplications();\n      } catch {\n        // Статус hired уже записан; refresh — только синхронизация списка.\n      }\n      showToast('Кандидат закрыт. Вакансия осталась в поиске — закрыть её можно во вкладке «Активные»', 'success');",
)

# Vacancy applications sheet: same operations through the second UI entry.
replace_once(
    'components/feature/PermApplicationsSheet.tsx',
    "  const [refreshing, setRefreshing] = useState(false);\n  const [approving, setApproving] = useState<PermApplication | null>(null);\n\n  const vacancy = permVacancies.find(v => v.id === vacancyId);\n  const apps = permApplications.filter(a => a.vacancyId === vacancyId);",
    "  const [refreshing, setRefreshing] = useState(false);\n  const [approving, setApproving] = useState<PermApplication | null>(null);\n  const [localPermStatus, setLocalPermStatus] = useState<Record<string, PermApplication['status']>>({});\n\n  const vacancy = permVacancies.find(v => v.id === vacancyId);\n  const apps = permApplications\n    .filter(a => a.vacancyId === vacancyId)\n    .map(app => localPermStatus[app.id] ? { ...app, status: localPermStatus[app.id] } : app);",
)
replace_once(
    'components/feature/PermApplicationsSheet.tsx',
    "      const chatId = await dbApprovePermApplication(app.id, message);\n      setApproving(null);\n      await refreshPermApplications();\n      await refreshChats(currentUser);\n      showToast('Одобрено! Чат открыт', 'match');",
    "      const chatId = await dbApprovePermApplication(app.id, message);\n      setLocalPermStatus(prev => ({ ...prev, [app.id]: 'approved' }));\n      setApproving(null);\n      // Решение и чат уже закоммичены; refresh не меняет исход операции.\n      await Promise.all([\n        refreshPermApplications().catch(() => {}),\n        refreshChats(currentUser).catch(() => {}),\n      ]);\n      showToast('Одобрено! Чат открыт', 'match');",
)
replace_once(
    'components/feature/PermApplicationsSheet.tsx',
    "      await dbSetPermApplicationStatus(app.id, 'rejected');\n      await refreshPermApplications();\n      showToast('Отклонено', 'success');",
    "      await dbSetPermApplicationStatus(app.id, 'rejected');\n      setLocalPermStatus(prev => ({ ...prev, [app.id]: 'rejected' }));\n      try {\n        await refreshPermApplications();\n      } catch {\n        // Отказ уже записан; не возвращаем кнопку из-за сбоя чтения.\n      }\n      showToast('Отклонено', 'success');",
)

# Regression guards for both entry points and all employer permanent-app writes.
replace_once(
    'tests/network_action_truth_test.py',
    "perm_apply = perm_detail[perm_apply_start:perm_apply_end] if perm_apply_start >= 0 and perm_apply_end > perm_apply_start else ''\n\nrating_write =",
    "perm_apply = perm_detail[perm_apply_start:perm_apply_end] if perm_apply_start >= 0 and perm_apply_end > perm_apply_start else ''\nemployer_approve_start = matches.find('  const approvePermApp = async')\nemployer_reject_start = matches.find('  const rejectPermApp = async', employer_approve_start)\nemployer_finish_start = matches.find('  const finishPermApp = async', employer_reject_start)\nemployer_render_start = matches.find('  const approveInfo =', employer_finish_start)\nemployer_approve = matches[employer_approve_start:employer_reject_start] if employer_approve_start >= 0 and employer_reject_start > employer_approve_start else ''\nemployer_reject = matches[employer_reject_start:employer_finish_start] if employer_reject_start >= 0 and employer_finish_start > employer_reject_start else ''\nemployer_finish = matches[employer_finish_start:employer_render_start] if employer_finish_start >= 0 and employer_render_start > employer_finish_start else ''\nsheet_approve_start = perm.find('  const approve = async')\nsheet_reject_start = perm.find('  const reject = async', sheet_approve_start)\nsheet_render_start = perm.find('  const approvingWorker =', sheet_reject_start)\nsheet_approve = perm[sheet_approve_start:sheet_reject_start] if sheet_approve_start >= 0 and sheet_reject_start > sheet_approve_start else ''\nsheet_reject = perm[sheet_reject_start:sheet_render_start] if sheet_reject_start >= 0 and sheet_render_start > sheet_reject_start else ''\n\nrating_write =",
)
replace_once(
    'tests/network_action_truth_test.py',
    "    'локально подтверждённый отклик показывает ожидание': \"const appStatus = myApp ? STATUS_MAP[myApp.status] : (applySubmitted ? STATUS_MAP.pending : null);\" in perm_detail,\n    'статус отклика не наследуется от прошлого чата':",
    "    'локально подтверждённый отклик показывает ожидание': \"const appStatus = myApp ? STATUS_MAP[myApp.status] : (applySubmitted ? STATUS_MAP.pending : null);\" in perm_detail,\n    'одобрение постоянного кандидата фиксирует локальный статус после RPC': \"setLocalPermStatus(prev => ({ ...prev, [app.id]: 'approved' }));\" in employer_approve and employer_approve.find('await dbApprovePermApplication') < employer_approve.find('setLocalPermStatus'),\n    'refresh после одобрения не отменяет успех': \"refreshPermApplications().catch(() => {})\" in employer_approve and \"refreshChats(currentUser).catch(() => {})\" in employer_approve and employer_approve.find(\"showToast('Одобрено! Чат открыт 🎉'\") > employer_approve.find('refreshChats'),\n    'отказ постоянному кандидату фиксируется до refresh': \"[app.id]: 'rejected'\" in employer_reject and employer_reject.find(\"await dbSetPermApplicationStatus(app.id, 'rejected');\") < employer_reject.find(\"[app.id]: 'rejected'\"),\n    'refresh после отказа изолирован': \"try {\\n        await refreshPermApplications();\\n      } catch {\" in employer_reject and employer_reject.find(\"showToast('Отклонено', 'success');\") > employer_reject.find('await refreshPermApplications();'),\n    'завершение постоянного кандидата фиксируется до refresh': \"[app.id]: 'hired'\" in employer_finish and employer_finish.find(\"await dbSetPermApplicationStatus(app.id, 'hired');\") < employer_finish.find(\"[app.id]: 'hired'\"),\n    'refresh после hired изолирован': \"try {\\n        await refreshPermApplications();\\n      } catch {\" in employer_finish and employer_finish.find('status_check') > employer_finish.find(\"showToast('Кандидат закрыт.\"),\n    'локальный статус переставляет карточку между вкладками': \"localPermStatus[app.id] ? { ...app, status: localPermStatus[app.id] } : app\" in matches,\n    'шторка одобрения тоже не зависит от refresh': \"refreshPermApplications().catch(() => {})\" in sheet_approve and \"refreshChats(currentUser).catch(() => {})\" in sheet_approve and \"[app.id]: 'approved'\" in sheet_approve,\n    'шторка отказа сохраняет серверную правду локально': \"[app.id]: 'rejected'\" in sheet_reject and \"try {\\n        await refreshPermApplications();\\n      } catch {\" in sheet_reject,\n    'статус отклика не наследуется от прошлого чата':",
)

print('employer permanent application truth patch applied')
