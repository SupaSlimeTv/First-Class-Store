// ============================================================
// index.js — Bot Entry Point (Slash Command Version)
//
// TEACHES: Recursive file loading, interactionCreate event,
//          Collection, error handling at scale
// ============================================================

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

// ---- CREATE CLIENT ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,   // needed for kick/ban/mute
    GatewayIntentBits.MessageContent,
  ],
});

// ---- LOAD ALL SLASH COMMANDS ----
// Commands are split across subfolders: economy/, games/, fun/, moderation/
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');

// fs.readdirSync returns all files/folders in a directory
// We loop over each FOLDER first, then each FILE inside it
const folders = fs.readdirSync(commandsPath);

for (const folder of folders) {
  const folderPath = path.join(commandsPath, folder);

  // Make sure it's a directory, not a stray file
  if (!fs.statSync(folderPath).isDirectory()) continue;

  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const command = require(path.join(folderPath, file));

    // Every command file must export a `data` (SlashCommandBuilder) and `execute`
    if (!command.data || !command.execute) {
      console.warn(`⚠️  Skipping ${file} — missing data or execute export`);
      continue;
    }

    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded: /${command.data.name}`);
  }
}

// ---- READY EVENT ----
client.once('ready', () => {
  console.log(`\n🤖 Logged in as ${client.user.tag}`);
  console.log(`📦 Loaded ${client.commands.size} slash commands\n`);

  client.user.setActivity('/help for commands', { type: 3 }); // 3 = WATCHING
});

// ---- SLASH COMMAND HANDLER ----
// Every slash command fires an "interactionCreate" event
client.on('interactionCreate', async (interaction) => {

  // Only handle slash commands (not buttons — those are handled inside command files)
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command found for: ${interaction.commandName}`);
    return;
  }

  // ---- HITMAN SILENCE CHECK ----
  // If the user was silenced by a hitman, block ALL commands except /help
  if (command.data.name !== 'help') {
    const { isBotBanned, getUser } = require('./utils/db');
    if (isBotBanned(interaction.user.id)) {
      const userData = getUser(interaction.user.id);
      const minsLeft = Math.ceil((userData.bannedUntil - Date.now()) / 60000);
      return interaction.reply({
        content: `🔇 A hitman silenced you. You're locked out of the bot for **${minsLeft} more minute(s)**.`,
        ephemeral: true,
      });
    }
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`❌ Error in /${interaction.commandName}:`, error);

    // If we already replied, use followUp. Otherwise use reply.
    const errorMsg = { content: 'Something went wrong running that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
});

// ---- PREFIX COMMAND HANDLER ----
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const { getConfig, getUser, saveUser, getStore, giveItem, isBotBanned, deposit, withdraw } = require('./utils/db');
  const { balanceEmbed, depositEmbed, withdrawEmbed, errorEmbed } = require('./utils/embeds');

  const config = getConfig();
  const prefix = config.prefix || '!';

  if (!message.content.startsWith(prefix)) return;

  const args        = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();

  // Silence check helper
  const silenced = (userId) => {
    if (isBotBanned(userId)) {
      const u    = getUser(userId);
      const mins = Math.ceil((u.bannedUntil - Date.now()) / 60000);
      message.reply(`🔇 You're silenced for **${mins}** more minute(s).`);
      return true;
    }
    return false;
  };

  // ---- bal / balance ----
  if (commandName === 'bal' || commandName === 'balance') {
    if (silenced(message.author.id)) return;
    const target   = message.mentions.users.first() || message.author;
    const userData = getUser(target.id);
    return message.reply({ embeds: [balanceEmbed(userData, target)] });
  }

  // ---- dep / deposit ----
  if (commandName === 'dep' || commandName === 'deposit') {
    if (silenced(message.author.id)) return;
    const input  = args[0]?.toLowerCase();
    if (!input) return message.reply('Usage: `' + prefix + 'dep <amount|all>`');
    const user   = getUser(message.author.id);
    const amount = input === 'all' ? user.wallet : parseInt(input);
    if (isNaN(amount) || amount <= 0) return message.reply('Enter a valid amount.');
    if (amount > user.wallet) return message.reply(`You only have **$${user.wallet.toLocaleString()}** in your wallet.`);
    try {
      const updated = deposit(message.author.id, amount);
      return message.reply({ embeds: [depositEmbed(updated, amount)] });
    } catch (e) { return message.reply(e.message); }
  }

  // ---- with / withdraw ----
  if (commandName === 'with' || commandName === 'withdraw') {
    if (silenced(message.author.id)) return;
    const input  = args[0]?.toLowerCase();
    if (!input) return message.reply('Usage: `' + prefix + 'with <amount|all>`');
    const user   = getUser(message.author.id);
    const amount = input === 'all' ? user.bank : parseInt(input);
    if (isNaN(amount) || amount <= 0) return message.reply('Enter a valid amount.');
    if (amount > user.bank) return message.reply(`You only have **$${user.bank.toLocaleString()}** in your bank.`);
    try {
      const updated = withdraw(message.author.id, amount);
      return message.reply({ embeds: [withdrawEmbed(updated, amount)] });
    } catch (e) { return message.reply(e.message); }
  }

  // ---- bj / blackjack — redirect to slash command ----
  if (commandName === 'bj' || commandName === 'blackjack') {
    if (silenced(message.author.id)) return;
    return message.reply('Use the slash command `/blackjack <bet>` to play blackjack! 🃏');
  }
});

// ---- PASSIVE INCOME TICK ENGINE ----
// Every 60 seconds, check all users with active passive income effects
// and pay out any ticks that are due
const { tickPassiveIncome } = require('./utils/effects');
setInterval(tickPassiveIncome, 60_000);
tickPassiveIncome(); // run once immediately on startup

// ---- LOGIN ----
client.login(process.env.TOKEN);
