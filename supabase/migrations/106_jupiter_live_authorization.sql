-- Old applications stay dry-run. Only a swipe after the candidate opts in
-- carries authorization to submit to the employer.
alter table jm_users
    add column if not exists jupiter_live_enabled_at timestamptz;

alter table jm_jupiter_applications
    add column if not exists submission_authorized_at timestamptz;

