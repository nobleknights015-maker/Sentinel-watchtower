import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().optional().default(''),
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
  ['OPENAI_API_KEY', config.OPENAI_API_KEY],
  ['OPENAI_MODEL', config.OPENAI_MODEL],
  ['DATABASE_URL', config.DATABASE_URL],
]
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const runtimeConfigured = missingRequiredConfig.length === 0;
