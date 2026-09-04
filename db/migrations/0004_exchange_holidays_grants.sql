-- ============================================================
-- Migration 0004_exchange_holidays_grants.sql
-- 0003_exchange_calendar.sql created exchange_holidays before 0002_roles.sql's
-- roles existed to grant against it, so no role could read it. This is a plain
-- reference table (not user- or market-observation data), read by both
-- processes' session-arithmetic (T18 — one calendar implementation, shared).
-- ============================================================

GRANT SELECT ON exchange_holidays TO stockwatch_api;
GRANT SELECT ON exchange_holidays TO stockwatch_worker;
