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
    'app/perm-vacancy-detail.tsx',
    "  const [applying, setApplying] = useState(false);\n\n  const [applyOpen, setApplyOpen] = useState(false);",
    "  const [applying, setApplying] = useState(false);\n  // Серверная запись важнее последующего refresh: если отклик уже принят,\n  // не даём отправить его повторно только потому, что сеть оборвалась на чтении.\n  const [applySubmitted, setApplySubmitted] = useState(false);\n\n  const [applyOpen, setApplyOpen] = useState(false);",
)
replace_once(
    'app/perm-vacancy-detail.tsx',
    "  const isApplied = !!myApp;",
    "  const isApplied = !!myApp || applySubmitted;",
)
replace_once(
    'app/perm-vacancy-detail.tsx',
    "      await dbApplyPermVacancy(vacancy.id, currentUser.id, vacancy.employerId, message);\n      setApplyOpen(false);\n      await refreshPermApplications();\n      // Директора уведомляет сервер при создании отклика — и сообщением, и\n      // карточкой с кнопками в телеграме. Раньше это делал телефон соискателя\n      // уже после записи: старая версия или обрыв связи — и директор не\n      // узнавал ничего, а ошибка глоталась молча.\n      showToast('Отклик отправлен! 📨', 'success');",
    "      await dbApplyPermVacancy(vacancy.id, currentUser.id, vacancy.employerId, message);\n      setApplySubmitted(true);\n      setApplyOpen(false);\n      try {\n        await refreshPermApplications();\n      } catch {\n        // Отклик уже записан на сервере. Сбой последующего чтения не должен\n        // превращать успешную запись в «Не удалось отправить отклик».\n      }\n      // Директора уведомляет сервер при создании отклика — и сообщением, и\n      // карточкой с кнопками в телеграме. Раньше это делал телефон соискателя\n      // уже после записи: старая версия или обрыв связи — и директор не\n      // узнавал ничего, а ошибка глоталась молча.\n      showToast('Отклик отправлен! 📨', 'success');",
)
replace_once(
    'app/perm-vacancy-detail.tsx',
    "  const appStatus = myApp ? STATUS_MAP[myApp.status] : null;",
    "  const appStatus = myApp ? STATUS_MAP[myApp.status] : (applySubmitted ? STATUS_MAP.pending : null);",
)

replace_once(
    'tests/network_action_truth_test.py',
    "rate = (root / 'app/rate.tsx').read_text(encoding='utf-8')\nperm = (root / 'components/feature/PermApplicationsSheet.tsx').read_text(encoding='utf-8')",
    "rate = (root / 'app/rate.tsx').read_text(encoding='utf-8')\nperm_detail = (root / 'app/perm-vacancy-detail.tsx').read_text(encoding='utf-8')\nperm = (root / 'components/feature/PermApplicationsSheet.tsx').read_text(encoding='utf-8')",
)
replace_once(
    'tests/network_action_truth_test.py',
    "rate_submit = rate[rate_submit_start:rate_submit_end] if rate_submit_start >= 0 and rate_submit_end > rate_submit_start else ''\n\nrating_write =",
    "rate_submit = rate[rate_submit_start:rate_submit_end] if rate_submit_start >= 0 and rate_submit_end > rate_submit_start else ''\nperm_apply_start = perm_detail.find('  const sendApply = async')\nperm_apply_end = perm_detail.find('  const toggleSave = async', perm_apply_start)\nperm_apply = perm_detail[perm_apply_start:perm_apply_end] if perm_apply_start >= 0 and perm_apply_end > perm_apply_start else ''\n\nrating_write =",
)
replace_once(
    'tests/network_action_truth_test.py',
    "    'ошибка сохранения остаётся для неуспешной записи': \"showToast('Ошибка при сохранении', 'error');\" in rate_submit,\n    'статус отклика не наследуется от прошлого чата':",
    "    'ошибка сохранения остаётся для неуспешной записи': \"showToast('Ошибка при сохранении', 'error');\" in rate_submit,\n    'постоянный отклик ждёт серверную запись': \"await dbApplyPermVacancy(vacancy.id, currentUser.id, vacancy.employerId, message);\" in perm_apply,\n    'успешный постоянный отклик фиксируется локально до refresh': \"setApplySubmitted(true);\" in perm_apply and perm_apply.find('await dbApplyPermVacancy') < perm_apply.find('setApplySubmitted(true);'),\n    'refresh постоянного отклика изолирован после записи': \"try {\\n        await refreshPermApplications();\\n      } catch {\" in perm_apply and perm_apply.find('setApplySubmitted(true);') < perm_apply.find('await refreshPermApplications();'),\n    'сбой refresh не отменяет успех постоянного отклика': \"showToast('Отклик отправлен! 📨', 'success');\" in perm_apply and perm_apply.find('await refreshPermApplications();') < perm_apply.find(\"showToast('Отклик отправлен! 📨', 'success');\"),\n    'после подтверждённой записи нельзя отправить постоянный отклик повторно': \"const isApplied = !!myApp || applySubmitted;\" in perm_detail,\n    'локально подтверждённый отклик показывает ожидание': \"const appStatus = myApp ? STATUS_MAP[myApp.status] : (applySubmitted ? STATUS_MAP.pending : null);\" in perm_detail,\n    'статус отклика не наследуется от прошлого чата':",
)

print('permanent application truth patch applied')
