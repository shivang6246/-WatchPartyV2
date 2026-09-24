-- A six-digit code beside the link.
--
-- The link is convenient on a laptop; the code is what works on a phone,
-- where mail often opens in a different browser that is not signed in. Both
-- point at the same row, so using either one retires the other.
--
-- Six digits is a small space, so guessing is held off by the attempt counter
-- here (the row dies after a handful of wrong tries) as well as the per-IP
-- and per-account rate limits.

alter table email_verification add column code_hash varchar(64);
alter table email_verification add column attempts integer not null default 0;

-- Rows issued before this migration have no code; their link still works.
