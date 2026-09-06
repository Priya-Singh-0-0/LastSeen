-- ============================================================
-- Migration 0006_popular_stocks.sql — provider most-actives list (defect 8)
--
-- Reference data, same shape as instrument_catalog: the worker fetches Alpaca's
-- screener (`GET /v1beta1/screener/stocks/most-actives`) and replaces this table's
-- contents wholesale, so "popular" is a stored provider fact, not a client-side
-- guess. No instrument id, no price — a symbol here need not be followed by
-- anyone yet, mirroring instrument_catalog's own "not joined to instruments".
--
-- Small and fully replaced each sync (top ~20-50 rows), so unlike
-- instrument_catalog there is no incremental upsert/deactivate step: sync just
-- truncates and re-inserts inside one transaction.
-- ============================================================

CREATE TABLE popular_stocks (
  symbol      TEXT        PRIMARY KEY,
  rank        INTEGER     NOT NULL,
  trade_count BIGINT      NOT NULL,
  volume      BIGINT      NOT NULL,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX popular_stocks_rank_idx ON popular_stocks (rank);

-- Worker owns the write side; the API reads it. Same split as instrument_catalog.
GRANT SELECT ON popular_stocks TO stockwatch_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON popular_stocks TO stockwatch_worker;
