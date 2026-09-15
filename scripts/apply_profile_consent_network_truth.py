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


replace_once(
    'app/(tabs)/profile.tsx',
    """  const [consent, setConsent] = useState<{\n    stamp: string; docs: Record<string, string>; accepted_at: string;\n  } | null>(null);\n\n  useEffect(() => {\n    if (!currentUser) return;\n    let alive = true;\n    dbGetConsent(currentUser.id)\n      .then(c => { if (alive) setConsent(c); })\n      .catch(() => {});\n    return () => { alive = false; };\n  }, [currentUser?.id]);\n\n  const consentLine = !consent\n    ? 'Соглашения и обучение'\n""",
    """  const [consent, setConsent] = useState<{\n    stamp: string; docs: Record<string, string>; accepted_at: string;\n  } | null>(null);\n  const [consentLoadFailed, setConsentLoadFailed] = useState(false);\n  const [consentRetry, setConsentRetry] = useState(0);\n\n  useEffect(() => {\n    if (!currentUser) return;\n    let alive = true;\n    setConsent(null);\n    setConsentLoadFailed(false);\n    dbGetConsent(currentUser.id)\n      .then(c => {\n        if (!alive) return;\n        setConsent(c);\n        setConsentLoadFailed(false);\n      })\n      .catch(() => { if (alive) setConsentLoadFailed(true); });\n    return () => { alive = false; };\n  }, [currentUser?.id, consentRetry]);\n\n  const consentLine = consentLoadFailed && !consent\n    ? 'Не удалось проверить статус согласий'\n    : !consent\n    ? 'Проверяем соглашения…'\n""",
)

replace_once(
    'app/(tabs)/profile.tsx',
    """        >\n          {[\n            { label: 'Пользовательское соглашение', doc: 'terms' as const },\n""",
    """        >\n          {consentLoadFailed && !consent ? (\n            <TouchableOpacity\n              style={sS.actionRow}\n              onPress={() => setConsentRetry(value => value + 1)}\n              activeOpacity={0.7}\n            >\n              <Ionicons name=\"cloud-offline-outline\" size={17} color=\"#92400E\" />\n              <View style={{ flex: 1 }}>\n                <Text style={sS.actionLabel}>Не удалось проверить, какие редакции вы принимали</Text>\n                <Text style={sS.docVersion}>Проверьте связь · нажмите, чтобы повторить</Text>\n              </View>\n              <Ionicons name=\"refresh\" size={16} color={Colors.textMuted} />\n            </TouchableOpacity>\n          ) : null}\n          {[\n            { label: 'Пользовательское соглашение', doc: 'terms' as const },\n""",
)

replace_once(
    'tests/network_action_truth_test.py',
    """perm = (root / 'components/feature/PermApplicationsSheet.tsx').read_text(encoding='utf-8')\nplan = (root / 'docs/план-разработки.md').read_text(encoding='utf-8')\n""",
    """perm = (root / 'components/feature/PermApplicationsSheet.tsx').read_text(encoding='utf-8')\nprofile = (root / 'app/(tabs)/profile.tsx').read_text(encoding='utf-8')\nplan = (root / 'docs/план-разработки.md').read_text(encoding='utf-8')\n""",
)

replace_once(
    'tests/network_action_truth_test.py',
    """    'частичный сбой партнёрского фида виден и имеет retry': 'Партнёрские смены не обновились' in feed and 'onPress={() => void loadPartnerShifts()}' in feed,\n    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,\n""",
    """    'частичный сбой партнёрского фида виден и имеет retry': 'Партнёрские смены не обновились' in feed and 'onPress={() => void loadPartnerShifts()}' in feed,\n    'статус согласий не проглатывает сетевую ошибку': 'setConsentLoadFailed(true);' in profile and 'Не удалось проверить статус согласий' in profile,\n    'статус согласий можно проверить повторно': 'setConsentRetry(value => value + 1)' in profile and 'consentRetry]);' in profile,\n    'успешная загрузка согласий снимает ошибку': 'setConsent(c);' in profile and 'setConsentLoadFailed(false);' in profile,\n    'план фиксирует завершение сетевой ревизии': '~~Системная ревизия ошибок сети, пустых состояний и малых экранов~~' in plan and '**сделано 15.09.**' in plan,\n    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,\n""",
)

old_plan = """3. Системная ревизия ошибок сети, пустых состояний и малых экранов —\n   **в работе 15.09.** Сделано: три экрана работника (лента, отклики, переписки)\n   перестали выдавать обрыв связи за пустоту; профиль не показывает «Сохранено»\n   до подтверждения сервера; pull-to-refresh в ленте, откликах, переписках и\n   шторке постоянной вакансии всегда отпускает индикатор после ошибки; удаление\n   переписки не прячет строку до подтверждения сервера. Осталось: системно\n   разобрать прочие пустые `catch` и проверить малые экраны по снимкам.\n"""
new_plan = """3. ~~Системная ревизия ошибок сети, пустых состояний и малых экранов~~ —\n   **сделано 15.09.** Критические пользовательские чтения и мутации больше не\n   выдают сбой сети за пустой результат или успех: закрыты регистрация, лента,\n   отклики, переписки, профиль/отзывы/согласия, Telegram, рейтинг, удаление и\n   закрытие вакансий, постоянные отклики, частичный сбой партнёрского фида и\n   временные пропуски пользователей. Оставшиеся silent `catch` классифицированы\n   как намеренный best-effort для кэша, аналитики, системной отмены/cleanup и\n   refresh после уже подтверждённой серверной записи. Small-screen guard прогнал\n   24 состояния на ширинах 320/360 px без горизонтального overflow.\n"""
replace_once('docs/план-разработки.md', old_plan, new_plan)

print('profile consent network truth patch applied')
