import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().optional().default(''),
  OPENROUTER_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default('nvidia/nemotron-3-ultra-550b-a55b:free'),
  DATABASE_URL: z.string().optional().default(''),
  PORT: z.coerce.number().int().positive().default(10000),
  DISCORD_DEV_GUILD_ID: z.string().optional(),
});

// Bot-Hosting.net exposes the assigned port as SERVER_PORT. Render and
// conventional Node hosts typically use PORT. Normalize both into PORT so the
// same runtime works everywhere without host-specific source branches.
const normalizedEnv = {
  ...process.env,
  PORT: process.env.SERVER_PORT ?? process.env.PORT,
};

export const config = schema.parse(normalizedEnv);

export const missingRequiredConfig = [
  ['DISCORD_BOT_TOKEN', config.DISCORD_BOT_TOKEN],
  ['OPENROUTER_API_KEY', config.OPENROUTER_API_KEY],
  ['DATABASE_URL', config.DATABASE_URL],
]
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const runtimeConfigured = missingRequiredConfig.length === 0;
