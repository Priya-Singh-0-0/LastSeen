import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL:     z.string().min(1, 'DATABASE_URL is required'),
  ACK_TOKEN_SECRET: z.string().min(32, 'ACK_TOKEN_SECRET must be at least 32 characters'),
  SESSION_SECRET:   z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  PORT:             z.coerce.number().int().positive().default(3000),
  NODE_ENV:         z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL:        z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const msgs = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`API configuration error:\n${msgs}`);
  }
  return result.data;
}
