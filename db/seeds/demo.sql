-- ============================================================
-- db/seeds/demo.sql — T38 demo seed
--
-- Reproduces a full demo state from an empty (post-migration) database in one command:
--   psql "$TEST_DATABASE_URL" -f db/seeds/demo.sql
-- (superuser role — it writes `instrument_tracking`/`instrument_catalog` and enqueues jobs.)
--
-- Seeds ~33 liquid tickers as *identity and ingestion demand only* — no market facts. The
-- demo user's watchlist starts empty (defect 8 — starring is the only way in); the tickers
-- are ACTIVE-tracked and each gets a `backfill_bars` + `ingest_instrument` job, so the worker
-- fills real history and real prices from the provider within seconds of it running.
--
-- This file deliberately fabricates nothing. An earlier revision generated 400 sine-wave bars,
-- market state, checkpoints, change records and signals per ticker (all tagged source =
-- 'seeded'). The result was an app whose every chart was the same wave at a different scale,
-- sitting next to a real price it had no relationship to. Prices, bars, events and change
-- records now have exactly one origin: the worker's ingestion pipeline.
--
-- Assumes an empty database (a fresh run of db/migrations/*). Not idempotent: re-running
-- against an already-seeded database will fail on the unique demo user email.
-- ============================================================

BEGIN;

DO $$
DECLARE
  demo_user_id   BIGINT;
  demo_wl_id     BIGINT;
  rec            RECORD;
  inst_id        BIGINT;
BEGIN
  -- Demo user (password: "demo12345") and their single watchlist.
  INSERT INTO users (email, password_hash, timezone)
  VALUES (
    'demo@stockwatch.dev',
    '$argon2id$v=19$m=65536,t=3,p=4$SDp1oHx5OgPvjBNJQdO56Q$cbPDAP89FG3dWKrT979fDmJvY7kC3CCYvFKm/bvAZ+A',
    'America/New_York'
  )
  RETURNING id INTO demo_user_id;

  INSERT INTO watchlists (user_id, name)
  VALUES (demo_user_id, 'Demo Watchlist')
  RETURNING id INTO demo_wl_id;

  FOR rec IN
    SELECT * FROM (VALUES
      -- ticker,   base_price, category
      ('TSLA',   240.00::numeric, 'signal_move'),
      ('AAPL',    46.00::numeric, 'signal_split'),
      ('GME',     22.00::numeric, 'signal_volume'),
      ('MSFT',   410.00::numeric, 'quiet'),
      ('GOOGL',  165.00::numeric, 'quiet'),
      ('AMZN',   178.00::numeric, 'quiet'),
      ('NVDA',   118.00::numeric, 'quiet'),
      ('META',   500.00::numeric, 'quiet'),
      ('JPM',    195.00::numeric, 'quiet'),
      ('V',      270.00::numeric, 'quiet'),
      ('JNJ',    155.00::numeric, 'quiet'),
      ('WMT',     68.00::numeric, 'quiet'),
      ('PG',     165.00::numeric, 'quiet'),
      ('XOM',    115.00::numeric, 'quiet'),
      ('HD',     345.00::numeric, 'quiet'),
      ('MA',     460.00::numeric, 'quiet'),
      ('DIS',     95.00::numeric, 'quiet'),
      ('BAC',     38.00::numeric, 'quiet'),
      ('KO',      62.00::numeric, 'quiet'),
      ('PFE',     27.00::numeric, 'quiet'),
      ('CSCO',    48.00::numeric, 'quiet'),
      ('PEP',    170.00::numeric, 'quiet'),
      ('ABBV',   165.00::numeric, 'quiet'),
      ('CRM',    260.00::numeric, 'quiet'),
      ('ADBE',   540.00::numeric, 'quiet'),
      ('NFLX',   610.00::numeric, 'quiet'),
      ('INTC',    35.00::numeric, 'quiet'),
      ('AMD',    115.00::numeric, 'quiet'),
      ('ORCL',   115.00::numeric, 'quiet'),
      ('COST',   730.00::numeric, 'quiet'),
      ('MCD',    290.00::numeric, 'quiet'),
      ('NKE',     95.00::numeric, 'quiet'),
      ('T',       17.00::numeric, 'quiet')
    ) AS t(ticker, base_price, category)
  LOOP
    INSERT INTO instruments (corporate_action_version, last_published_seq, resolution_status)
    VALUES (0, 0, 'RESOLVED')
    RETURNING id INTO inst_id;

    INSERT INTO instrument_symbols (instrument_id, symbol, exchange, valid_from)
    VALUES (inst_id, rec.ticker, 'NASDAQ', NOW());

    -- ACTIVE so the worker's scheduler picks these up, but `last_ingested_at` stays NULL and
    -- follower_count 0: nothing has been ingested and nobody has starred anything yet. Writing
    -- NOW() here previously claimed an ingestion that never happened.
    INSERT INTO instrument_tracking (instrument_id, tracking_state, follower_count, priority, tracking_source)
    VALUES (inst_id, 'ACTIVE', 0, 0, 'VIEWED');

    -- Catalog entry so symbol search finds these tickers without a provider sync.
    -- `name` is the ticker itself, deliberately: a company's registered name is a fact
    -- this seed has no source for, and inventing one would be the same class of mistake
    -- as inventing a price. Run `npm run sync:catalog -w worker` for real names.
    INSERT INTO instrument_catalog (symbol, name, exchange, asset_class, status, tradable)
    VALUES (rec.ticker, rec.ticker, 'NASDAQ', 'us_equity', 'active', TRUE)
    ON CONFLICT (symbol) DO NOTHING;

    -- Real history and real prices are the worker's job, not this file's. Earlier revisions
    -- fabricated 400 sine-wave bars, a market-state row, checkpoints and change records per
    -- ticker, all tagged source = 'seeded'. That produced an app where every chart was the same
    -- wave and the price beside it came from somewhere else entirely. The seed now creates only
    -- identity and ingestion demand; `backfill_bars` fills the history and `ingest_instrument`
    -- fills the price, both from the provider.
    INSERT INTO jobs (job_type, payload, idempotency_key, scheduled_at)
    VALUES
      ('backfill_bars',
       jsonb_build_object('instrumentId', inst_id::text, 'symbol', rec.ticker),
       'backfill:' || inst_id, NOW()),
      ('ingest_instrument',
       jsonb_build_object('instrumentId', inst_id::text, 'symbol', rec.ticker),
       'ingest:seed:' || inst_id, NOW())
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  -- Defect 8: the empty-state suggestion board. In production this table is only ever
  -- written by the worker's screener sync (`syncPopularStocks`); this seed stands in for
  -- that one sync the same way the rest of this file stands in for ingestion history.
  -- Ranked by seed order (arbitrary but deterministic) rather than a real volume figure —
  -- trade_count/volume are round placeholders, never rendered by the API (§ `popular.ts`
  -- only projects symbol/name/exchange), so there is no invented financial fact here.
  INSERT INTO popular_stocks (symbol, rank, trade_count, volume)
  SELECT symbol, row_number() OVER (ORDER BY symbol), 0, 0
  FROM instrument_catalog
  ORDER BY symbol;
END $$;

COMMIT;
