-- Email verification: prove the address belongs to whoever signed up.
--
-- Hosting a room needs a verified address; joining as a guest never does, so
-- the invite-and-watch path is untouched. Google accounts arrive verified,
-- because Google has already checked the address.

alter table app_user add column email_verified_at timestamptz;

-- Accounts that existed before verification shipped keep their access.
update app_user set email_verified_at = created_at where email is not null;

create table email_verification (
    id         uuid primary key,
    user_id    uuid        not null references app_user (id) on delete cascade,
    -- Only the hash is stored, exactly like refresh_token: a database dump
    -- yields no usable links.
    token_hash varchar(64) not null unique,
    -- The address the link was sent to, so a later email change invalidates it.
    email      varchar(320) not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at    timestamptz
);
create index email_verification_user_idx on email_verification (user_id);
-- Spent and expired rows are deleted by RetentionJob.
create index email_verification_expires_idx on email_verification (expires_at);

alter table email_verification enable row level security;
