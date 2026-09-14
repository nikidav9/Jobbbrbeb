create index if not exists jm_likes_outcome_at_idx
    on jm_likes (outcome_at)
    where outcome is not null;

create index if not exists jm_likes_application_cohort_idx
    on jm_likes (created_at)
    where worker_liked = true;
