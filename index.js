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
  client.user.setActivity('/help for commands', { type: 3 });
});

// ---- NEW MEMBER JOIN — notify them to open an account ----
client.on('guildMemberAdd', async (member) => {
  if (member.user.bot) return;
  const { getConfig } = require('./utils/db');
  const config = getConfig();
  const prefix = config.prefix || '!';
  try {
    await member.send({
      embeds: [{
        color: 0xff3b3b,
        title: '👋 Welcome to the server!',
        description:
          `To start playing the economy game, type **\`${prefix}open account\`** in any channel.\n\n` +
          `You'll receive **$500** to get started.\n\n` +
          `Use **\`${prefix}help\`** to see all available commands.`,
        footer: { text: 'First Class Economy Bot' },
      }],
    });
  } catch { /* DMs closed — they'll find out when they try a command */ }
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

  const db = require('./utils/db');
  const { getConfig, getUser, getOrCreateUser, openAccount, hasAccount, saveUser,
          getStore, giveItem, isBotBanned, deposit, withdraw, isPurgeActive } = db;
  const embeds = require('./utils/embeds');
  const { balanceEmbed, depositEmbed, withdrawEmbed, dailyEmbed,
          robSuccessEmbed, robFailEmbed, coinflipEmbed, errorEmbed, COLORS } = embeds;
  const { EmbedBuilder } = require('discord.js');

  const config = getConfig();
  const prefix = config.prefix || '!';

  // ---- OPEN ACCOUNT (no prefix required — just "open account" or "!open account") ----
  const lower = message.content.toLowerCase().trim();
  if (lower === `${prefix}open account` || lower === 'open account') {
    if (hasAccount(message.author.id)) {
      return message.reply('You already have an account! Use `' + prefix + 'bal` to check your balance.');
    }
    openAccount(message.author.id);
    return message.reply({ embeds: [new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('🏦 Account Opened!')
      .setDescription(`Welcome, **${message.author.username}**! Your account has been created.\n\n💵 Starting wallet: **$500**\n\nUse \`${prefix}help\` to see all commands.`)
    ]});
  }

  if (!message.content.startsWith(prefix)) return;

  const args        = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();

  // ---- silence check helper ----
  const silenced = (userId) => {
    if (isBotBanned(userId)) {
      const u = getOrCreateUser(userId);
      const mins = Math.ceil((u.bannedUntil - Date.now()) / 60000);
      message.reply(`🔇 You're silenced for **${mins}** more minute(s).`);
      return true;
    }
    return false;
  };

  // ---- account check helper ----
  const needsAccount = () => {
    if (!hasAccount(message.author.id)) {
      message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xff3b3b)
          .setTitle('🏦 No Account Found')
          .setDescription(`<@${message.author.id}> you don't have an account yet!\n\nType **\`${prefix}open account\`** to get started and receive **$500** to begin playing.`)
        ]
      });
      return true;
    }
    return false;
  };

  // ---- bal / balance ----
  if (commandName === 'bal' || commandName === 'balance') {
    if (needsAccount()) return;
    if (silenced(message.author.id)) return;
    const target = message.mentions.users.first() || message.author;
    const userData = getUser(target.id);
    if (!userData) {
      const isSelf = target.id === message.author.id;
      return message.reply(isSelf
        ? `<@${message.author.id}> you don't have an account yet! Type \`${prefix}open account\` to get started.`
        : `**${target.username}** doesn't have an account yet.`);
    }
    return message.reply({ embeds: [balanceEmbed(userData, target)] });
  }

  // ---- dep / deposit ----
  if (commandName === 'dep' || commandName === 'deposit') {
    if (needsAccount()) return;
    if (silenced(message.author.id)) return;
    if (isPurgeActive()) return message.reply('🔴 Deposits are disabled during the purge!');
    const input = args[0]?.toLowerCase();
    if (!input) return message.reply('Usage: `' + prefix + 'dep <amount|all>`');
    const user   = getOrCreateUser(message.author.id);
    const amount = input === 'all' ? user.wallet : parseInt(input);
    if (isNaN(amount) || amount <= 0) return message.reply('Enter a valid amount.');
    if (amount > user.wallet) return message.reply(`You only have **$${user.wallet.toLocaleString()}** in your wallet.`);
    try { return message.reply({ embeds: [depositEmbed(deposit(message.author.id, amount), amount)] }); }
    catch (e) { return message.reply(e.message); }
  }

  // ---- with / withdraw ----
  if (commandName === 'with' || commandName === 'withdraw') {
    if (needsAccount()) return;
    if (silenced(message.author.id)) return;
    if (isPurgeActive()) return message.reply('🔴 Withdrawals are disabled during the purge!');
    const input = args[0]?.toLowerCase();
    if (!input) return message.reply('Usage: `' + prefix + 'with <amount|all>`');
    const user   = getOrCreateUser(message.author.id);
    const amount = input === 'all' ? user.bank : parseInt(input);
    if (isNaN(amount) || amount <= 0) return message.reply('Enter a valid amount.');
    if (amount > user.bank) return message.reply(`You only have **$${user.bank.toLocaleString()}** in your bank.`);
    try { return message.reply({ embeds: [withdrawEmbed(withdraw(message.author.id, amount), amount)] }); }
    catch (e) { return message.reply(e.message); }
  }

  // ---- daily ----
  if (commandName === 'daily') {
    if (needsAccount()) return;
    if (silenced(message.author.id)) return;
    const DAILY_AMOUNT = 500;
    const COOLDOWN_MS  = 24 * 60 * 60 * 1000;
    const user = getOrCreateUser(message.author.id);
    const now  = Date.now();
    if (user.lastDaily) {
      const left = COOLDOWN_MS - (now - user.lastDaily);
      if (left > 0) {
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        return message.reply(`You already claimed your daily!\n⏰ Come back in **${h}h ${m}m**`);
      }
    }
    user.wallet   += DAILY_AMOUNT;
    user.lastDaily = now;
    saveUser(message.author.id, user);
    return message.reply({ embeds: [dailyEmbed(DAILY_AMOUNT, user.wallet)] });
  }

  // ---- rob ----
  if (commandName === 'rob') {
    if (needsAccount()) return;
    if (silenced(message.author.id)) return;
    const target = message.mentions.users.first();
    if (!target) return message.reply('Usage: `' + prefix + 'rob @user`');
    if (target.id === message.author.id) return message.reply("You can't rob yourself!");
    if (target.bot) return message.reply("You can't rob a bot!");
    if (!hasAccount(target.id)) return message.reply(`**${target.username}** doesn't have an account yet.`);

    const purge       = isPurgeActive();
    const COOLDOWN_MS = (config.robCooldownMinutes ?? 5) * 60 * 1000;

    // ---- PROTECTED ROLE CHECK ----
    const protectedRoles = Array.isArray(config.protectedRoles) ? config.protectedRoles : [];
    if (protectedRoles.length > 0) {
      const targetMember = await message.guild.members.fetch(target.id).catch(() => null);
      if (targetMember) {
        const isProtected = protectedRoles.some(roleId => targetMember.roles.cache.has(roleId));
        if (isProtected) return message.reply(`🛡️ **${target.username}** is protected and cannot be robbed.`);
      }
    }

    if (!client._robCooldowns) client._robCooldowns = new Map();
    if (!purge) {
      const last = client._robCooldowns.get(message.author.id);
      if (last && Date.now() - last < COOLDOWN_MS) {
        const m = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 60000);
        return message.reply(`Wait **${m} more minute(s)** before robbing again.`);
      }
    }

    const victim = getOrCreateUser(target.id);
    if (victim.wallet <= 0) return message.reply(`**${target.username}** has nothing in their wallet!`);

    client._robCooldowns.set(message.author.id, Date.now());
    const success = Math.random() < (purge ? 0.70 : 0.45);

    if (success) {
      const stolen = Math.floor(victim.wallet * (0.1 + Math.random() * 0.3));
      victim.wallet -= stolen;
      const robber = getOrCreateUser(message.author.id);
      robber.wallet += stolen;
      saveUser(target.id, victim);
      saveUser(message.author.id, robber);
      return message.reply({ embeds: [robSuccessEmbed(stolen, target.username, robber.wallet, purge)] });
    } else {
      const robber = getOrCreateUser(message.author.id);
      const fine   = Math.floor(robber.wallet * 0.1);
      robber.wallet = Math.max(0, robber.wallet - fine);
      saveUser(message.author.id, robber);
      return message.reply({ embeds: [robFailEmbed(fine, robber.wallet)] });
    }
  }

  // ---- shop ----
  if (commandName === 'shop') {
    if (silenced(message.author.id)) return;
    const store   = getStore();
    const enabled = store.items.filter(i => i.enabled);
    if (!enabled.length) return message.reply('The store is empty right now.');
    const { shopEmbed } = require('./utils/embeds');
    return message.reply({ embeds: [shopEmbed(enabled)] });
  }

  // ---- inv / inventory ----
  if (commandName === 'inv' || commandName === 'inventory') {
    if (needsAccount()) return;
    if (silenced(message.author.id)) return;
    const user  = getOrCreateUser(message.author.id);
    const inv   = user.inventory || [];
    if (!inv.length) return message.reply('Your inventory is empty.');
    const store  = getStore();
    const counts = inv.reduce((a, id) => { a[id] = (a[id] || 0) + 1; return a; }, {});
    const lines  = Object.entries(counts).map(([id, cnt]) => {
      const item = store.items.find(i => i.id === id);
      return `${item?.reusable ? '♻️' : '🗑️'} **${item ? item.name : id}** ×${cnt}`;
    });
    return message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.SHOP).setTitle(`🎒 ${message.author.username}'s Inventory`).setDescription(lines.join('\n'))] });
  }

  // ---- collect ----
  if (commandName === 'collect') {
    if (needsAccount()) return;
    if (silenced(message.author.id)) return;
    const roleIncome  = config.roleIncome || {};
    const now         = Date.now();
    const memberRoles = message.member.roles.cache.map(r => r.id);
    const eligible    = Object.entries(roleIncome).filter(([roleId]) => memberRoles.includes(roleId));
    if (!eligible.length) return message.reply("You don't have any roles that earn income.");
    const user = getOrCreateUser(message.author.id);
    if (!user.roleIncomeCooldowns) user.roleIncomeCooldowns = {};
    const collected = [], onCooldown = [];
    for (const [roleId, income] of eligible) {
      const intervalMs  = (income.intervalHours || 24) * 3600000;
      const lastCollect = user.roleIncomeCooldowns[roleId] || 0;
      if (now - lastCollect < intervalMs) {
        const left = intervalMs - (now - lastCollect);
        onCooldown.push(`**${income.name}** — ⏰ ${Math.floor(left/3600000)}h ${Math.floor((left%3600000)/60000)}m`);
        continue;
      }
      income.location === 'bank' ? user.bank += income.amount : user.wallet += income.amount;
      user.roleIncomeCooldowns[roleId] = now;
      collected.push(`✅ **${income.name}** — **$${income.amount.toLocaleString()}** → ${income.location === 'bank' ? '🏦 Bank' : '💵 Wallet'}`);
    }
    saveUser(message.author.id, user);
    if (!collected.length) return message.reply('Nothing ready yet:\n' + onCooldown.join('\n'));
    let reply = collected.join('\n');
    if (onCooldown.length) reply += '\n\n**Still on cooldown:**\n' + onCooldown.join('\n');
    return message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.DAILY).setTitle('💼 Income Collected!').setDescription(reply).addFields({name:'💵 Wallet',value:`$${user.wallet.toLocaleString()}`,inline:true},{name:'🏦 Bank',value:`$${user.bank.toLocaleString()}`,inline:true})] });
  }

  // ---- coinflip / cf ----
  if (commandName === 'coinflip' || commandName === 'cf') {
    if (needsAccount()) return;
    if (silenced(message.author.id)) return;
    const bet    = parseInt(args[0]);
    const choice = args[1]?.toLowerCase();
    if (!bet || bet <= 0) return message.reply('Usage: `' + prefix + 'cf <bet> <heads|tails>`');
    if (!['heads','tails'].includes(choice)) return message.reply('Choose **heads** or **tails**.');
    const user = getOrCreateUser(message.author.id);
    if (bet > user.wallet) return message.reply(`You only have **$${user.wallet.toLocaleString()}**!`);
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won    = result === choice;
    won ? user.wallet += bet : user.wallet -= bet;
    saveUser(message.author.id, user);
    return message.reply({ embeds: [coinflipEmbed(choice, result, bet, won, user.wallet)] });
  }

  // ---- roll ----
  if (commandName === 'roll') {
    if (silenced(message.author.id)) return;
    const sides  = parseInt(args[0]) || 6;
    const result = Math.floor(Math.random() * sides) + 1;
    return message.reply(`🎲 You rolled a **${result}** (d${sides})`);
  }

  // ---- 8ball ----
  if (commandName === '8ball') {
    if (silenced(message.author.id)) return;
    const question = args.join(' ');
    if (!question) return message.reply('Ask a question! e.g. `' + prefix + '8ball Will I win?`');
    const responses = ['It is certain. ✅','Without a doubt. ✅','Yes, definitely. ✅','Most likely. ✅','Signs point to yes. ✅','Ask again later. 🔄','Cannot predict now. 🔄',"Don't count on it. ❌",'My sources say no. ❌','Very doubtful. ❌'];
    return message.reply(`🎱 **${question}**\n${responses[Math.floor(Math.random()*responses.length)]}`);
  }

  // ---- rps ----
  if (commandName === 'rps') {
    if (silenced(message.author.id)) return;
    const choices = ['rock','paper','scissors'];
    const player  = args[0]?.toLowerCase();
    if (!choices.includes(player)) return message.reply('Usage: `' + prefix + 'rps rock/paper/scissors`');
    const bot    = choices[Math.floor(Math.random()*3)];
    const emojis = { rock:'🪨', paper:'📄', scissors:'✂️' };
    const beats  = { rock:'scissors', scissors:'paper', paper:'rock' };
    let result;
    if (player === bot) result = "It's a **tie**! 🤝";
    else if (beats[player] === bot) result = 'You **win**! 🎉';
    else result = 'You **lose**! 😈';
    return message.reply(`${emojis[player]} vs ${emojis[bot]}\n${result}`);
  }

  // ---- bj / blackjack ----
  if (commandName === 'bj' || commandName === 'blackjack') {
    if (silenced(message.author.id)) return;
    return message.reply('Blackjack requires buttons — use `/blackjack <bet>` instead! 🃏');
  }

  // ---- help ----
  if (commandName === 'help') {
    const p = prefix;
    return message.reply({ embeds: [new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('📖 Commands')
      .setDescription(`New? Type \`${p}open account\` to get started!`)
      .addFields(
        { name: '💰 Economy', value: [`${p}bal`, `${p}dep <amt>`, `${p}with <amt>`, `${p}daily`, `${p}rob @user`, `${p}shop`, `${p}inv`, `${p}collect`].join(' · '), inline: false },
        { name: '🎮 Games',   value: [`${p}cf <bet> <heads/tails>`, `${p}roll [sides]`, `${p}8ball <q>`, `${p}rps <choice>`, `/blackjack`, `/roulette`].join(' · '), inline: false },
      )
    ] });
  }
});

// ---- PURGE WATCHER ----
// Checks every 5 seconds if purge state changed via dashboard
// and sends @everyone announcement when it does
let lastPurgeState = null;
setInterval(async () => {
  try {
    const { getConfig } = require('./utils/db');
    const config = getConfig();
    const currentState = config.purgeActive;

    // Only act on a change
    if (lastPurgeState === null) { lastPurgeState = currentState; return; }
    if (currentState === lastPurgeState) return;
    lastPurgeState = currentState;

    // Find announcement channel
    const channelId = config.purgeChannelId;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const { purgeEmbed } = require('./utils/embeds');
    if (currentState) {
      // Purge started from dashboard
      await channel.send({
        content: '@everyone',
        embeds: [purgeEmbed(true)],
        allowedMentions: { parse: ['everyone'] },
      });
    } else {
      // Purge ended from dashboard
      await channel.send({
        content: '@everyone',
        embeds: [purgeEmbed(false)],
        allowedMentions: { parse: ['everyone'] },
      });
    }
  } catch { /* silent */ }
}, 5000);

// ---- PASSIVE INCOME TICK ENGINE ----
// Every 60 seconds, check all users with active passive income effects
// and pay out any ticks that are due
const { tickPassiveIncome } = require('./utils/effects');
setInterval(tickPassiveIncome, 60_000);
tickPassiveIncome(); // run once immediately on startup

// ---- LOGIN ----
client.login(process.env.TOKEN);
