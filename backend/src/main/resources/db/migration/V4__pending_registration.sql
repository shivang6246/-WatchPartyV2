-- Sign-ups waiting for their email to be confirmed.
--
-- A local account is not created until the six-digit code (or the link from
-- the same email) comes back, so app_user never holds an address nobody has
-- proven. Everything register needs to create the account later is kept
-- here: the password is already hashed, exactly as app_user would store it.
--
-- Only applies where verification is enforced (SMTP configured, or
-- app.verification.required=true); elsewhere register creates the account
-- straight away, as before.

create table pending_registration (
    id            uuid primary key,
    email         varchar(320) not null,
    password_hash varchar(100) not null,
    display_name  varchar(80)  not null,
    -- Both hashed, like email_verification: a dump yields nothing usable.
    token_hash    varchar(64)  not null unique,
    code_hash     varchar(64)  not null,
    -- Wrong codes tried; the row stops accepting codes after a handful.
    attempts      integer      not null default 0,
    -- A guest who signs up mid-room keeps their seat once the account exists.
    guest_id      uuid,
    guest_room_id uuid,
    created_at    timestamptz  not null default now(),
    expires_at    timestamptz  not null,
    used_at       timestamptz
);
-- One live sign-up per address: registering again replaces the earlier one.
create unique index pending_registration_email_key on pending_registration (upper(email));
-- Spent and expired rows are deleted by RetentionJob.
create index pending_registration_expires_idx on pending_registration (expires_at);

alter table pending_registration enable row level security;
