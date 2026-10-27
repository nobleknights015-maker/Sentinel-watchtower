import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const pool = new Pool({ connectionString: config.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      watched_channels TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS privacy_preferences (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      opted_out BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS message_memory (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_memory_channel_time
      ON message_memory(guild_id, channel_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS explicit_memory (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_explicit_memory_user
      ON explicit_memory(guild_id, user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS learned_memory (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      memory_key TEXT NOT NULL,
      note TEXT NOT NULL,
      source_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(guild_id, user_id, category, memory_key)
    );
    CREATE INDEX IF NOT EXISTS idx_learned_memory_user
      ON learned_memory(guild_id, user_id, updated_at DESC);
  `);
}

export async function isOptedOut(guildId: string, userId: string) {
  const r = await pool.query('SELECT opted_out FROM privacy_preferences WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
  return r.rows[0]?.opted_out === true;
}

export async function setOptOut(guildId: string, userId: string, optedOut: boolean) {
  await pool.query(`
    INSERT INTO privacy_preferences(guild_id,user_id,opted_out,updated_at)
    VALUES($1,$2,$3,NOW())
    ON CONFLICT(guild_id,user_id) DO UPDATE SET opted_out=EXCLUDED.opted_out, updated_at=NOW()
  `, [guildId, userId, optedOut]);
}

export async function deleteUserData(guildId: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const messages = await client.query('DELETE FROM message_memory WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
    const memories = await client.query('DELETE FROM explicit_memory WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
    const learned = await client.query('DELETE FROM learned_memory WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
    await client.query('COMMIT');
    return { messages: messages.rowCount ?? 0, memories: memories.rowCount ?? 0, learned: learned.rowCount ?? 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getWatchedChannels(guildId: string): Promise<string[]> {
  const r = await pool.query('SELECT watched_channels FROM guild_settings WHERE guild_id=$1', [guildId]);
  return r.rows[0]?.watched_channels ?? [];
}

export async function setChannelWatched(guildId: string, channelId: string, watched: boolean) {
  const existing = await getWatchedChannels(guildId);
  const next = watched ? [...new Set([...existing, channelId])] : existing.filter(x => x !== channelId);
  await pool.query(`
    INSERT INTO guild_settings(guild_id,watched_channels,updated_at)
    VALUES($1,$2,NOW())
    ON CONFLICT(guild_id) DO UPDATE SET watched_channels=EXCLUDED.watched_channels, updated_at=NOW()
  `, [guildId, next]);
  return next;
}

export async function storeMessage(input: {
  guildId: string; channelId: string; messageId: string; userId: string; displayName: string; content: string; createdAt: Date;
}) {
  await pool.query(`
    INSERT INTO message_memory(guild_id,channel_id,message_id,user_id,display_name,content,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(message_id) DO NOTHING
  `, [input.guildId, input.channelId, input.messageId, input.userId, input.displayName, input.content.slice(0, 4000), input.createdAt]);
  await pool.query(`
    DELETE FROM message_memory WHERE id IN (
      SELECT id FROM message_memory
      WHERE guild_id=$1 AND channel_id=$2
      ORDER BY created_at DESC OFFSET 200
    )
  `, [input.guildId, input.channelId]);
}

export async function recentContext(guildId: string, channelId: string, limit = 24) {
  const r = await pool.query(`
    SELECT display_name, content, created_at FROM message_memory
    WHERE guild_id=$1 AND channel_id=$2
    ORDER BY created_at DESC LIMIT $3
  `, [guildId, channelId, limit]);
  return r.rows.reverse() as Array<{display_name:string;content:string;created_at:Date}>;
}

export async function addExplicitMemory(guildId: string, userId: string, note: string) {
  await pool.query('INSERT INTO explicit_memory(guild_id,user_id,note) VALUES($1,$2,$3)', [guildId, userId, note.slice(0, 1000)]);
}

export async function explicitMemories(guildId: string, userId: string, limit = 12) {
  const r = await pool.query('SELECT note FROM explicit_memory WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT $3', [guildId, userId, limit]);
  return r.rows.map((x) => x.note as string).reverse();
}

type LearnedCandidate = { category: string; key: string; note: string };

function tidy(value: string, max = 500) {
  return value.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').slice(0, max);
}

function memoryKey(value: string) {
  return tidy(value.toLowerCase(), 180);
}

function extractLearnedCandidates(content: string): LearnedCandidate[] {
  const text = tidy(content, 1000);
  const found: LearnedCandidate[] = [];

  const remember = text.match(/\bremember(?:\s+that)?\s+(.{3,500})/i);
  if (remember?.[1]) {
    const fact = tidy(remember[1]);
    found.push({ category: 'requested', key: memoryKey(fact), note: `User explicitly asked Sentinel to remember: ${fact}` });
  }

  const favorite = text.match(/\bmy favorite ([a-z0-9][a-z0-9 _'\/-]{1,60}) is (.{1,250})/i);
  if (favorite?.[1] && favorite[2]) {
    const topic = tidy(favorite[1], 80);
    const value = tidy(favorite[2], 250);
    found.push({ category: 'preference', key: `favorite:${memoryKey(topic)}`, note: `Favorite ${topic}: ${value}` });
  }

  const positive = text.match(/\bi (?:really )?(love|like|enjoy|prefer) (.{2,250})/i);
  if (positive?.[1] && positive[2]) {
    const verb = positive[1].toLowerCase();
    const value = tidy(positive[2], 250);
    found.push({ category: 'preference', key: `positive:${memoryKey(value)}`, note: `User says they ${verb} ${value}` });
  }

  const negative = text.match(/\bi (?:really )?(hate|dislike|don't like|do not like) (.{2,250})/i);
  if (negative?.[1] && negative[2]) {
    const verb = negative[1].toLowerCase();
    const value = tidy(negative[2], 250);
    found.push({ category: 'preference', key: `negative:${memoryKey(value)}`, note: `User says they ${verb} ${value}` });
  }

  const relationForward = text.match(/\b([A-Za-z][A-Za-z0-9_'\-]{1,40}) is my (wife|husband|girlfriend|boyfriend|partner|fiance|fiancée|fiancé|sister|brother|mother|mom|father|dad|daughter|son|friend|best friend)\b/i);
  if (relationForward?.[1] && relationForward[2]) {
    const person = tidy(relationForward[1], 50);
    const role = tidy(relationForward[2].toLowerCase(), 40);
    found.push({ category: 'relationship', key: `role:${memoryKey(role)}`, note: `${person} is the user's ${role}` });
  }

  const relationReverse = text.match(/\bmy (wife|husband|girlfriend|boyfriend|partner|fiance|fiancée|fiancé|sister|brother|mother|mom|father|dad|daughter|son|friend|best friend) is ([A-Za-z][A-Za-z0-9_'\-]{1,40})\b/i);
  if (relationReverse?.[1] && relationReverse[2]) {
    const role = tidy(relationReverse[1].toLowerCase(), 40);
    const person = tidy(relationReverse[2], 50);
    found.push({ category: 'relationship', key: `role:${memoryKey(role)}`, note: `${person} is the user's ${role}` });
  }

  const callMe = text.match(/\bcall me ([A-Za-z][A-Za-z0-9_'\-]{1,40})\b/i);
  if (callMe?.[1]) {
    const name = tidy(callMe[1], 50);
    found.push({ category: 'identity', key: 'preferred-name', note: `User prefers to be called ${name}` });
  }

  return found;
}

export async function learnFromDirectMessage(guildId: string, userId: string, messageId: string, content: string) {
  const candidates = extractLearnedCandidates(content);
  for (const item of candidates) {
    await pool.query(`
      INSERT INTO learned_memory(guild_id,user_id,category,memory_key,note,source_message_id,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,NOW())
      ON CONFLICT(guild_id,user_id,category,memory_key)
      DO UPDATE SET note=EXCLUDED.note, source_message_id=EXCLUDED.source_message_id, updated_at=NOW()
    `, [guildId, userId, item.category, item.key, item.note, messageId]);
  }

  if (candidates.length) {
    await pool.query(`
      DELETE FROM learned_memory WHERE id IN (
        SELECT id FROM learned_memory
        WHERE guild_id=$1 AND user_id=$2
        ORDER BY updated_at DESC OFFSET 60
      )
    `, [guildId, userId]);
  }

  return candidates.length;
}

export async function learnedMemories(guildId: string, userId: string, limit = 20) {
  const r = await pool.query(`
    SELECT note FROM learned_memory
    WHERE guild_id=$1 AND user_id=$2
    ORDER BY updated_at DESC LIMIT $3
  `, [guildId, userId, limit]);
  return r.rows.map((x) => x.note as string).reverse();
}
