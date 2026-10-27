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

export const config = schema.parse(process.env);

export const missingRequiredConfig = [
  ['DISCORD_BOT_TOKEN', config.DISCORD_BOT_TOKEN],
  ['OPENAI_API_KEY', config.OPENAI_API_KEY],
  ['OPENAI_MODEL', config.OPENAI_MODEL],
  ['DATABASE_URL', config.DATABASE_URL],
]
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const runtimeConfigured = missingRequiredConfig.length === 0;
