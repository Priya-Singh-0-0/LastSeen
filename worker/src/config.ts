import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL:          z.string().min(1, 'DATABASE_URL is required'),
  ALPACA_API_KEY_ID:     z.string().min(1, 'ALPACA_API_KEY_ID is required'),
  ALPACA_API_SECRET_KEY: z.string().min(1, 'ALPACA_API_SECRET_KEY is required'),
  NODE_ENV:              z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL:             z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Paper accounts get iex by default (T37 capability verification); override for a live sip/otc feed.
  ALPACA_FEED:           z.enum(['iex', 'sip', 'delayed_sip', 'otc']).default('iex'),
  // Snapshot poll interval, in milliseconds. Defect 1: defaults to 10 minutes.
  POLL_INTERVAL_MS:      z.coerce.number().int().positive().default(10 * 60 * 1000),
  // Popular-stocks (most-actives) sync interval, in milliseconds. Defect 8: a screener
  // ranking doesn't meaningfully move every 10 minutes the way a price does — defaults
  // to 6 hours (4 syncs/day).
  POPULAR_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  // Idle delay between job-queue drains. Short by design: this is the latency a user waits
  // after starring or viewing a stock before its data is ingested, so it is measured in
  // seconds, not minutes like the snapshot poll.
  JOB_POLL_INTERVAL_MS:  z.coerce.number().int().positive().default(2000),
  // Model renderer (architecture §F.7). Optional by design: absent key ⇒ the
  // ModelRenderer is never constructed and every brief is the deterministic
  // template. The app must run, correctly, with no model configured at all.
  GEMINI_API_KEY:        z.string().min(1).optional(),
  GEMINI_MODEL:          z.string().min(1).default('gemini-3.8-flash'),
  // §F.7 specifies ~1.5s because it assumed a synchronous render on the read
  // path. Briefs are generated in a background job and the API serves the
  // template on a cache miss, so no user ever waits on this timeout — it only
  // needs to bound a stuck job.
  GEMINI_TIMEOUT_MS:     z.coerce.number().int().positive().default(10_000),
});

export type WorkerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const msgs = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Worker configuration error:\n${msgs}`);
  }
  return result.data;
}
