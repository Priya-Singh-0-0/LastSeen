import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL:          z.string().min(1, 'DATABASE_URL is required'),
  ALPACA_API_KEY_ID:     z.string().min(1, 'ALPACA_API_KEY_ID is required'),
  ALPACA_API_SECRET_KEY: z.string().min(1, 'ALPACA_API_SECRET_KEY is required'),
  NODE_ENV:              z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL:             z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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
