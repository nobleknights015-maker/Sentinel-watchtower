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
const sentinelNamePrefix = /^\s*(?:(?:hey|hi|hello|yo|sup|okay|ok)\s*[,!:\-]?\s*)?sentinel\b[\s,!:;\-?]*/i;

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

  if (!invoked) return;
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
