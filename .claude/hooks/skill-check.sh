#!/usr/bin/env bash
# JobToo: напоминание свериться со скиллом перед правкой файлов.
# Срабатывает один раз за сессию, чтобы не засорять каждый Edit.
set -u
payload="$(cat)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)"
marker="${TMPDIR:-/tmp}/jobtoo-skill-check-${sid}"
[ -e "$marker" ] && exit 0
: > "$marker"
jq -n '{
  systemMessage: "CLAUDE.md: перед изменением — проверь, какой скилл из .claude/skills/ здесь помогает.",
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: "Правило JobToo (CLAUDE.md): перед любым изменением файлов сначала подбери подходящий скилл из .claude/skills/ (872 шт.) и вызови его через Skill. Ориентиры: экраны — senior-frontend/frontend-design; публичные страницы и robots.txt — seo-optimizer; авторизация, токены, ПДн — security-review; база — supabase-postgres-best-practices; чужой код — code-review/simplify; где что лежит — docs/MAP.md. Подходящего нет — работай как обычно, но заведи скилл через skill-creator, если задача повторяется."
  }
}'
