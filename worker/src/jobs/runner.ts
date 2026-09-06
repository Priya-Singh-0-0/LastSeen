import type { Pool } from '../db.js';
import type { JobHandler } from './handlers.js';
import { drainOne } from './queue.js';

/**
 * The job runner loop.
 *
 * `drainOne` (T13) — claim under `FOR UPDATE SKIP LOCKED`, lease, retry, idempotency key — has
 * existed and been tested since T13, but no process ever called it, so every job the API
 * enqueued sat in the table forever. That is why a newly added instrument waited out the full
 * `POLL_INTERVAL_MS` instead of being ingested on demand.
 *
 * The loop drains continuously while work exists and idles otherwise, so a job enqueued by a
 * user action is picked up within `idleMs` rather than within the poll interval.
 */

export interface JobRunnerHandle {
  stop: () => void;
}

export function startJobRunner(
  pool: Pool,
  handlers: Map<string, JobHandler>,
  idleMs: number,
): JobRunnerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      // Drain greedily: keep going while there is work, so a burst is not spread across
      // one-job-per-interval ticks.
      let drained = 0;
      while (!stopped && (await drainOne(pool, handlers))) {
        drained += 1;
        // Yield periodically so a long queue cannot starve shutdown.
        if (drained % 25 === 0) break;
      }
    } catch (err) {
      // A failure here is the loop itself misbehaving, not a job failing — drainOne already
      // handles per-job failure and retry. Log and keep looping; never let the runner die.
      console.error(
        JSON.stringify({ event: 'job_runner_tick_failed', error: (err as Error).message }),
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), idleMs);
      }
    }
  }

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
