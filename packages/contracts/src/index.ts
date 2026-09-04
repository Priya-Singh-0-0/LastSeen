/**
 * @stockwatch/contracts — shared between api/ and worker/
 *
 * Contains ONLY:
 *   - canonical domain enums (mirrors Postgres enum types)
 *   - Decimal type and wire helpers
 *   - UTC-branded timestamp contracts
 *   - provider-neutral domain DTOs
 *
 * Contains NO financial logic, signal predicates, diff arithmetic, or ranking.
 */

export * from './decimal.js';
export * from './time.js';
export * from './enums.js';
export * from './dto.js';
