-- ============================================================
-- db/seeds/demo.sql — T38 demo seed
--
-- Reproduces a full demo state from an empty (post-migration) database in one command:
--   psql "$TEST_DATABASE_URL" -f db/seeds/demo.sql
-- (superuser role — this writes worker-owned tables directly, as a stand-in for a real
-- ingestion history; it does not go through the worker's ingestion pipeline.)
--
-- Seeds ~33 liquid tickers with 400 sessions of daily bars each, a demo user with a
-- watchlist following all of them and a checkpoint baselined two trading sessions back,
-- and three "interesting" instruments so the demo path in architecture §1 is visible
-- immediately after seeding:
--   TSLA — a large volatility-adjusted move + an earnings event on the latest session
--   GME  — an abnormal-volume episode over the last few sessions
--   AAPL — a 4-for-1 split whose checkpoint baseline predates it (read-time adjustment,
--          architecture §I / INV-12)
--
-- All synthetic rows carry source = 'seeded' (never presented as live provider data —
-- see README.md's "Alpaca capability verification" section for why earnings/split events
-- are seeded rather than fetched for this demo universe).
--
-- Assumes an empty database (a fresh run of db/migrations/*). Not idempotent: re-running
-- against an already-seeded database will fail on the unique demo user email.
-- ============================================================

BEGIN;

DO $$
DECLARE
  demo_user_id   BIGINT;
  demo_wl_id     BIGINT;
  latest_session DATE;
  n_sessions     CONSTANT INT := 400;
  rec            RECORD;
  inst_id        BIGINT;
  latest_bar     RECORD;
  prev_bar       RECORD;
  baseline_bar   RECORD;
  checkpoint_baseline_price NUMERIC(18,6);
  change_record_id BIGINT;
BEGIN
  -- Most recent trading day at or before today (roll back over a weekend).
  latest_session := CURRENT_DATE;
  WHILE EXTRACT(DOW FROM latest_session) IN (0, 6) LOOP
    latest_session := latest_session - 1;
  END LOOP;

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
    VALUES (CASE WHEN rec.category = 'signal_split' THEN 1 ELSE 0 END, 0, 'RESOLVED')
    RETURNING id INTO inst_id;

    INSERT INTO instrument_symbols (instrument_id, symbol, exchange, valid_from)
    VALUES (inst_id, rec.ticker, 'NASDAQ', NOW());

    INSERT INTO instrument_tracking (instrument_id, tracking_state, follower_count, priority, last_ingested_at)
    VALUES (inst_id, 'ACTIVE', 1, 1, NOW());

    -- 400 daily bars, set-based: a gentle deterministic sine-wave walk per ticker, with
    -- the "interesting" tickers getting a deliberate deviation on/near the latest session.
    INSERT INTO instrument_bars (instrument_id, session_date, open, high, low, close, volume, source)
    SELECT
      inst_id,
      s.session_date,
      s.close_price * (1 - 0.003 * sin(s.rn * 0.11)),
      s.close_price * 1.006,
      s.close_price * 0.994,
      s.close_price,
      s.session_volume,
      'seeded'
    FROM (
      SELECT
        session_date,
        row_number() OVER (ORDER BY session_date) AS rn,
        rec.base_price * (1 + 0.06 * sin(row_number() OVER (ORDER BY session_date) * 0.07 + length(rec.ticker)))
          * (CASE WHEN rec.category = 'signal_move' AND session_date = latest_session THEN 1.18 ELSE 1 END)
          AS close_price,
        (400000 + 250000 * sin(row_number() OVER (ORDER BY session_date) * 0.05))::bigint
          * (CASE WHEN rec.category = 'signal_volume' AND session_date >= latest_session - 3 THEN 3 ELSE 1 END)
          AS session_volume
      FROM (
        SELECT d::date AS session_date
        FROM generate_series(latest_session - 640, latest_session, interval '1 day') AS d
        WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
        ORDER BY d DESC
        LIMIT n_sessions
      ) sessions
    ) s
    ON CONFLICT (instrument_id, session_date) DO NOTHING;

    SELECT session_date, close INTO latest_bar
      FROM instrument_bars WHERE instrument_id = inst_id ORDER BY session_date DESC LIMIT 1;
    SELECT session_date, close INTO prev_bar
      FROM instrument_bars WHERE instrument_id = inst_id ORDER BY session_date DESC OFFSET 1 LIMIT 1;
    SELECT session_date, close INTO baseline_bar
      FROM instrument_bars WHERE instrument_id = inst_id ORDER BY session_date DESC OFFSET 2 LIMIT 1;

    INSERT INTO instrument_market_state (
      instrument_id, price, currency, market_timestamp, last_observed_market_ts,
      ingested_at, source, market_status, value_kind, data_freshness,
      session_date, open, high, low, volume, prev_close, precision_hint
    )
    SELECT inst_id, latest_bar.close, 'USD',
           latest_bar.session_date::timestamptz + interval '20 hours',
           latest_bar.session_date::timestamptz + interval '20 hours',
           NOW(), 'seeded', 'CLOSED', 'SESSION_CLOSE', 'FRESH',
           latest_bar.session_date, b.open, b.high, b.low, b.volume, prev_bar.close, 2
    FROM instrument_bars b
    WHERE b.instrument_id = inst_id AND b.session_date = latest_bar.session_date;

    INSERT INTO watchlist_items (watchlist_id, instrument_id) VALUES (demo_wl_id, inst_id);

    -- The 4-for-1 split ticker's checkpoint remembers the pre-split price the user
    -- actually saw (4x the post-split-scaled bar history) at corporate_action_version 0,
    -- before the seeded split below bumps the instrument to version 1 — this is exactly
    -- the read-time adjustment scenario in architecture §I / INV-12, T34.
    checkpoint_baseline_price := CASE
      WHEN rec.category = 'signal_split' THEN baseline_bar.close * 4
      ELSE baseline_bar.close
    END;

    INSERT INTO user_instrument_checkpoints (
      user_id, instrument_id, seen_through_publication_seq,
      baseline_price, baseline_market_timestamp, baseline_corporate_action_version
    )
    VALUES (
      demo_user_id, inst_id, 0,
      checkpoint_baseline_price, baseline_bar.session_date::timestamptz + interval '20 hours', 0
    );

    IF rec.category = 'signal_move' THEN
      INSERT INTO market_events (instrument_id, event_type, event_ts, fiscal_period, source)
      VALUES (inst_id, 'EARNINGS', latest_bar.session_date::timestamptz + interval '13 hours', 'Q_DEMO', 'seeded');

      UPDATE instruments SET last_published_seq = 1 WHERE id = inst_id;
      INSERT INTO change_records (instrument_id, published_seq, published_at, score, band, latest_at, shared_explanation, renderer_version)
      VALUES (
        inst_id, 1, NOW(), 0.90, 'URGENT',
        latest_bar.session_date::timestamptz + interval '20 hours',
        'A large price move accompanied an earnings release.', 1
      )
      RETURNING id INTO change_record_id;

      INSERT INTO instrument_signals (instrument_id, change_record_id, signal_type, detector_version, dedupe_key, evidence, market_timestamp)
      VALUES
        (inst_id, change_record_id, 'LARGE_ABSOLUTE_MOVE', 1, 'LARGE_ABSOLUTE_MOVE:' || latest_bar.session_date,
         jsonb_build_object('percentageChange', '0.18', 'threshold', '0.05'), latest_bar.session_date::timestamptz + interval '20 hours'),
        (inst_id, change_record_id, 'EARNINGS_RELEASED', 1, 'EARNINGS_RELEASED:' || latest_bar.session_date,
         jsonb_build_object('fiscalPeriod', 'Q_DEMO', 'source', 'seeded'), latest_bar.session_date::timestamptz + interval '13 hours');

    ELSIF rec.category = 'signal_split' THEN
      INSERT INTO corporate_actions (instrument_id, action_type, effective_date, adjustment_factor, is_supported, version_seq, source)
      VALUES (inst_id, 'SPLIT', latest_session - 60, 0.25, TRUE, 1, 'seeded');

      UPDATE instruments SET last_published_seq = 1 WHERE id = inst_id;
      INSERT INTO change_records (instrument_id, published_seq, published_at, score, band, latest_at, shared_explanation, renderer_version)
      VALUES (
        inst_id, 1, NOW(), 0.60, 'NOTABLE',
        (latest_session - 60)::timestamptz + interval '20 hours',
        'A 4-for-1 stock split took effect.', 1
      )
      RETURNING id INTO change_record_id;

      -- dedupe_key format mirrors worker/src/signals/dedupe.ts's corporateActionDedupeKey
      -- exactly (`${signalType}:${actionType}:${effectiveDate}:${factor}`) — see
      -- worker/test/fixtures/demo/corporate-action.json and its consistency test.
      INSERT INTO instrument_signals (instrument_id, change_record_id, signal_type, detector_version, dedupe_key, evidence, market_timestamp)
      VALUES (inst_id, change_record_id, 'CORPORATE_ACTION_APPLIED', 1,
              'CORPORATE_ACTION_APPLIED:SPLIT:' || (latest_session - 60)::text || ':0.25',
              jsonb_build_object('actionType', 'SPLIT', 'factor', '0.25', 'isSupported', 'true'),
              (latest_session - 60)::timestamptz + interval '20 hours');

    ELSIF rec.category = 'signal_volume' THEN
      UPDATE instruments SET last_published_seq = 1 WHERE id = inst_id;
      INSERT INTO change_records (instrument_id, published_seq, published_at, score, band, latest_at, shared_explanation, renderer_version)
      VALUES (
        inst_id, 1, NOW(), 0.45, 'MINOR',
        latest_bar.session_date::timestamptz + interval '20 hours',
        'Trading volume rose well above its recent median.', 1
      )
      RETURNING id INTO change_record_id;

      INSERT INTO instrument_signals (instrument_id, change_record_id, signal_type, detector_version, dedupe_key, evidence, market_timestamp)
      VALUES (inst_id, change_record_id, 'ABNORMAL_VOLUME', 1, 'ABNORMAL_VOLUME:' || latest_bar.session_date,
              jsonb_build_object('volumeRatio', '3.0', 'threshold', '2.5'), latest_bar.session_date::timestamptz + interval '20 hours');
    END IF;
  END LOOP;
END $$;

COMMIT;
