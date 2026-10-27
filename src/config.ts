import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(10000),
  DISCORD_DEV_GUILD_ID: z.string().optional(),
});

export const config = schema.parse(process.env);
