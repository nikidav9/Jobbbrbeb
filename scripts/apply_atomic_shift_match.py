from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


# db.php is large, so patch it by guarded structural markers instead of
# replacing the whole file through the Contents API.
db_path = Path('php-proxy/db.php')
db = db_path.read_text(encoding='utf-8')

db = replace_once(
    db,
    "    'dbCheckAndCreateMatch' => 1, 'dbApplyPermVacancy' => 1,\n",
    "    'dbApplyPermVacancy' => 1,\n",
    'dbCheckAndCreateMatch selfArg entry',
)

start_marker = "        case 'dbCheckAndCreateMatch': {"
end_marker = '        // ── Permanent vacancies'
start = db.find(start_marker)
end = db.find(end_marker, start)
if start < 0 or end <= start:
    raise SystemExit('dbCheckAndCreateMatch case markers not found')

new_case = r'''        case 'dbCheckAndCreateMatch': {
            $vid = (string)($args[0] ?? '');
            $wid = (string)($args[1] ?? '');
            if ($vid === '' || $wid === '') {
                jt_respond(['error' => 'Vacancy and worker required'], 400); exit;
            }

            // Проверяем право по фактической связи, а не по положению аргумента.
            // Раньше workerId лежал в $selfArgFns: работник проходил, а
            // работодатель — владелец вакансии — получал 403 и не мог завершить
            // взаимный лайк в мэтч. Теперь допустимы ровно две стороны отклика.
            $like = sb_single('jm_likes', [
                'vacancy_id' => 'eq.' . $vid,
                'worker_id' => 'eq.' . $wid,
            ], 'id,worker_id,employer_id,worker_liked,employer_liked,is_match');
            if (!$like) { $data = ['matched' => false]; break; }

            $eid = (string)($like['employer_id'] ?? '');
            $callerIsWorker = (string)$authUid === $wid;
            $callerIsEmployer = (string)$authUid === $eid;
            if (!$callerIsWorker && !$callerIsEmployer) {
                jt_respond(['error' => 'Match access denied'], 403); exit;
            }

            // Старые строки могли пережить прежнюю доверчивую запись employer_id.
            // Перед SECURITY DEFINER RPC подтверждаем владельца по самой вакансии.
            $vac = sb_single('jm_vacancies', ['id' => 'eq.' . $vid], 'employer_id');
            if (!$vac || (string)($vac['employer_id'] ?? '') !== $eid) {
                jt_respond(['error' => 'Match vacancy mismatch'], 403); exit;
            }

            $rows = sb_rpc('jm_match_shift_atomic', [
                'p_vacancy_id' => $vid,
                'p_worker_id' => $wid,
                'p_chat_id' => uid(),
            ]);
            $result = $rows[0] ?? null;
            if (!is_array($result)) {
                throw new Exception('atomic shift match returned no result');
            }

            $matched = ($result['matched'] ?? false) === true;
            $cid = trim((string)($result['chat_id'] ?? ''));

            // Push/Telegram — побочный эффект после commit. Его сбой не должен
            // откатывать уже созданные мэтч и чат; повтор RPC тоже безопасен.
            if ($matched) {
                try {
                    jt_notify_match((string)$vid, (string)$wid, (string)$eid, $authUid);
                } catch (Throwable $e) { /* основной commit уже состоялся */ }
            }

            $data = ['matched' => $matched];
            if ($cid !== '') $data['chatId'] = $cid;
            break;
        }

'''
db = db[:start] + new_case + db[end:]
db_path.write_text(db, encoding='utf-8')

# Web and native must use the same authenticated server transaction. Direct
# Supabase writes cannot provide the transaction and are blocked by production RLS.
service_path = Path('services/db.ts')
service = service_path.read_text(encoding='utf-8')
service_start = service.find('export async function dbCheckAndCreateMatch(')
service_end = service.find('// ─── Permanent vacancies', service_start)
if service_start < 0 or service_end <= service_start:
    raise SystemExit('services/db.ts dbCheckAndCreateMatch markers not found')

new_service = '''export async function dbCheckAndCreateMatch(
  vacancyId: string,
  workerId: string
): Promise<{ matched: boolean; chatId?: string }> {
  const data = await proxy<{ matched?: boolean; chatId?: string | null }>(
    'dbCheckAndCreateMatch',
    [vacancyId, workerId],
  );
  return data?.chatId
    ? { matched: data.matched === true, chatId: data.chatId }
    : { matched: data?.matched === true };
}

'''
service = service[:service_start] + new_service + service[service_end:]
service_path.write_text(service, encoding='utf-8')

print('atomic shift match patch applied')
