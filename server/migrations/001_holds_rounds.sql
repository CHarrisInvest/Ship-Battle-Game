-- Every document column is `json`, not `jsonb`: jsonb reorders an object's keys, and a loadout
-- fed to the engine, or a record compared byte for byte, has to come back exactly as it went in.

-- A captain's hold: one record, the one `holdrules.js` reads whole, and the version that moves on
-- every write so a stale tab is refused rather than painting over a newer record.
create table holds (
  user_id text primary key references "user"(id) on delete cascade,
  data json not null,
  version integer not null,
  updated_at timestamptz not null
);

-- A voyage: started by the server with its own seed and the loadout off its own hold, fed its
-- input log in pieces, and finished once, by a replay, or abandoned when the captain starts another.
create table rounds (
  id text primary key,
  user_id text not null references "user"(id) on delete cascade,
  mode text not null,
  seed bigint not null,
  loadout json not null,
  engine text not null,
  started_at timestamptz not null,
  next_tick integer not null default 0,
  entry_count integer not null default 0,
  failed_finishes integer not null default 0,
  abandoned_at timestamptz,
  finished_at timestamptz,
  ticks integer,
  result json,
  banked integer
);
create index rounds_user on rounds (user_id, started_at);

-- A round's input log, a row per piece as it arrives, so a long round is appended to rather than
-- rewritten whole every few seconds.
create table round_inputs (
  round_id text not null references rounds(id) on delete cascade,
  seq integer not null,
  entries json not null,
  primary key (round_id, seq)
);
