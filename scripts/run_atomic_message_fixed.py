from pathlib import Path
import runpy

# Основной patcher уже корректно меняет бизнес-код; первый guard остановился
# только на PHP-экранировании двух проверочных строк. Выполняем его и правим
# именно сгенерированный regression-файл перед запуском тестов.
# Этот файл запускается одноразовым guarded workflow и после успеха удаляется.
runpy.run_path('scripts/apply_atomic_message.py', run_name='__main__')

p = Path('tests/message_notify_test.php')
text = p.read_text(encoding='utf-8')
replacements = {
    '''str_contains($insert, "'p_message_id' => $messageId")''': '''str_contains($insert, "'p_message_id' => \\$messageId")''',
    '''str_contains($insert, "if (!empty($result['inserted']))")''': '''str_contains($insert, "if (!empty(\\$result['inserted']))")''',
}
for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'atomic regression quote fix: expected 1 match, got {count}: {old}')
    text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
print('atomic message regression quoting fixed')
