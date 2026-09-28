-- Friends: two accounts that agreed to see what the other is watching, and
-- to join them in one tap.
--
-- One row per pair, whichever way round it was asked: user_low is the smaller
-- id, user_high the larger (ordered as Postgres orders uuids, which is the
-- order of their canonical text; see FriendService.pair). A request from
-- either side therefore lands on the same unique key, which is what turns two
-- people adding each other at the same moment into one friendship rather than
-- two crossing requests.
create table friendship (
    id           uuid primary key,
    user_low     uuid        not null references app_user (id) on delete cascade,
    user_high    uuid        not null references app_user (id) on delete cascade,
    -- Who asked. The other one accepts; a pending row is a request.
    requested_by uuid        not null references app_user (id) on delete cascade,
    status       varchar(10) not null check (status in ('pending', 'accepted')),
    created_at   timestamptz not null default now(),
    accepted_at  timestamptz,
    constraint friendship_pair_key unique (user_low, user_high),
    constraint friendship_ordered check (user_low < user_high)
);
-- The unique pair index already serves lookups by user_low.
create index friendship_high_idx on friendship (user_high);

alter table friendship enable row level security;

-- Whether friends may see which room you are in (on unless turned off), and
-- the code in your personal "add me as a friend" link, made on first use.
alter table app_user add column share_activity boolean not null default true;
alter table app_user add column friend_code varchar(16);
create unique index app_user_friend_code_key on app_user (friend_code) where friend_code is not null;
