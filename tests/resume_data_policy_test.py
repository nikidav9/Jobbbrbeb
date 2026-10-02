from pathlib import Path

root = Path(__file__).resolve().parents[1]
legal = (root / "constants/legal.ts").read_text(encoding="utf-8")
rkn = (root / "docs/rkn-подготовка.md").read_text(encoding="utf-8")
db = (root / "php-proxy/db.php").read_text(encoding="utf-8")
types = (root / "constants/types.ts").read_text(encoding="utf-8")

# Публичные документы обязаны перечислять новый фактический состав резюме.
for needle in [
    "Исходные PDF-резюме",
    "желаемая должность и зарплата",
    "опыт работы",
    "образование",
    "контактный email из резюме",
    "приватная вкладка «Личные»",
]:
    assert needle in legal, needle

# Существенное расширение состава данных требует нового общего согласия.
privacy = legal[legal.index("  privacy: {"):legal.index("  consent: {")]
consent = legal[legal.index("  consent: {"):legal.index("  dataPolicy: {")]
# Редакция 2026-09-26-2 (согласия работодателю по поручению) снова подняла
# consentVersion — расширение резюме 2026-09-21, Юпитер 2026-09-25 и почта
# 2026-09-26 покрыты ею же, повторное согласие спросится.
# 2026-10-01: в политику добавлено письмо-сводку о непрочитанном (служебное) —
# поднят только version, повторное согласие не нужно.
# 2026-10-02: YandexGPT среди обработчиков — новый получатель, согласие заново.
assert "version: '2026-10-02'" in privacy
assert "consentVersion: '2026-10-02'" in privacy
assert "version: '2026-10-02'" in consent
assert "consentVersion: '2026-10-02'" in consent

# «Ответы для откликов» (applyAnswers): срок выхода и ник в Telegram названы во
# всех трёх перечнях данных.
dpolicy = legal[legal.index("  dataPolicy: {"):legal.index("  marketing: {")]
for doc in (privacy, consent, dpolicy):
    assert "«Ответы для откликов»" in doc
    assert "срок выхода на работу" in doc
    assert "ник в Telegram" in doc

# Приватный PDF/email/личная анкета не должны внезапно стать публичными.
public_cols = db[db.index("define('USER_PUBLIC_COLS'"):db.index("define('USER_SELF_COLS'")]
assert "resume_data" in public_cols
assert "resume_email" not in public_cols
assert "personal_data" not in public_cols
assert "resume_email" in db[db.index("define('USER_SELF_COLS'"):db.index("function is_bcrypt")]
assert "personal_data" in db[db.index("define('USER_SELF_COLS'"):db.index("function is_bcrypt")]

# Инвентаризация РКН должна помнить про сейф и минимизацию личной анкеты.
assert "jm_resume_files" in rkn
assert "resume-files" in rkn
for removed in [
    "disabilityStatus", "birthday", "emergencyContact", "veteranStatus",
    "gender", "pronouns", "race", "sexualOrientation",
    "professionalReferences", "militaryService", "securityClearance",
]:
    assert removed not in types, removed

# Поля, которые документация перечисляет как резюме/личную анкету, существуют.
assert "export interface ResumeProfile" in types
assert "export interface PersonalDetails" in types

print("ok")
