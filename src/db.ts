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
    await client.query('COMMIT');
    return { messages: messages.rowCount ?? 0, memories: memories.rowCount ?? 0 };
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
