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
consent = legal[legal.index("  consent: {"):legal.index("  crossBorderConsent: {")]
assert "version: '2026-09-21-2'" in privacy
assert "consentVersion: '2026-09-21'" in privacy
assert "version: '2026-09-21-2'" in consent
assert "consentVersion: '2026-09-21'" in consent

# Приватный PDF/email/личная анкета не должны внезапно стать публичными.
public_cols = db[db.index("define('USER_PUBLIC_COLS'"):db.index("define('USER_SELF_COLS'")]
assert "resume_data" in public_cols
assert "resume_email" not in public_cols
assert "personal_data" not in public_cols
assert "resume_email" in db[db.index("define('USER_SELF_COLS'"):db.index("function is_bcrypt")]
assert "personal_data" in db[db.index("define('USER_SELF_COLS'"):db.index("function is_bcrypt")]

# Инвентаризация РКН должна помнить про сейф и отсутствие удалённого поля.
assert "jm_resume_files" in rkn
assert "resume-files" in rkn
assert "Сведения об инвалидности" not in rkn
assert "disabilityStatus" not in types

# Поля, которые документация перечисляет как резюме/личную анкету, существуют.
assert "export interface ResumeProfile" in types
assert "export interface PersonalDetails" in types

print("ok")
