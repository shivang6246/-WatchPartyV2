-- WatchParty schema, v1.
--
-- Lives in its own schema, "watchparty", not "public": Supabase publishes the
-- public schema through its auto-generated REST API, reachable with the
-- project's anon key. Nothing here should be reachable that way. Row level
-- security is also switched on for every table with no policies, so even if
-- the schema were exposed, the anon and authenticated roles would see nothing.
-- The backend connects as the database owner, which bypasses RLS.
--
-- Hot playback state (position, play flag, sequence) lives in Redis; the room
-- row holds a snapshot written every 30 seconds.

create table app_user (
    id            uuid primary key,
    email         varchar(320),
    password_hash varchar(100),
    display_name  varchar(80)  not null,
    provider      varchar(20)  not null default 'local',
    provider_id   varchar(255),
    avatar_url    varchar(2048),
    created_at    timestamptz  not null default now(),
    deleted_at    timestamptz
);
-- Case-insensitive, matching findByEmailIgnoreCase (upper(email) = upper(?)).
create unique index app_user_email_key on app_user (upper(email)) where email is not null;
create unique index app_user_provider_key on app_user (provider, provider_id) where provider_id is not null;

create table refresh_token (
    id         uuid primary key,
    user_id    uuid        not null references app_user (id) on delete cascade,
    token_hash varchar(64) not null unique,
    family_id  uuid        not null,
    issued_at  timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at    timestamptz,
    revoked_at timestamptz
);
create index refresh_token_family_idx on refresh_token (family_id);
-- Postgres has no TTL index; RetentionJob deletes expired rows by this.
create index refresh_token_expires_idx on refresh_token (expires_at);

create table room (
    id              uuid primary key,
    room_code       varchar(12)   not null,
    -- 128 bits of randomness: what the host's share link carries.
    invite_token    varchar(64)   not null unique,
    host_user_id    uuid          not null references app_user (id),
    title           varchar(200)  not null,
    platform        varchar(32)   not null,
    video_url       varchar(2048),
    video_ref       varchar(128),
    video_title     varchar(300),
    video_thumbnail varchar(2048),
    video_author    varchar(200),
    duration_ms     bigint,
    position_ms     bigint        not null default 0,
    playing         boolean       not null default false,
    speed           real          not null default 1,
    sequence_number bigint        not null default 0,
    anchor_ts       timestamptz   not null default now(),
    -- What is playing now; a queue advance names the item it replaces.
    current_item_id uuid,
    -- Upcoming videos only, in order. Read and written under a row lock.
    queue           jsonb         not null default '[]'::jsonb,
    locked          boolean       not null default false,
    active          boolean       not null default true,
    visibility      varchar(16)   not null default 'invite',
    max_members     integer       not null default 25,
    created_at      timestamptz   not null default now(),
    updated_at      timestamptz   not null default now(),
    expires_at      timestamptz   not null,
    closed_at       timestamptz
);
-- A code is unique only among open rooms, so closing a room frees its code.
create unique index room_code_active_key on room (room_code) where active;
create index room_host_idx on room (host_user_id);
create index room_active_expires_idx on room (active, expires_at);
create index room_closed_idx on room (closed_at) where not active;

create table room_member (
    id           uuid primary key,
    room_id      uuid        not null references room (id) on delete cascade,
    -- Exactly one of these is set: an account, or a guest pass.
    user_id      uuid        references app_user (id) on delete cascade,
    guest_id     uuid,
    display_name varchar(80) not null,
    avatar_url   varchar(2048),
    role         varchar(16) not null default 'member',
    joined_at    timestamptz not null default now(),
    left_at      timestamptz,
    removed      boolean     not null default false,
    muted        boolean     not null default false,
    constraint room_member_one_identity check (num_nonnulls(user_id, guest_id) = 1),
    -- NULLs never collide in a Postgres unique constraint, so a guest row and
    -- an account row cannot clash on the column they leave empty.
    constraint room_member_user_key unique (room_id, user_id),
    constraint room_member_guest_key unique (room_id, guest_id)
);
create index room_member_user_idx on room_member (user_id);

create table chat_message (
    id           uuid primary key,
    room_id      uuid        not null references room (id) on delete cascade,
    member_id    uuid        not null,
    -- Denormalised: a sent message keeps the name it was sent under.
    display_name varchar(80) not null,
    body         varchar(500) not null,
    created_at   timestamptz not null default now()
);
-- Chat pages backwards from a cursor.
create index chat_message_room_time_idx on chat_message (room_id, created_at desc);

create table playback_event (
    id              uuid primary key,
    room_id         uuid        not null references room (id) on delete cascade,
    member_id       uuid        not null,
    action          varchar(16) not null,
    position_ms     bigint      not null,
    playing         boolean     not null,
    speed           real        not null,
    sequence_number bigint      not null,
    server_ts       timestamptz not null
);
create index playback_event_room_seq_idx on playback_event (room_id, sequence_number desc);

alter table app_user       enable row level security;
alter table refresh_token  enable row level security;
alter table room           enable row level security;
alter table room_member    enable row level security;
alter table chat_message   enable row level security;
alter table playback_event enable row level security;
-- flyway_schema_history is left alone: Flyway holds a lock on it while this
-- script runs, so altering it here deadlocks. It sits in the same unexposed
-- schema and records only which migrations ran.
