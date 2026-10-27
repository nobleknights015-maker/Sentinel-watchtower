import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  addExplicitMemory,
  deleteUserData,
  getWatchedChannels,
  setChannelWatched,
  setOptOut,
} from './db.js';

export const command = new SlashCommandBuilder()
  .setName('sentinel')
  .setDescription('Watchtower controls')
  .addSubcommand(s => s.setName('status').setDescription('Show Sentinel status'))
  .addSubcommand(s => s.setName('remember').setDescription('Save an explicit personal memory').addStringOption(o => o.setName('note').setDescription('What Sentinel should remember').setRequired(true).setMaxLength(1000)))
  .addSubcommand(s => s.setName('privacy').setDescription('Control passive message retention').addStringOption(o => o.setName('mode').setDescription('Retention preference').setRequired(true).addChoices({name:'Opt out',value:'out'},{name:'Opt in',value:'in'})))
  .addSubcommand(s => s.setName('delete-my-data').setDescription('Delete your stored channel messages and explicit memories'))
  .addSubcommand(s => s.setName('watch').setDescription('Allow bounded context retention in this channel'))
  .addSubcommand(s => s.setName('unwatch').setDescription('Stop bounded context retention in this channel'));

export async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Watchtower controls are server-only.', ephemeral: true });
    return;
  }
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const watched = await getWatchedChannels(interaction.guildId);
    await interaction.reply({
      content: `Watchtower online. Watched channels: ${watched.length}. Memory is bounded to 200 retained messages per watched channel. Different department. Same objective.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'remember') {
    const note = interaction.options.getString('note', true);
    await addExplicitMemory(interaction.guildId, interaction.user.id, note);
    await interaction.reply({ content: 'Noted. That memory is tied to you in this server.', ephemeral: true });
    return;
  }

  if (sub === 'privacy') {
    const mode = interaction.options.getString('mode', true);
    const out = mode === 'out';
    await setOptOut(interaction.guildId, interaction.user.id, out);
    await interaction.reply({ content: out ? 'Passive retention is disabled for your messages in this server.' : 'Passive retention is enabled again for your messages in watched channels.', ephemeral: true });
    return;
  }

  if (sub === 'delete-my-data') {
    const result = await deleteUserData(interaction.guildId, interaction.user.id);
    await interaction.reply({ content: `Deleted ${result.messages} retained messages and ${result.memories} explicit memories tied to you in this server.`, ephemeral: true });
    return;
  }

  if (sub === 'watch' || sub === 'unwatch') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'Manage Server permission is required for Watchtower channel configuration.', ephemeral: true });
      return;
    }
    const watched = sub === 'watch';
    const channels = await setChannelWatched(interaction.guildId, interaction.channelId, watched);
    await interaction.reply({ content: watched ? `This channel is now watched with bounded retention. Total watched channels: ${channels.length}.` : `This channel is no longer watched. Total watched channels: ${channels.length}.`, ephemeral: true });
  }
}
