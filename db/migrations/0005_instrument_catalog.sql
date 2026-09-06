-- ============================================================
-- Migration 0005_instrument_catalog.sql — provider asset catalog (symbol search)
--
-- Reference data, not market observation: the tradable-universe list the worker
-- syncs from the provider's asset master, so the API can serve symbol/company
-- search from its own store. This is what makes search possible without the API
-- ever calling a provider on a user-facing read (INV-2, CLAUDE.md).
--
-- Deliberately NOT joined to `instruments`: an instrument row only exists once
-- some user has added the symbol, whereas the whole point of search is finding
-- symbols nobody here follows yet. `symbol` is the natural key; a catalog row
-- carries no instrument id and no price.
-- ============================================================

CREATE TABLE instrument_catalog (
  symbol      TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  exchange    TEXT,
  asset_class TEXT,
  -- Provider's own lifecycle value ('active'/'inactive'), stored verbatim rather
  -- than mapped onto an enum: it is a provider fact, not a domain concept.
  status      TEXT        NOT NULL,
  tradable    BOOLEAN     NOT NULL DEFAULT TRUE,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prefix search on symbol and on lower(name). text_pattern_ops is what makes
-- `LIKE 'q%'` index-scannable regardless of the database's collation.
CREATE INDEX instrument_catalog_symbol_prefix_idx
  ON instrument_catalog (symbol text_pattern_ops);
CREATE INDEX instrument_catalog_name_prefix_idx
  ON instrument_catalog (lower(name) text_pattern_ops);

-- Worker owns the write side (it is the only process holding provider credentials);
-- the API reads it. Same split as every other market-owned table (INV-2, INV-3).
GRANT SELECT ON instrument_catalog TO stockwatch_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON instrument_catalog TO stockwatch_worker;
