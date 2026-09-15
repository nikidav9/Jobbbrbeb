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
    'services/db.ts',
    "export async function dbTgPrepareLink(userId: string): Promise<void> {\n  try { await proxy('tgPrepareLink', [userId]); } catch {}\n}",
    "export async function dbTgPrepareLink(userId: string): Promise<void> {\n  // Ошибка должна дойти до UI: оба места вызова уже завершают fire-and-forget\n  // собственным .catch(...) и показывают человеку, что привязку подготовить не удалось.\n  await proxy('tgPrepareLink', [userId]);\n}",
)

# После notification-read рефакторинга компонент выбирает контекстный write
# либо прямой db fallback и ждёт единый Promise `op`. Старый source-assert
# искал только прямой await и ложно краснел при корректном поведении.
replace_once(
    'tests/offline_states_test.php',
    "check('уведомления: прочитать все меняет UI только после сервера',\n    (bool)preg_match('~await dbMarkAllNotifsRead\\(userId\\);[\\s\\S]{0,180}setNotifs~', $bell));",
    "check('уведомления: прочитать все меняет UI только после сервера',\n    str_contains($bell, 'const op = app?.markAllNotifsRead')\n    && str_contains($bell, ': dbMarkAllNotifsRead(userId);')\n    && (bool)preg_match('~await op;[\\s\\S]{0,180}setNotifs~', $bell));",
)

replace_once(
    'tests/offline_states_test.php',
    "check('telegram: fire-and-forget заявка не даёт unhandled rejection',\n    str_contains($tg, 'void dbTgPrepareLink(userId).catch'));",
    "check('telegram: fire-and-forget заявка не даёт unhandled rejection',\n    str_contains($tg, 'void dbTgPrepareLink(userId).catch'));\n$db = (string)file_get_contents(__DIR__ . '/../services/db.ts');\ncheck('telegram: prepare-link не скрывает сетевую ошибку от UI',\n    str_contains($db, \"await proxy('tgPrepareLink', [userId]);\")\n    && !str_contains($db, \"try { await proxy('tgPrepareLink', [userId]); } catch {}\"));",
)

print('telegram prepare-link truth patch applied')
