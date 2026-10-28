import http from 'node:http';
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { config, missingRequiredConfig, runtimeConfigured } from './config.js';
import { generateSentinelReply } from './ai.js';
import { command, handleCommand } from './commands.js';
import {
  explicitMemories,
  getWatchedChannels,
  initDb,
  isOptedOut,
  learnedMemories,
  learnFromDirectMessage,
  recentContext,
  storeMessage,
} from './db.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const cooldowns = new Map<string, number>();
const spontaneousCooldowns = new Map<string, number>();
const spontaneousDaily = new Map<string, { day: string; count: number }>();
const sentinelNamePrefix = /^\s*(?:(?:hey|hi|hello|yo|sup|okay|ok)\s*[,!:\-]?\s*)?sentinel\b[\s,!:;\-?]*/i;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function localFunReply(text: string, userName: string): string | null {
  const trimmed = text.trim();

  if (/\b(?:(?:flip|toss)\s+(?:a\s+)?coin|coin\s*flip|heads\s+or\s+tails)\b/i.test(trimmed)) {
    return `Coin says **${Math.random() < 0.5 ? 'heads' : 'tails'}**. I accept no appeals to Watchtower.`;
  }

  const dice = trimmed.match(/\b(?:roll|throw)\s+(?:a\s+)?d(\d{1,3})\b/i);
  if (dice) {
    const sides = Number(dice[1]);
    if (Number.isInteger(sides) && sides >= 2 && sides <= 100) {
      return `d${sides}: **${Math.floor(Math.random() * sides) + 1}**. The cube has spoken.`;
    }
  }
  if (/\b(?:roll|throw)\s+(?:the\s+)?(?:dice|die)\b/i.test(trimmed)) {
    return `d6: **${Math.floor(Math.random() * 6) + 1}**. Very scientific.`;
  }

  if (/\b(?:threat|chaos)\s+level\b/i.test(trimmed)) {
    const levels = [
      '0/5 — suspiciously peaceful',
      '1/5 — negligible nonsense detected',
      '2/5 — mild operational shenanigans',
      '3/5 — Watchtower is paying attention',
      '4/5 — someone should probably explain themselves',
      '5/5 — this has Auren paperwork written all over it',
    ] as const;
    return `Current threat assessment: **${pick(levels)}**.`;
  }

  if (/\b(?:title me|give me (?:a|my) title|assign me (?:a|my) title|grant me (?:a|my) title)\b/i.test(trimmed)) {
    const titles = [
      'Unlicensed Chaos Coordinator',
      'Senior Button Presser',
      'Keeper of Questionable Decisions',
      'Assistant to the Regional Watchtower',
      'Director of Somehow Making It Work',
      'Certified Thread Derailer',
      'Chief "It Worked Yesterday" Officer',
      'Honorary Incident Generator',
    ] as const;
    return `${userName}, Watchtower recognizes you as **${pick(titles)}**. This title carries no authority whatsoever.`;
  }

  const choice = trimmed.match(/\b(?:pick|choose)\s+(?:one\s+)?(?:between\s+)?(.+?)\s+(?:or|vs\.?|versus)\s+(.+?)[.!?]*$/i);
  if (choice) {
    const left = choice[1]?.trim();
    const right = choice[2]?.trim();
    if (left && right && left.length <= 80 && right.length <= 80) {
      return `I pick **${Math.random() < 0.5 ? left : right}**. Decision logged nowhere, for everyone's protection.`;
    }
  }

  return null;
}

function spontaneousLine(): string {
  return pick([
    'I saw that. I was considering pretending I did not.',
    'Watchtower has classified this as "probably fine." The quotation marks are intentional.',
    'Noted. Against my better judgment.',
    'I have questions. I am choosing restraint.',
    'That was either clever or a future incident report.',
    'I am observing this conversation responsibly. Mostly.',
    'Carry on. I want to see where this goes.',
    'For the record, I noticed.',
  ] as const);
}

client.once(Events.ClientReady, async ready => {
  console.log(`[watchtower] logged in as ${ready.user.tag}`);
  if (config.DISCORD_DEV_GUILD_ID) {
    const guild = await ready.guilds.fetch(config.DISCORD_DEV_GUILD_ID);
    await guild.commands.set([command.toJSON()]);
    console.log(`[watchtower] development commands registered in ${guild.name}`);
  } else if (ready.application) {
    await ready.application.commands.set([command.toJSON()]);
    console.log('[watchtower] global commands registered');
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'sentinel') return;
  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error('[watchtower] command error', err);
    const payload = { content: 'Watchtower hit an internal error handling that command.', ephemeral: true } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  }
});

client.on(Events.MessageCreate, async message => {
  if (!message.guildId || message.author.bot) return;

  const optedOut = await isOptedOut(message.guildId, message.author.id);
  const watched = (await getWatchedChannels(message.guildId)).includes(message.channelId);
  const mentioned = message.mentions.has(client.user!.id);
  const invokedByName = sentinelNamePrefix.test(message.content);
  const invoked = mentioned || invokedByName;

  if (watched && !optedOut && message.content.trim()) {
    await storeMessage({
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      userId: message.author.id,
      displayName: message.member?.displayName ?? message.author.username,
      content: message.content,
      createdAt: message.createdAt,
    });
  }

  if (!invoked) {
    if (watched && !optedOut && message.content.trim().length >= 8) {
      const now = Date.now();
      const last = spontaneousCooldowns.get(message.channelId) ?? 0;
      const interesting = /\b(?:lol|lmao|bruh|bro|no way|finally|again|chaos|broke|broken|working|worked|what the)\b|😂|🤣|💀/i.test(message.content);
      const chance = interesting ? 0.06 : 0.015;
      const today = new Date().toISOString().slice(0, 10);
      const usage = spontaneousDaily.get(message.guildId);
      const daily = usage?.day === today ? usage : { day: today, count: 0 };

      if (now - last >= 20 * 60 * 1000 && daily.count < 5 && Math.random() < chance) {
        spontaneousCooldowns.set(message.channelId, now);
        spontaneousDaily.set(message.guildId, { day: today, count: daily.count + 1 });
        await message.channel.send({ content: spontaneousLine() });
      }
    }
    return;
  }

  const now = Date.now();
  const last = cooldowns.get(message.channelId) ?? 0;
  if (now - last < 4000) return;
  cooldowns.set(message.channelId, now);

  await message.channel.sendTyping();
  try {
    if (!optedOut) {
      await learnFromDirectMessage(message.guildId, message.author.id, message.id, message.content);
    }

    const context = watched ? await recentContext(message.guildId, message.channelId) : [];
    const explicit = optedOut ? [] : await explicitMemories(message.guildId, message.author.id);
    const learned = optedOut ? [] : await learnedMemories(message.guildId, message.author.id);

    let cleaned = message.content.replace(new RegExp(`<@!?${client.user!.id}>`, 'g'), '').trim();
    cleaned = cleaned.replace(sentinelNamePrefix, '').trim();

    const localReply = localFunReply(cleaned || 'Sentinel?', message.member?.displayName ?? message.author.username);
    if (localReply) {
      await message.reply({ content: localReply.slice(0, 1900), allowedMentions: { repliedUser: false } });
      return;
    }

    const reply = await generateSentinelReply({
      userName: message.member?.displayName ?? message.author.username,
      userText: cleaned || 'Sentinel?',
      channelContext: context,
      explicitMemories: explicit,
      learnedMemories: learned,
    });
    await message.reply({ content: reply.slice(0, 1900), allowedMentions: { repliedUser: false } });
  } catch (err) {
    console.error('[watchtower] response error', err);
    await message.reply({ content: 'Watchtower lost the thread for a moment. Try me again.', allowedMentions: { repliedUser: false } });
  }
});

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'sentinel-watchtower',
      configured: runtimeConfigured,
      missing: missingRequiredConfig,
      discordReady: client.isReady(),
    }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(runtimeConfigured ? 'Sentinel Watchtower online.' : 'Sentinel Watchtower setup mode.');
});

server.listen(config.PORT, '0.0.0.0', () => console.log(`[watchtower] health server listening on ${config.PORT}`));

if (runtimeConfigured) {
  await initDb();
  await client.login(config.DISCORD_BOT_TOKEN);
} else {
  console.warn(`[watchtower] setup mode; missing configuration: ${missingRequiredConfig.join(', ')}`);
}
