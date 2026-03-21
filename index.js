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
client.once('ready', async () => {
  console.log(`\n🤖 Logged in as ${client.user.tag}`);
  console.log(`📦 Loaded ${client.commands.size} slash commands\n`);
  client.user.setActivity('/help for commands', { type: 3 });
  // Pre-load all users and config into memory cache
  const { preloadCache } = require('./utils/db');
  await preloadCache();

  // Load business cache from MongoDB
  const { preloadBizCache } = require('./utils/bizDb');
  await preloadBizCache();
  console.log('📦 Business cache loaded');

  // Load gang cache from MongoDB
  const { preloadGangCache } = require('./utils/gangDb');
  await preloadGangCache();

  // Load gun cache from MongoDB
  const { preloadGunCache } = require('./utils/gunDb');
  await preloadGunCache();

  // Load pet cache from MongoDB
  const { preloadPetCache } = require('./utils/petDb');
  await preloadPetCache();

  // ── Clean up corrupt business records ──
  try {
    const bizDb = require('./utils/bizDb');
    const all   = bizDb.getAllBusinesses();
    let cleaned = 0;
    for (const [ownerId, biz] of Object.entries(all)) {
      const hasValidType = biz.type && biz.type !== 'undefined' && bizDb.BIZ_TYPES[biz.type];
      const hasValidName = biz.name && biz.name !== 'undefined';
      if (!hasValidType || !hasValidName) {
        bizDb.deleteBusiness(ownerId);
        cleaned++;
        console.log(`🧹 Removed corrupt business for user ${ownerId} (type: ${biz.type}, name: ${biz.name})`);
      }
    }
    if (cleaned) console.log(`🧹 Cleaned ${cleaned} corrupt business record(s)`);
    else console.log('✅ Business records OK');
  } catch(e) { console.error('Business cleanup error:', e.message); }
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

  // ---- AUTOCOMPLETE ----
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try { await command.autocomplete(interaction); } catch (e) { console.error('Autocomplete error:', e); }
    }
    return;
  }

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

  const config = getConfig(message.guildId);
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
    if (isPurgeActive(message.guildId)) return message.reply('🔴 Deposits are disabled during the purge!');
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
    if (isPurgeActive(message.guildId)) return message.reply('🔴 Withdrawals are disabled during the purge!');
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

    const purge       = isPurgeActive(message.guildId);
    const COOLDOWN_MS = (config.robCooldownMinutes ?? 5) * 60 * 1000;

    // ---- PROTECTED ROLE CHECK ----
    const protectedRoles = Array.isArray(config.protectedRoles) ? config.protectedRoles : [];
    if (protectedRoles.length > 0) {
      const targetMember = await message.guild.members.fetch(target.id).catch(() => null);
      if (targetMember) {
        await targetMember.fetch().catch(() => {});
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
        { name:'💰 Economy',      value:[`${p}bal`,`${p}dep <amt>`,`${p}with <amt>`,`${p}daily`,`${p}rob @user`,`${p}shop`,`${p}inv`,`${p}collect`,`${p}work`,`${p}beg`,`${p}lb`].join(' · '), inline:false },
        { name:'🎮 Games',        value:[`${p}slots <bet>`,`${p}duel @user <amt>`,`${p}cf <bet>`,`${p}roll`,`${p}8ball <q>`,`${p}rps <choice>`,`/blackjack`,`/roulette`].join(' · '), inline:false },
        { name:'🎟️ Lottery',     value:[`${p}lottery`,`${p}lottery buy <n>`].join(' · '), inline:false },
        { name:'📈 Market',       value:[`${p}market`,`${p}invest <coin> <amt>`,`${p}cashout <coin>`,`${p}portfolio`].join(' · '), inline:false },
        { name:'🏢 Entrepreneur', value:[`${p}biz`,`${p}bizcollect`,`${p}bizupgrade`,`${p}hire @user`,`${p}fire @user`,`${p}myjobs`,`${p}businesses`].join(' · '), inline:false },
        { name:'🏴 Gangs',        value:[`${p}gang`,`${p}ganginfo`,`${p}gangs`,`${p}gangwar`,`${p}crime`,`${p}gu`,`${p}wl`].join(' · '), inline:false },
        { name:'🐾 Pets',         value:[`${p}petshop`,`${p}pet`,`${p}petfeed`,`${p}petplay`,`${p}petheal <amt>`,`${p}pa @user`,`${p}pets`].join(' · '), inline:false },
        { name:'🤖 AI',           value:[`${p}myai`,`${p}talk`].join(' · '), inline:false },
        { name:'📊 Status',       value:[`${p}status`,`${p}wl`].join(' · '), inline:false },
        { name:'🔫 Guns (Gang Only)', value:[`${p}gunshop`,`${p}gunbuy <id>`,`${p}guns`,`${p}shoot @user`,`${p}health`,`${p}medkit <amt>`].join(' · '), inline:false },
      )
    ] });
  }

  // ---- work ----
  if (commandName === 'work') {
    if (needsAccount()) return;
    const COOLDOWN_MS = 60 * 60 * 1000;
    const user = getOrCreateUser(message.author.id);
    const now  = Date.now();
    if (user.lastWork && now - user.lastWork < COOLDOWN_MS) {
      const left = Math.ceil((COOLDOWN_MS - (now - user.lastWork)) / 60000);
      return message.reply(`⏰ Still tired from your last shift. Come back in **${left} minute(s)**.`);
    }
    const JOBS = ['Uber Driver','Food Delivery','Freelance Designer','Stock Boy','Dog Walker','Street Performer','Pizza Maker','Barista','Cashier','Handyman'];
    const job    = JOBS[Math.floor(Math.random() * JOBS.length)];
    const earned = Math.floor(50 + Math.random() * 200);
    user.wallet  += earned;
    user.lastWork = now;
    saveUser(message.author.id, user);
    return message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle(`💼 ${job}`).setDescription(`You earned **$${earned.toLocaleString()}**!`).addFields({ name:'💵 Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true })] });
  }

  // ---- beg ----
  if (commandName === 'beg') {
    if (needsAccount()) return;
    const user = getOrCreateUser(message.author.id);
    const roll = Math.random();
    let earned = 0, color = COLORS.SUCCESS, desc;
    if (roll < 0.55) { earned = Math.floor(1 + Math.random() * 50); user.wallet += earned; color = COLORS.SUCCESS; desc = `A stranger felt bad for you. **+$${earned}**!`; }
    else if (roll < 0.85) { color = 0x888888; desc = 'Everyone walked past you. You got nothing.'; }
    else { const fine = Math.floor(5 + Math.random() * 15); earned = -fine; user.wallet = Math.max(0, user.wallet - fine); color = COLORS.ERROR; desc = `A cop fined you for loitering. **-$${fine}**!`; }
    saveUser(message.author.id, user);
    return message.reply({ embeds: [new EmbedBuilder().setColor(color).setTitle('🤲 Begging...').setDescription(desc).addFields({ name:'💵 Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true })] });
  }

  // ---- slots ----
  if (commandName === 'slots') {
    if (needsAccount()) return;
    const bet = parseInt(args[0]);
    if (!bet || bet < 10) return message.reply('Usage: `!slots <bet>` (min 10)');
    const user = getOrCreateUser(message.author.id);
    if (bet > user.wallet) return message.reply(`You only have **$${user.wallet.toLocaleString()}** in your wallet.`);
    const REELS = ['🍒','🍋','🍊','🔔','⭐','💎','7️⃣','🎰'];
    const reels = [REELS[Math.floor(Math.random()*REELS.length)], REELS[Math.floor(Math.random()*REELS.length)], REELS[Math.floor(Math.random()*REELS.length)]];
    user.wallet -= bet;
    let payout = 0, label = 'MISS';
    if (reels[0]===reels[1] && reels[1]===reels[2]) {
      const mults = {'7️⃣':10,'💎':7,'⭐':5,'🔔':4,'🍊':3,'🍋':2.5,'🍒':2};
      payout = Math.floor(bet * (mults[reels[0]] || 1.5)); label = reels[0]==='7️⃣'?'JACKPOT!':'WIN!';
    } else if (reels[0]===reels[1]||reels[1]===reels[2]||reels[0]===reels[2]) { payout = Math.floor(bet*0.5); label='CLOSE...'; }
    user.wallet += payout;
    saveUser(message.author.id, user);
    const net = payout - bet;
    return message.reply({ embeds: [new EmbedBuilder().setColor(payout>bet?COLORS.SUCCESS:0x888888).setTitle(`🎰 ${label}`).setDescription(`\`[ ${reels.join('  ')} ]\``).addFields({ name:'Net', value:`${net>=0?'+':''}$${net.toLocaleString()}`, inline:true },{ name:'💵 Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true })] });
  }

  // ---- duel ----
  if (commandName === 'duel') {
    if (needsAccount()) return;
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || !amount || amount < 10) return message.reply('Usage: `!duel @user <amount>`');
    if (target.id === message.author.id) return message.reply("You can't duel yourself.");
    const challenger = getOrCreateUser(message.author.id);
    const targetData = getOrCreateUser(target.id);
    if (amount > challenger.wallet) return message.reply(`You only have **$${challenger.wallet.toLocaleString()}**.`);
    if (amount > targetData.wallet) return message.reply(`**${target.username}** only has **$${targetData.wallet.toLocaleString()}**.`);
    const challengerWins = Math.random() < 0.5;
    if (challengerWins) { challenger.wallet += amount; targetData.wallet -= amount; }
    else { challenger.wallet -= amount; targetData.wallet += amount; }
    saveUser(message.author.id, challenger); saveUser(target.id, targetData);
    const winner = challengerWins ? message.author.username : target.username;
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xf5c518).setTitle('⚔️ Duel Result!').setDescription(`🎉 **${winner}** wins **$${(amount*2).toLocaleString()}**!`).addFields({ name:`${message.author.username}`, value:`$${challenger.wallet.toLocaleString()}`, inline:true },{ name:`${target.username}`, value:`$${targetData.wallet.toLocaleString()}`, inline:true })] });
  }

  // ---- leaderboard (lb) ----
  if (commandName === 'lb' || commandName === 'leaderboard') {
    const { getAllUsers } = require('./utils/db');
    const users  = getAllUsers();
    const sorted = Object.entries(users).filter(([,u])=>u.wallet!==undefined).map(([id,u])=>({ id, total:(u.wallet||0)+(u.bank||0) })).sort((a,b)=>b.total-a.total).slice(0,10);
    const lines  = sorted.map((u,i)=>{
      const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`**#${i+1}**`;
      return `${medal} <@${u.id}> — $${u.total.toLocaleString()}`;
    });
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xf5c518).setTitle('🏆 Top 10 Players').setDescription(lines.join('\n'))] });
  }

  // ---- lottery ----
  if (commandName === 'lottery') {
    const sub = args[0]?.toLowerCase();
    const fs   = require('fs'), path = require('path');
    const LFILE = path.join(__dirname, 'data/lottery.json');
    let lottery; try { lottery = JSON.parse(fs.readFileSync(LFILE,'utf8')); } catch { return message.reply('Lottery not initialized.'); }
    if (!lottery.active) return message.reply('The lottery is currently closed.');
    if (sub === 'buy') {
      if (needsAccount()) return;
      const count = parseInt(args[1]) || 1;
      const cost  = count * lottery.ticketPrice;
      const user  = getOrCreateUser(message.author.id);
      if (user.wallet < cost) return message.reply(`You need **$${cost.toLocaleString()}** but only have **$${user.wallet.toLocaleString()}**.`);
      user.wallet -= cost; lottery.pot += cost;
      const existing = lottery.tickets.find(t=>t.userId===message.author.id);
      if (existing) existing.count += count; else lottery.tickets.push({ userId:message.author.id, count });
      saveUser(message.author.id, user); fs.writeFileSync(LFILE, JSON.stringify(lottery,null,2));
      return message.reply(`🎟️ Bought **${count} ticket(s)** for **$${cost.toLocaleString()}**! Pot: **$${lottery.pot.toLocaleString()}**`);
    }
    const timeLeft = Math.max(0, lottery.drawAt - Date.now());
    const h = Math.floor(timeLeft/3600000), m = Math.floor((timeLeft%3600000)/60000);
    const total = lottery.tickets.reduce((s,t)=>s+t.count,0);
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xf5c518).setTitle('🎟️ Lottery').addFields({ name:'💰 Pot', value:`$${lottery.pot.toLocaleString()}`, inline:true },{ name:'🎫 Tickets', value:total.toString(), inline:true },{ name:'⏰ Draw In', value:`${h}h ${m}m`, inline:true },{ name:'Price', value:`$${lottery.ticketPrice}/ticket`, inline:true })] });
  }

  // ---- market ----
  if (commandName === 'market') {
    const fs = require('fs'), path = require('path');
    const prices = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname,'data/stockPrices.json'),'utf8')); } catch { return {}; } })();
    const COINS = [{id:'DOGE2',e:'🐕'},{id:'PEPE',e:'🐸'},{id:'RUGPUL',e:'🪤'},{id:'MOON',e:'🚀'},{id:'BODEN',e:'🦅'},{id:'CHAD',e:'💪'}];
    const lines = COINS.map(c=>{ const p=prices[c.id]||0; return `${c.e} **${c.id}** — $${p<10?p.toFixed(4):p<100?p.toFixed(2):Math.round(p).toLocaleString()}`; });
    return message.reply({ embeds: [new EmbedBuilder().setColor(0x00d2ff).setTitle('📈 Memecoin Market').setDescription(lines.join('\n')).setFooter({text:'Use /invest to buy · /portfolio to view'})] });
  }

  // ---- invest ----
  if (commandName === 'invest') {
    if (needsAccount()) return;
    const coinId = args[0]?.toUpperCase();
    const amount = parseInt(args[1]);
    const VALID  = ['DOGE2','PEPE','RUGPUL','MOON','BODEN','CHAD'];
    if (!coinId || !VALID.includes(coinId)) return message.reply(`Usage: \`!invest <coin> <amount>\`\nCoins: ${VALID.join(', ')}`);
    if (!amount || amount < 1) return message.reply('Usage: `!invest <coin> <amount>`');
    const fs = require('fs'), path = require('path');
    const prices = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname,'data/stockPrices.json'),'utf8')); } catch { return {}; } })();
    const price  = prices[coinId] || 100;
    const user   = getOrCreateUser(message.author.id);
    if (amount > user.wallet) return message.reply(`You only have **$${user.wallet.toLocaleString()}**.`);
    const shares = amount / price;
    user.wallet -= amount;
    if (!user.stocks) user.stocks = {};
    if (!user.stocks[coinId]) user.stocks[coinId] = { shares:0, invested:0 };
    user.stocks[coinId].shares   += shares;
    user.stocks[coinId].invested += amount;
    saveUser(message.author.id, user);
    return message.reply(`📈 Invested **$${amount.toLocaleString()}** in **${coinId}** at **$${price.toFixed(2)}**. Shares: ${shares.toFixed(6)}`);
  }

  // ---- cashout ----
  if (commandName === 'cashout') {
    if (needsAccount()) return;
    const coinId = args[0]?.toUpperCase();
    if (!coinId) return message.reply('Usage: `!cashout <coin>`');
    const user = getOrCreateUser(message.author.id);
    if (!user.stocks?.[coinId] || user.stocks[coinId].shares <= 0) return message.reply(`You don't have any **${coinId}** shares.`);
    const fs = require('fs'), path = require('path');
    const prices = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname,'data/stockPrices.json'),'utf8')); } catch { return {}; } })();
    const price   = prices[coinId] || 100;
    const value   = user.stocks[coinId].shares * price;
    const invested= user.stocks[coinId].invested;
    const profit  = value - invested;
    user.wallet  += Math.floor(value);
    delete user.stocks[coinId];
    saveUser(message.author.id, user);
    return message.reply({ embeds: [new EmbedBuilder().setColor(profit>=0?COLORS.SUCCESS:COLORS.ERROR).setTitle(`${profit>=0?'📈':'📉'} Cashed Out ${coinId}`).addFields({ name:'Received', value:`$${Math.floor(value).toLocaleString()}`, inline:true },{ name:profit>=0?'Profit':'Loss', value:`${profit>=0?'+':''} $${Math.floor(Math.abs(profit)).toLocaleString()}`, inline:true },{ name:'💵 Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true })] });
  }

  // ---- portfolio ----
  if (commandName === 'portfolio') {
    if (needsAccount()) return;
    const user   = getOrCreateUser(message.author.id);
    const stocks = user.stocks || {};
    const fs = require('fs'), path = require('path');
    const prices = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname,'data/stockPrices.json'),'utf8')); } catch { return {}; } })();
    const holdings = Object.entries(stocks).filter(([,s])=>s.shares>0);
    if (!holdings.length) return message.reply("You don't have any investments. Use `!invest <coin> <amount>`.");
    const lines = holdings.map(([id,s])=>{
      const value  = s.shares * (prices[id]||100);
      const profit = value - s.invested;
      return `**${id}** — $${Math.floor(value).toLocaleString()} (${profit>=0?'+':''}$${Math.floor(Math.abs(profit)).toLocaleString()})`;
    });
    return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📊 Your Portfolio').setDescription(lines.join('\n'))] });
  }

  // ---- biz (business view) ----
  if (commandName === 'biz' || commandName === 'bizview') {
    if (needsAccount()) return;
    const { getBusiness, calcIncome } = require('./utils/bizDb');
    const biz = getBusiness(message.author.id);
    if (!biz) return message.reply("You don't own a business. Use `/business start` to open one.");
    const { BIZ_TYPES } = require('./utils/bizDb');
    const type = BIZ_TYPES[biz.type] || {};
    const perSec = calcIncome(biz) / 60;
    const pending = Math.floor(perSec * ((Date.now()-biz.lastTick)/1000)) + biz.revenue;
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xf5c518).setTitle(`${type.emoji||'🏢'} ${biz.name}`).addFields({ name:'💰 Revenue Ready', value:`$${pending.toLocaleString()}`, inline:true },{ name:'📈 Rate', value:`$${calcIncome(biz).toLocaleString()}/min`, inline:true },{ name:'⭐ Level', value:biz.level.toString(), inline:true },{ name:'👥 Employees', value:`${biz.employees.length}/5`, inline:true })] });
  }

  // ---- bizcollect ----
  if (commandName === 'bizcollect') {
    if (needsAccount()) return;
    const { getBusiness, saveBusiness, calcIncome } = require('./utils/bizDb');
    const biz = getBusiness(message.author.id);
    if (!biz) return message.reply("You don't own a business.");
    const now     = Date.now();
    const elapsed = (now - biz.lastTick) / 1000;
    const earned  = Math.floor((calcIncome(biz)/60) * elapsed) + biz.revenue;
    if (earned < 1) return message.reply('No revenue to collect yet.');
    const user = getOrCreateUser(message.author.id);
    user.wallet += earned; biz.revenue = 0; biz.lastTick = now; biz.totalEarned = (biz.totalEarned||0) + earned;
    saveUser(message.author.id, user); saveBusiness(message.author.id, biz);
    return message.reply(`💼 Collected **$${earned.toLocaleString()}** from **${biz.name}**! Wallet: **$${user.wallet.toLocaleString()}**`);
  }

  // ---- bizupgrade ----
  if (commandName === 'bizupgrade') {
    if (needsAccount()) return;
    const { getBusiness, saveBusiness, calcIncome, BIZ_TYPES } = require('./utils/bizDb');
    const biz  = getBusiness(message.author.id);
    if (!biz) return message.reply("You don't own a business.");
    const type = BIZ_TYPES[biz.type];
    if (biz.level >= type.maxLevel) return message.reply('Your business is already at **MAX LEVEL**!');
    const cost = type.upgradeCost * biz.level;
    const user = getOrCreateUser(message.author.id);
    if (user.wallet < cost) return message.reply(`You need **$${cost.toLocaleString()}** to upgrade.`);
    user.wallet -= cost; biz.level++;
    saveUser(message.author.id, user); saveBusiness(message.author.id, biz);
    return message.reply(`⭐ **${biz.name}** upgraded to **Level ${biz.level}**! Income: **$${calcIncome(biz).toLocaleString()}/min**`);
  }

  // ---- gang (info shortcut) ----
  if (commandName === 'gang') {
    const { getGangByMember } = require('./utils/gangDb');
    const gang = getGangByMember(message.author.id);
    if (!gang) return message.reply("You're not in a gang. Use `/gang create` to start one.");
    const isMafia = gang.gangType === 'mafia';
    return message.reply({ embeds: [new EmbedBuilder().setColor(isMafia?0x2c3e50:0xff3b3b).setTitle(`${gang.color} ${gang.name} ${gang.tag}`).setDescription(`${isMafia?'👔 Mafia':'🔫 Street Gang'}`).addFields({ name:'👥 Members', value:gang.members.length.toString(), inline:true },{ name:'🏆 Rep', value:(gang.rep||0).toString(), inline:true },{ name:'💰 Bank', value:`$${(gang.bank||0).toLocaleString()}`, inline:true },{ name:'💀 Record', value:`${gang.wins||0}W/${gang.losses||0}L`, inline:true })] });
  }

  // ---- ganginfo ----
  if (commandName === 'ganginfo') {
    const { getGangByMember, getMemberRank } = require('./utils/gangDb');
    const gang = getGangByMember(message.author.id);
    if (!gang) return message.reply("You're not in a gang.");
    const memberList = gang.members.slice(0,8).map(m=>{ const rank=getMemberRank(m.rep||0); return `${gang.color} <@${m.userId}> — ${m.role==='Leader'?'👑':rank.name}`; }).join('\n');
    const isMafia = gang.gangType === 'mafia';
    const upgrades = [gang.police_payroll?`👮 Payroll Lv${gang.police_payroll}`:'', gang.armory?`🔫 Armory Lv${gang.armory}`:'', gang.safehouses?`🏠 Safehouses Lv${gang.safehouses}`:''  ].filter(Boolean).join(' · ') || 'None';
    return message.reply({ embeds: [new EmbedBuilder().setColor(isMafia?0x2c3e50:0xff3b3b).setTitle(`${gang.color} ${gang.name} ${gang.tag} — ${isMafia?'👔 Mafia':'🔫 Street Gang'}`).addFields({ name:'👑 Leader', value:`<@${gang.leaderId}>`, inline:true },{ name:'👥 Members', value:`${gang.members.length}/20`, inline:true },{ name:'🏆 Rep', value:(gang.rep||0).toString(), inline:true },{ name:'💀 Record', value:`${gang.wins||0}W/${gang.losses||0}L`, inline:true },{ name:'💰 Bank', value:`$${(gang.bank||0).toLocaleString()}`, inline:true },{ name:'🛠️ Upgrades', value:upgrades, inline:true },{ name:'Roster', value:memberList||'Empty', inline:false })] });
  }

  // ---- gangs ----
  if (commandName === 'gangs') {
    const { getAllGangs } = require('./utils/gangDb');
    const list = Object.values(getAllGangs()).sort((a,b)=>(b.rep||0)-(a.rep||0)).slice(0,10);
    if (!list.length) return message.reply('No gangs yet. Use `/gang create` to start one.');
    const lines = list.map((g,i)=>{ const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`**${i+1}.**`; return `${medal} ${g.color} **${g.name}** ${g.tag} — ${g.rep||0} rep · ${g.members.length} members`; });
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xff3b3b).setTitle('🏴 Gang Rankings').setDescription(lines.join('\n'))] });
  }

  // ---- gangwar ----
  if (commandName === 'gangwar') {
    const { getGangByMember, getAllWars } = require('./utils/gangDb');
    const gang  = getGangByMember(message.author.id);
    if (!gang) return message.reply("You're not in a gang.");
    const wars  = getAllWars();
    const myWar = Object.values(wars).find(w=>(w.gang1Id===gang.id||w.gang2Id===gang.id)&&w.endsAt>Date.now());
    if (!myWar) return message.reply('Your gang is not in an active war. Use `/gangwar challenge` to declare war.');
    const left = Math.ceil((myWar.endsAt-Date.now())/60000);
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xff3b3b).setTitle(`⚔️ Active War — ${myWar.gang1Name} vs ${myWar.gang2Name}`).addFields({ name:myWar.gang1Name, value:`${myWar.gang1Score||0} pts`, inline:true },{ name:myWar.gang2Name, value:`${myWar.gang2Score||0} pts`, inline:true },{ name:'⏰ Time Left', value:`${left} minutes`, inline:true })] });
  }

  // ---- wl / wanted / wantedlevel ----
  if (commandName === 'wl' || commandName === 'wanted' || commandName === 'wantedlevel') {
    const { getPoliceRecord } = require('./utils/gangDb');
    const { getHeatLevel }    = require('./utils/police');
    const record   = getPoliceRecord(message.author.id);
    const heat     = record.heat || 0;
    const level    = getHeatLevel(heat);
    const jailed   = record.jailUntil && Date.now() < record.jailUntil;
    const jailLeft = jailed ? Math.ceil((record.jailUntil - Date.now()) / 60000) : 0;
    const bar      = '█'.repeat(Math.floor(heat/10)) + '░'.repeat(10-Math.floor(heat/10));
    const stars    = heat>75?'⭐⭐⭐⭐⭐':heat>50?'⭐⭐⭐⭐':heat>25?'⭐⭐⭐':heat>10?'⭐⭐':heat>0?'⭐':'☆☆☆☆☆';
    return message.reply({ embeds: [new EmbedBuilder().setColor(heat>75?0xff0000:heat>50?0xff8800:heat>25?0xffff00:0x00ff00).setTitle(`🚔 Wanted Level — ${level.name}`).setDescription(`${stars}\n\`[${bar}] ${heat}/100\``).addFields({ name:'🌡️ Heat', value:`${heat}/100`, inline:true },{ name:'🚔 Arrests', value:(record.arrests||0).toString(), inline:true },{ name:'⏰ Status', value:jailed?`🔒 ${jailLeft}m left`:'🟢 Free', inline:true })] });
  }

  // ---- myai ----
  if (commandName === 'myai') {
    const { getEntitiesByOwner, AI_ARCHETYPES } = require('./utils/aiEntities');
    const entities = getEntitiesByOwner(message.author.id);
    if (!entities.length) return message.reply("You don't have any AI entities. Buy items with the AI effect type.");
    const lines = entities.map(e=>{ const arch=AI_ARCHETYPES[e.archetype]||{}; const mood=e.mood==='rogue'?'😡 ROGUE':e.mood==='happy'?'😊 Happy':'😐 Idle'; return `${arch.emoji||'🤖'} **${e.name}** — ${mood} · Loyalty: ${e.loyalty||50}/100`; });
    return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🤖 Your AI Entities').setDescription(lines.join('\n'))] });
  }

  // ---- status ----
  if (commandName === 'status' || commandName === 'buffs') {
    const { listConsumeBuffs } = require('./utils/consumeBuffs');
    const buffs = listConsumeBuffs(message.author.id);
    if (!buffs.length) return message.reply('No active buffs. Consume items to gain effects!');
    const BUFF_EMOJIS = { rob_boost:'🔫', work_boost:'💼', crime_boost:'🌡️', passive_boost:'💰', shield:'🛡️', speed:'⚡', lucky:'🍀', poisoned:'☠️', high:'😵', focused:'🎯' };
    const lines = buffs.map(b=>`${BUFF_EMOJIS[b.buffType]||'✨'} **${b.buffType.replace(/_/g,' ')}** +${b.strength}% — ${b.minutesLeft}m left`);
    return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📊 Active Buffs').setDescription(lines.join('\n'))] });
  }

  // ---- pet / petstatus / ps ----
  if (commandName === 'pet' || commandName === 'petstatus' || commandName === 'ps') {
    if (needsAccount()) return;
    const { getPet, calcPetStats, xpForLevel } = require('./utils/petDb');
    const pet = getPet(message.author.id);
    if (!pet) return message.reply(`You don't have a pet! Use \`${prefix}petshop\` to browse.`);
    const stats  = calcPetStats(pet);
    const xpNext = xpForLevel(pet.level);
    return message.reply({ embeds: [new EmbedBuilder()
      .setColor(0xff6b35)
      .setTitle(`${pet.emoji} ${pet.name}`)
      .addFields(
        { name:'❤️ HP',        value:`${pet.hp||stats.hp}/${stats.hp}`,              inline:true },
        { name:'🍖 Hunger',    value:`${pet.hunger||100}/100`,                         inline:true },
        { name:'💕 Happiness', value:`${pet.happiness||100}/100`,                      inline:true },
        { name:'🔗 Bond',      value:`${pet.bond||0}/100`,                             inline:true },
        { name:'⭐ Level',     value:`${pet.level} · XP: ${pet.xp||0}/${xpNext}`,     inline:true },
        { name:'⚔️ Power',    value:stats.power.toString(),                            inline:true },
        { name:'🏆 Record',   value:`${pet.wins||0}W/${pet.losses||0}L`,              inline:true },
        { name:'🛡️ Guard',    value: pet.guardMode ? '✅ Active' : '❌ Off',          inline:true },
        { name:'🪙 Tokens',   value:`${pet.tokens||0}`,                               inline:true },
      )
      .setFooter({ text:`${prefix}petfeed · ${prefix}petplay · ${prefix}petmission · ${prefix}petupgrade · ${prefix}petguard · ${prefix}petevolve` })
    ]});
  }

  // ---- petmission / pm ----
  if (commandName === 'petmission' || commandName === 'pm') {
    if (needsAccount()) return;
    return message.reply(`Use \`/pet mission\` — missions require slash command to pick mission type. Type \`/pet\` and choose **mission** from the subcommand list.`);
  }

  // ---- petupgrade / pu ----
  if (commandName === 'petupgrade' || commandName === 'pu') {
    if (needsAccount()) return;
    const stat = args[0]?.toLowerCase();
    if (!stat || !['health','defense','intelligence','attack'].includes(stat)) {
      return message.reply(`Usage: \`${prefix}petupgrade <health|defense|intelligence|attack>\`\n\nSpend Pet Tokens to upgrade your pet's stats. Use \`${prefix}pet\` to see your token balance.`);
    }
    return message.reply(`Use \`/pet upgrade stat:${stat}\` — upgrades require the slash command. Type \`/pet\` and choose **upgrade**.`);
  }

  // ---- petguard / pg ----
  if (commandName === 'petguard' || commandName === 'pg') {
    if (needsAccount()) return;
    const { getPet, savePet } = require('./utils/petDb');
    const pet = getPet(message.author.id);
    if (!pet) return message.reply(`No pet! Use \`${prefix}petshop\` to adopt one.`);
    pet.guardMode = !pet.guardMode;
    await savePet(message.author.id, pet);
    return message.reply(`${pet.emoji} **${pet.name}** guard mode is now **${pet.guardMode ? '✅ ON — will defend you from attacks' : '❌ OFF'}**.`);
  }

  // ---- petevolve / pe ----
  if (commandName === 'petevolve' || commandName === 'pe') {
    if (needsAccount()) return;
    return message.reply(`Use \`/pet evolve\` — evolutions require the slash command.`);
  }

  // ---- petfeed ----
  if (commandName === 'petfeed' || commandName === 'feed') {
    if (needsAccount()) return;
    const { getPet, savePet, xpForLevel } = require('./utils/petDb');
    const pet = getPet(message.author.id);
    if (!pet) return message.reply(`No pet! Use \`${prefix}petshop\` to adopt one.`);
    const now = Date.now(), FEED_CD = 30*60*1000;
    if (now - (pet.lastFed||0) < FEED_CD) return message.reply(`${pet.emoji} **${pet.name}** is still full! Wait **${Math.ceil((FEED_CD-(now-(pet.lastFed||0)))/60000)} minutes**.`);
    pet.hunger = Math.min(100, (pet.hunger||100)+30);
    pet.happiness = Math.min(100, (pet.happiness||100)+5);
    pet.lastFed = now; pet.xp = (pet.xp||0)+10;
    require('./utils/petDb').savePet(message.author.id, pet);
    return message.reply(`${pet.emoji} **${pet.name}** ate happily! 🍖 Hunger: ${pet.hunger}/100 · +10 XP`);
  }

  // ---- petplay ----
  if (commandName === 'petplay' || commandName === 'play') {
    if (needsAccount()) return;
    const { getPet, savePet, xpForLevel } = require('./utils/petDb');
    const pet = getPet(message.author.id);
    if (!pet) return message.reply(`No pet! Use \`${prefix}petshop\` to adopt one.`);
    const now = Date.now(), PLAY_CD = 60*60*1000;
    if (now - (pet.lastPlayed||0) < PLAY_CD) return message.reply(`${pet.emoji} **${pet.name}** is tired! Wait **${Math.ceil((PLAY_CD-(now-(pet.lastPlayed||0)))/60000)} minutes**.`);
    const bondGain = 2 + Math.floor(Math.random()*4);
    pet.happiness = Math.min(100,(pet.happiness||100)+20);
    pet.bond = Math.min(100,(pet.bond||0)+bondGain);
    pet.lastPlayed = now; pet.xp=(pet.xp||0)+15;
    require('./utils/petDb').savePet(message.author.id, pet);
    return message.reply(`${pet.emoji} **${pet.name}** had a blast! 💕 Happiness: ${pet.happiness}/100 · Bond: ${pet.bond}/100 · +15 XP`);
  }

  // ---- petheal ----
  if (commandName === 'petheal') {
    if (needsAccount()) return;
    const amount = parseInt(args[0]);
    if (!amount || amount < 10) return message.reply(`Usage: \`${prefix}petheal <amount>\``);
    const { getPet, savePet, calcPetStats } = require('./utils/petDb');
    const pet = getPet(message.author.id);
    if (!pet) return message.reply('No pet to heal.');
    const user = getOrCreateUser(message.author.id);
    if (user.wallet < amount) return message.reply(`You only have **$${user.wallet.toLocaleString()}**.`);
    const stats = calcPetStats(pet);
    if (pet.hp >= stats.hp) return message.reply(`${pet.emoji} **${pet.name}** is already at full HP!`);
    const healAmt = Math.floor(amount/10);
    user.wallet -= amount; pet.hp = Math.min(stats.hp,(pet.hp||0)+healAmt);
    saveUser(message.author.id, user); savePet(message.author.id, pet);
    return message.reply(`💊 Healed **${pet.name}** for ${healAmt} HP! ❤️ ${pet.hp}/${stats.hp}`);
  }

  // ---- petshop ----
  if (commandName === 'petshop') {
    const { PET_TYPES } = require('./utils/petDb');
    const RARITY_E = { Common:'🟢', Uncommon:'🔵', Rare:'🟣', Epic:'🟠', Legendary:'🔴', Mythic:'⭐' };
    const lines = Object.entries(PET_TYPES).map(([,p])=>`${p.emoji} **${p.name}** ${RARITY_E[p.rarity]} — $${p.cost.toLocaleString()} · Tier ${p.tier}`);
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xff6b35).setTitle('🐾 Pet Shop').setDescription(lines.join('\n')).setFooter({text:`Use /petshop to buy · /petshop <pet> for details`})] });
  }

  // ---- pets ----
  if (commandName === 'pets') {
    const { getAllPets, PET_TYPES, calcPetStats } = require('./utils/petDb');
    const all  = getAllPets();
    const list = Object.values(all).sort((a,b)=>calcPetStats(b).power-calcPetStats(a).power).slice(0,10);
    if (!list.length) return message.reply('No pets yet! Use `/petshop` to adopt one.');
    const lines = list.map((p,i)=>{ const t=PET_TYPES[p.type]||{}; const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`**${i+1}.**`; return `${medal} ${p.emoji} **${p.name}** (${t.name}) Lv${p.level} · ⚔️${calcPetStats(p).power} · <@${p.ownerId}>`; });
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xff6b35).setTitle('🐾 Pet Rankings').setDescription(lines.join('\n'))] });
  }

  // ---- petattack / pa ----
  if (commandName === 'petattack' || commandName === 'pa') {
    if (needsAccount()) return;
    const target = message.mentions.users.first();
    if (!target) return message.reply(`Usage: \`${prefix}petattack @user\``);
    if (target.id === message.author.id) return message.reply("You can't attack yourself.");
    const { getPet, savePet, calcPetStats, xpForLevel } = require('./utils/petDb');
    const myPet = getPet(message.author.id);
    if (!myPet) return message.reply(`No pet! Use \`${prefix}petshop\` to adopt one.`);
    if ((myPet.hunger||100) < 20 || (myPet.happiness||100) < 20) return message.reply(`${myPet.emoji} **${myPet.name}** is too hungry or unhappy to fight! Feed and play with it first.`);
    const myStats  = calcPetStats(myPet);
    const { PET_TYPES } = require('./utils/petDb');
    const pType    = PET_TYPES[myPet.type] || {};
    const victim   = getOrCreateUser(target.id);
    const defPet   = getPet(target.id);
    const defStats = defPet ? calcPetStats(defPet) : null;
    // Defense check
    if (defPet && (defPet.hp||defStats.hp) > 0 && defStats) {
      if (Math.random() * (defStats.defense + myStats.power) > Math.random() * myStats.power * 1.5) {
        const dmg = Math.floor(defStats.power * 0.3);
        myPet.hp  = Math.max(0,(myPet.hp||myStats.hp)-dmg);
        savePet(message.author.id, myPet);
        return message.reply(`${defPet.emoji} **${defPet.name}** blocked the attack and hit back for **${dmg} damage**! ${myPet.emoji} ${myPet.name}: ${myPet.hp}/${myStats.hp} HP`);
      }
    }
    const stolen = Math.floor(victim.wallet * Math.min(0.3, 0.05 + myStats.power/1000));
    if (stolen < 1) return message.reply(`${myPet.emoji} **${myPet.name}** attacked but <@${target.id}> had nothing to steal.`);
    victim.wallet -= stolen;
    const owner    = getOrCreateUser(message.author.id);
    owner.wallet  += stolen;
    myPet.hunger   = Math.max(0,(myPet.hunger||100)-15);
    myPet.happiness= Math.max(0,(myPet.happiness||100)-10);
    myPet.xp       = (myPet.xp||0)+25; myPet.wins=(myPet.wins||0)+1;
    if (myPet.xp >= xpForLevel(myPet.level)) { myPet.xp -= xpForLevel(myPet.level); myPet.level++; }
    saveUser(target.id, victim); saveUser(message.author.id, owner); savePet(message.author.id, myPet);
    const flavor = (pType.attackFlavor||['attacked'])[Math.floor(Math.random()*(pType.attackFlavor||['attacked']).length)];
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xff3b3b).setTitle(`${myPet.emoji} Pet Attack!`).setDescription(`${myPet.emoji} **${myPet.name}** ${flavor} <@${target.id}> and stole **$${stolen.toLocaleString()}**!`).addFields({ name:'💵 Your Wallet', value:`$${owner.wallet.toLocaleString()}`, inline:true },{ name:'⭐ Level', value:`Lv${myPet.level}`, inline:true })] });
  }

  // ---- hire ----
  if (commandName === 'hire') {
    if (needsAccount()) return;
    const target = message.mentions.users.first();
    if (!target) return message.reply(`Usage: \`${prefix}hire @user\``);
    const { getBusiness, saveBusiness } = require('./utils/bizDb');
    const biz = getBusiness(message.author.id);
    if (!biz) return message.reply(`You don't own a business. Use \`/business start\` first.`);
    if ((biz.employees||[]).length >= 5) return message.reply('Your business already has 5 employees (max).');
    if ((biz.employees||[]).some(e=>e.userId===target.id)) return message.reply(`**${target.username}** already works for you.`);
    biz.employees = biz.employees || [];
    biz.employees.push({ userId:target.id, role:'Employee', joinedAt:Date.now() });
    saveBusiness(message.author.id, biz);
    return message.reply(`👔 **${target.username}** hired at **${biz.name}**! They'll earn 10% of each collection.`);
  }

  // ---- fire ----
  if (commandName === 'fire') {
    if (needsAccount()) return;
    const target = message.mentions.users.first();
    if (!target) return message.reply(`Usage: \`${prefix}fire @user\``);
    const { getBusiness, saveBusiness } = require('./utils/bizDb');
    const biz = getBusiness(message.author.id);
    if (!biz) return message.reply("You don't own a business.");
    const idx = (biz.employees||[]).findIndex(e=>e.userId===target.id);
    if (idx===-1) return message.reply(`**${target.username}** doesn't work for you.`);
    biz.employees.splice(idx,1);
    saveBusiness(message.author.id, biz);
    return message.reply(`📋 **${target.username}** has been let go from **${biz.name}**.`);
  }

  // ---- myjobs ----
  if (commandName === 'myjobs') {
    if (needsAccount()) return;
    const { getAllBusinesses, BIZ_TYPES, calcIncome } = require('./utils/bizDb');
    const jobs = Object.values(getAllBusinesses()).filter(b=>(b.employees||[]).some(e=>e.userId===message.author.id));
    if (!jobs.length) return message.reply("You're not employed anywhere. Wait for a business owner to hire you!");
    const lines = jobs.map(b=>{ const t=BIZ_TYPES[b.type]||{}; return `${t.emoji||'🏢'} **${b.name}** — ~$${Math.floor(calcIncome(b)*0.1).toLocaleString()}/collection`; });
    return message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle('💼 Your Jobs').setDescription(lines.join('\n'))] });
  }

  // ---- gangcrime / crime ----
  if (commandName === 'gangcrime' || commandName === 'crime') {
    const crime = args[0]?.toLowerCase();
    if (!crime) return message.reply(`Usage: \`${prefix}gangcrime <pickpocket|carjack|heist|mugging|bankjob|murder>\``);
    const { getGangByMember } = require('./utils/gangDb');
    const gang = getGangByMember(message.author.id);
    if (!gang) return message.reply("You need to be in a gang to commit crimes.");
    return message.reply(`Use the slash command \`/gangcrime\` for the full crime menu with all options and autocomplete.`);
  }

  // ---- ganginvite / gi ----
  if (commandName === 'ganginvite' || commandName === 'gi') {
    const target = message.mentions.users.first();
    if (!target) return message.reply(`Usage: \`${prefix}ganginvite @user\``);
    return message.reply(`Use \`/ganginvite @${target.username}\` to send a proper invite with Accept/Decline buttons!`);
  }

  // ---- gangupgrade / gu ----
  if (commandName === 'gangupgrade' || commandName === 'gu') {
    const { getGangByMember } = require('./utils/gangDb');
    const gang = getGangByMember(message.author.id);
    if (!gang) return message.reply("You're not in a gang.");
    const upgrades = [];
    if (!gang.police_payroll) upgrades.push(`👮 police_payroll ($20,000)`);
    if (!gang.armory)         upgrades.push(`🔫 armory ($15,000)`);
    if (!gang.safehouses)     upgrades.push(`🏠 safehouses ($25,000)`);
    if (gang.gangType!=='mafia') upgrades.push(`👔 mafia ($50,000 · 500 rep · 5 wins)`);
    return message.reply(`Use \`/gangupgrade\` for upgrades:\n${upgrades.join('\n')||'All upgrades purchased!'}`);
  }

  // ---- businesses / allbiz ----
  if (commandName === 'businesses' || commandName === 'allbiz') {
    const { getAllBusinesses, BIZ_TYPES, calcIncome } = require('./utils/bizDb');
    const list = Object.values(getAllBusinesses()).sort((a,b)=>b.level-a.level).slice(0,10);
    if (!list.length) return message.reply('No businesses yet. Use `/business start` to open one.');
    const lines = list.map((b,i)=>{ const t=BIZ_TYPES[b.type]||{}; const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`**${i+1}.**`; return `${medal} ${t.emoji||'🏢'} **${b.name}** Lv${b.level} · $${calcIncome(b).toLocaleString()}/min · <@${b.ownerId}>`; });
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xf5c518).setTitle('🏢 Business Rankings').setDescription(lines.join('\n'))] });
  }

  // ---- talk ----
  if (commandName === 'talk') {
    if (needsAccount()) return;
    const { getEntitiesByOwner, AI_ARCHETYPES } = require('./utils/aiEntities');
    const entities = getEntitiesByOwner(message.author.id);
    if (!entities.length) return message.reply("You don't have any AI entities. Buy items with the AI effect type.");
    if (entities.length === 1) {
      const e    = entities[0];
      const arch = AI_ARCHETYPES[e.archetype] || {};
      const moodResponses = arch.responses?.[e.mood] || arch.responses?.loyal || ['...'];
      const response = moodResponses[Math.floor(Math.random()*moodResponses.length)];
      const moodEmoji = e.mood==='rogue'?'😡':e.mood==='happy'?'😊':'😐';
      return message.reply(`${arch.emoji||'🤖'} **${e.name}** ${moodEmoji}: *"${response}"*`);
    }
    return message.reply(`Use \`/talk\` to talk to your AI — you have ${entities.length} entities. The slash command lets you choose which one.`);
  }

  // ---- gunshop / gs ----
  if (commandName === 'gunshop' || commandName === 'gs') {
    if (needsAccount()) return;
    const { getGangByMember } = require('./utils/gangDb');
    const { getGunShop } = require('./utils/gunDb');
    const gang = getGangByMember(message.author.id);
    if (!gang) return message.reply(`🔒 The gun shop is **gang members only**. Join a gang first with \`/gang create\` or get invited.`);
    const shop = getGunShop();
    const RARITY_E = { Common:'⚪', Uncommon:'🟢', Rare:'🔵', Epic:'🟣', Legendary:'🟠', Mythic:'🔴' };
    const lines = shop.guns.filter(g=>g.enabled!==false).map(g=>`${g.emoji} **${g.name}** ${RARITY_E[g.rarity]||''} — $${g.price.toLocaleString()} | Dmg: ${g.damage[0]}-${g.damage[1]} | ID: \`${g.id}\``);
    return message.reply({ embeds: [new EmbedBuilder()
      .setColor(0xff3b3b)
      .setTitle(`🔫 Gang Gun Shop ${gang.color}`)
      .setDescription(lines.join('\n') || 'No weapons available.')
      .setFooter({ text: `Use ${prefix}gunbuy <id> to purchase` })
    ]});
  }

  // ---- gunbuy / gb ----
  if (commandName === 'gunbuy' || commandName === 'gb') {
    if (needsAccount()) return;
    const { getGangByMember } = require('./utils/gangDb');
    const { getGunShop, getGunById, getGunInventory, saveGunInventory } = require('./utils/gunDb');
    const gang = getGangByMember(message.author.id);
    if (!gang) return message.reply(`🔒 Gun shop is gang members only.`);
    const gunId = args[0]?.toLowerCase();
    if (!gunId) return message.reply(`Usage: \`${prefix}gunbuy <gun_id>\` — use \`${prefix}gunshop\` to see IDs.`);
    const gun = getGunById(gunId);
    if (!gun || gun.enabled === false) return message.reply(`❌ \`${gunId}\` not found. Check \`${prefix}gunshop\` for valid IDs.`);
    const user = getOrCreateUser(message.author.id);
    if (user.wallet < gun.price) return message.reply(`❌ Need **$${gun.price.toLocaleString()}**, you have **$${user.wallet.toLocaleString()}**.`);
    user.wallet -= gun.price;
    const inv = getGunInventory(message.author.id);
    inv.push({ gunId, boughtAt: Date.now(), ammo: gun.capacity * 3 });
    saveGunInventory(message.author.id, inv);
    saveUser(message.author.id, user);
    return message.reply(`${gun.emoji} **${gun.name}** purchased for **$${gun.price.toLocaleString()}**! 📦 ${gun.capacity*3} rounds loaded. Use \`${prefix}shoot @user\` to fire.`);
  }

  // ---- guns / arsenal ----
  if (commandName === 'guns' || commandName === 'arsenal') {
    if (needsAccount()) return;
    const { getGunInventory, getGunById, getHealth, getStatus, MAX_HP } = require('./utils/gunDb');
    const inv    = getGunInventory(message.author.id);
    const health = getHealth(message.author.id);
    const status = getStatus(health.hp);
    const hpBar  = '█'.repeat(Math.floor(health.hp/10))+'░'.repeat(10-Math.floor(health.hp/10));
    const lines  = inv.length ? inv.map(i=>{ const g=getGunById(i.gunId); return g?`${g.emoji} **${g.name}** — 📦 ${i.ammo} rounds`:'❓ Unknown'; }) : ['*Empty — use '+prefix+'gunshop*'];
    return message.reply({ embeds: [new EmbedBuilder()
      .setColor(status.color)
      .setTitle('🔫 Your Arsenal')
      .addFields(
        { name:`${status.label} [${hpBar}] ${health.hp}/${MAX_HP}`, value:status.desc, inline:false },
        { name:'🔫 Weapons', value:lines.join('\n'), inline:false },
        { name:'💀 Deaths',  value:(health.deathCount||0).toString(), inline:true },
      )
    ]});
  }

  // ---- health / hp ----
  if (commandName === 'health' || commandName === 'hp') {
    const target = message.mentions.users.first() || message.author;
    const { getHealth, getStatus, MAX_HP } = require('./utils/gunDb');
    const health = getHealth(target.id);
    const status = getStatus(health.hp);
    const hpBar  = '█'.repeat(Math.floor(health.hp/10))+'░'.repeat(10-Math.floor(health.hp/10));
    const jailed = health.hospitalUntil && Date.now() < health.hospitalUntil;
    const minsLeft = jailed ? Math.ceil((health.hospitalUntil-Date.now())/60000) : 0;
    return message.reply({ embeds: [new EmbedBuilder()
      .setColor(status.color)
      .setTitle(`${status.label} — ${target.id===message.author.id?'Your':target.username+'\'s'} Health`)
      .setDescription(`\`[${hpBar}] ${health.hp}/${MAX_HP}\`\n*${status.desc}*`)
      .addFields(
        { name:'💀 Deaths', value:(health.deathCount||0).toString(), inline:true },
        { name:'Status', value:jailed?`🏥 Down ${minsLeft}m`:status.label, inline:true },
      )
    ]});
  }

  // ---- shoot / fire ----
  if (commandName === 'shoot' || commandName === 'fire') {
    if (needsAccount()) return;
    const target = message.mentions.users.first();
    if (!target) return message.reply(`Usage: \`${prefix}shoot @user\``);
    if (target.id === message.author.id) return message.reply("You can't shoot yourself.");
    const { getGunInventory, saveGunInventory, getGunById, getHealth, saveHealth, getStatus, MAX_HP } = require('./utils/gunDb');
    const inv = getGunInventory(message.author.id);
    if (!inv.length) return message.reply(`❌ No weapons! Use \`${prefix}gunshop\` to buy one.`);
    const gunEntry = inv[0];
    const gun = getGunById(gunEntry.gunId);
    if (!gun) return message.reply('❌ Your weapon is invalid.');
    if ((gunEntry.ammo||0) <= 0) return message.reply(`📭 **${gun.name}** is out of ammo! Buy more guns from \`${prefix}gunshop\`.`);
    gunEntry.ammo--;
    saveGunInventory(message.author.id, inv);

    const hit  = Math.random() < gun.accuracy;
    const crit = hit && Math.random() < 0.20;
    let damage = 0, outcomeType = 'miss';
    if (hit) {
      damage = gun.damage[0] + Math.floor(Math.random()*(gun.damage[1]-gun.damage[0]));
      if (crit) damage = Math.floor(damage*1.75);
      outcomeType = damage < 15 ? 'graze' : crit ? 'critical' : 'hit';
    }

    const targetHealth = getHealth(target.id);
    let newHp = Math.max(0, (targetHealth.hp||MAX_HP) - damage);
    let died  = false;
    if (damage > 0 && newHp <= 0) { died=true; outcomeType='kill'; newHp=0; targetHealth.deathCount=(targetHealth.deathCount||0)+1; targetHealth.hospitalUntil=Date.now()+15*60*1000; }
    targetHealth.hp=newHp; targetHealth.status=died?'dead':newHp<=20?'critical':newHp<=50?'injured':'alive';
    saveHealth(target.id, targetHealth);

    const { addHeat: ah } = require('./utils/police');
    if (!isPurgeActive(message.guildId)) ah(message.author.id, died?40:damage>30?20:8, 'shooting');

    let stolen=0;
    if (died) {
      const victim=getOrCreateUser(target.id); stolen=Math.floor(victim.wallet*0.25); victim.wallet=Math.max(0,victim.wallet-stolen);
      const shooter=getOrCreateUser(message.author.id); shooter.wallet+=stolen;
      saveUser(target.id,victim); saveUser(message.author.id,shooter);
    }

    const status  = getStatus(newHp);
    const hpBar   = '█'.repeat(Math.floor(newHp/10))+'░'.repeat(10-Math.floor(newHp/10));
    const msgs    = { miss:['Miss!','Went wide.'], graze:['Graze!','Barely caught them.'], hit:['Hit!','Clean shot.'], critical:['CRITICAL HIT!','Devastating!'], kill:['💀 ELIMINATED!','They\'re down.'] };
    const outcomeMsg = msgs[outcomeType]?.[Math.floor(Math.random()*2)]||'';

    const embed = new EmbedBuilder()
      .setColor(died?0x111111:!hit?0x444444:0xff6600)
      .setTitle(`${gun.emoji} ${outcomeMsg}`)
      .setDescription(!hit ? `**${gun.name}** fired at <@${target.id}> — missed!` : `**${gun.name}** hit <@${target.id}> for **${damage} damage**!`)
      .addFields({ name:`<@${target.id}> HP`, value:`[${hpBar}] ${newHp}/${MAX_HP} — ${status.label}`, inline:true },
                 { name:'📦 Ammo', value:`${gunEntry.ammo} rounds`, inline:true });
    if (died && stolen>0) embed.addFields({ name:'💰 Looted', value:`$${stolen.toLocaleString()}`, inline:true });
    return message.reply({ embeds:[embed] });
  }

  // ---- medkit / heal ----
  if (commandName === 'medkit' || commandName === 'heal') {
    if (needsAccount()) return;
    const amount = parseInt(args[0]);
    if (!amount || amount < 10) return message.reply(`Usage: \`${prefix}medkit <amount>\` (min $10)`);
    const { getHealth, saveHealth, getStatus, MAX_HP } = require('./utils/gunDb');
    const health = getHealth(message.author.id);
    if (health.hospitalUntil && Date.now() < health.hospitalUntil) {
      return message.reply(`🏥 You're down for **${Math.ceil((health.hospitalUntil-Date.now())/60000)} more minutes**. A medkit can't fix this.`);
    }
    if (health.hp >= MAX_HP) return message.reply('You\'re already at full health!');
    const user = getOrCreateUser(message.author.id);
    if (user.wallet < amount) return message.reply(`❌ Only have **$${user.wallet.toLocaleString()}**.`);
    const healAmt = Math.floor(amount/2);
    user.wallet -= amount; health.hp = Math.min(MAX_HP,(health.hp||0)+healAmt);
    health.status = health.hp<=20?'critical':health.hp<=50?'injured':'alive';
    saveUser(message.author.id,user); saveHealth(message.author.id,health);
    const status = getStatus(health.hp);
    const hpBar  = '█'.repeat(Math.floor(health.hp/10))+'░'.repeat(10-Math.floor(health.hp/10));
    return message.reply({ embeds:[new EmbedBuilder().setColor(status.color).setTitle('💊 Medkit Used').setDescription(`Spent **$${amount.toLocaleString()}** — healed **+${healAmt} HP**`).addFields({ name:'❤️ HP', value:`[${hpBar}] ${health.hp}/${MAX_HP}`, inline:true },{ name:'Status', value:status.label, inline:true })] });
  }


  // ---- info / guide ----
  if (commandName === 'info' || commandName === 'guide') {
    const infoCmd = require('./commands/fun/info.js');
    const IPAGES  = infoCmd.PAGES || [];
    if (!IPAGES.length) return message.reply('Use `/info` for the full guide!');
    let page = 0;
    const { EmbedBuilder: EB2, ActionRowBuilder: AR2, ButtonBuilder: BB2, ButtonStyle: BS2 } = require('discord.js');
    const buildIEmbed = (p) => {
      const pg = IPAGES[p];
      return new EB2().setColor(pg.color).setTitle(pg.title).setDescription(pg.desc).addFields(pg.fields).setFooter({ text:`Page ${p+1}/${IPAGES.length} — Use ◀ ▶ to navigate` });
    };
    const buildIRow = (p) => new AR2().addComponents(
      new BB2().setCustomId('infop_prev').setLabel('◀').setStyle(BS2.Secondary).setDisabled(p===0),
      new BB2().setCustomId('infop_next').setLabel('▶').setStyle(BS2.Secondary).setDisabled(p>=IPAGES.length-1),
    );
    const sent = await message.reply({ embeds:[buildIEmbed(page)], components:[buildIRow(page)], fetchReply:true });
    const col  = sent.createMessageComponentCollector({ time:5*60*1000 });
    col.on('collect', async btn => {
      if (btn.user.id !== message.author.id) return btn.reply({ content:'Not your guide.', ephemeral:true });
      if (btn.customId==='infop_prev') page=Math.max(0,page-1);
      if (btn.customId==='infop_next') page=Math.min(IPAGES.length-1,page+1);
      await btn.update({ embeds:[buildIEmbed(page)], components:[buildIRow(page)] });
    });
    col.on('end', ()=>sent.edit({ components:[] }).catch(()=>{}));
    return;
  }

  // ---- jailcreate ----
  if (commandName === 'jailcreate') {
    return message.reply('Use `/jailcreate` slash command — requires bot permissions to create channels and roles.');
  }

  // ---- jail (!jail @user <mins> <reason>) ----
  if (commandName === 'jail') {
    if (!message.member.permissions.has('ManageMessages')) return message.reply('❌ You need **Manage Messages** permission.');
    const target = message.mentions.users.first();
    const mins   = parseInt(args[1]) || 10;
    const reason = args.slice(2).join(' ') || 'Jailed by staff';
    if (!target) return message.reply(`Usage: \`${prefix}jail @user <minutes> <reason>\``);
    const { getConfig } = require('./utils/db');
    const { jailUser }  = require('./commands/moderation/jail');
    const config = getConfig(message.guild.id);
    const result = await jailUser(message.guild, target.id, mins, reason, config, message.author.id);
    if (!result.ok) return message.reply(`❌ ${result.error}`);
    return message.reply({ embeds:[new EmbedBuilder().setColor(0xff3b3b).setTitle('🔒 User Jailed').setDescription(`<@${target.id}> jailed for **${mins}m** — *${reason}*`)] });
  }

  // ---- unjail (!unjail @user) ----
  if (commandName === 'unjail' || commandName === 'release') {
    if (!message.member.permissions.has('ManageMessages')) return message.reply('❌ You need **Manage Messages** permission.');
    const target = message.mentions.users.first();
    if (!target) return message.reply(`Usage: \`${prefix}unjail @user\``);
    const { getConfig } = require('./utils/db');
    const { releaseUser } = require('./commands/moderation/jail');
    const config = getConfig(message.guild.id);
    await releaseUser(message.guild, target.id, config, message.author.id);
    return message.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setDescription(`🟢 <@${target.id}> has been released.`)] });
  }

  // ---- overview ----
  if (commandName === 'overview' || commandName === 'stats' || commandName === 'serverstats') {
    const overviewCmd = require('./commands/moderation/overview.js');
    return overviewCmd.executePrefix(message);
  }

  // ---- pay ----
  if (commandName === 'pay') {
    if (needsAccount()) return;
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || !amount || amount < 1) return message.reply(`Usage: \`${prefix}pay @user <amount>\``);
    if (target.id === message.author.id) return message.reply("You can't pay yourself.");
    const { hasAccount: ha } = require('./utils/db');
    if (!ha(target.id)) return message.reply(`<@${target.id}> doesn't have an account yet.`);
    const sndr = getOrCreateUser(message.author.id);
    if (sndr.wallet < amount) return message.reply(`You only have **$${sndr.wallet.toLocaleString()}** in your wallet.`);
    sndr.wallet -= amount;
    saveUser(message.author.id, sndr);
    const rcvr = getOrCreateUser(target.id);
    rcvr.wallet += amount;
    saveUser(target.id, rcvr);
    return message.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('💸 Payment Sent').setDescription(`You sent **$${amount.toLocaleString()}** to <@${target.id}>!`).addFields({ name:'Your Wallet', value:`$${sndr.wallet.toLocaleString()}`, inline:true },{ name:'Their Wallet', value:`$${rcvr.wallet.toLocaleString()}`, inline:true })] });
  }

  // ---- wire / give / sell ----
  if (['wire','give','sell'].includes(commandName)) {
    return message.reply(`Use \`/${commandName}\` slash command — requires user mention autocomplete.`);
  }

  if (['coincreate','rugpull','coinrug','coinclose','coincontrol','coinpump','liquidate','coincollect'].includes(commandName)) {
    const cmdMap = {
      coincreate:  './commands/economy/coincreate.js',
      rugpull:     './commands/economy/rugpull.js',
      coinrug:     './commands/economy/rugpull.js',
      coinclose:   './commands/economy/rugpull.js',
      coincontrol: './commands/economy/coincontrol.js',
      coinpump:    './commands/economy/coincontrol.js',
      liquidate:   './commands/economy/liquidate.js',
      coincollect: './commands/economy/liquidate.js',
    };
    return message.reply(`Use \`/${cmdMap[commandName] ? commandName : 'coincreate'}\` slash command — these commands require autocomplete to work properly.`);
  }

});

// ---- PURGE WATCHER ----
// Checks every 5 seconds if purge state changed for ANY guild
// and sends @everyone announcement in that guild's channel
const lastPurgeStates = new Map(); // guildId -> last known purge state

setInterval(async () => {
  try {
    const { getConfig } = require('./utils/db');
    const { purgeEmbed } = require('./utils/embeds');

    // Iterate every guild the bot is in
    for (const [guildId] of client.guilds.cache) {
      const config       = getConfig(guildId);
      const currentState = !!config.purgeActive;
      const lastState    = lastPurgeStates.get(guildId);

      // First tick — just record state, don't announce
      if (lastState === undefined) { lastPurgeStates.set(guildId, currentState); continue; }

      // No change
      if (currentState === lastState) continue;

      // State changed — update and announce
      lastPurgeStates.set(guildId, currentState);

      const channelId = config.purgeChannelId;
      if (!channelId) continue;

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) continue;

      await channel.send({
        content: '@everyone',
        embeds: [purgeEmbed(currentState)],
        allowedMentions: { parse: ['everyone'] },
      });
    }
  } catch(e) { console.error('Purge watcher error:', e.message); }
}, 5000);

// ---- JAIL RELEASE WATCHER ----
setInterval(async () => {
  try {
    const { getAllPoliceRecords, savePoliceRecord } = require('./utils/gangDb');
    const { getConfig } = require('./utils/db');
    const { releaseUser } = require('./commands/moderation/jail');
    const records = getAllPoliceRecords ? getAllPoliceRecords() : {};
    const now = Date.now();
    for (const [userId, rec] of Object.entries(records)) {
      if (!rec.jailUntil || rec.jailUntil > now) continue;
      // Sentence expired — release from all guilds
      for (const [, guild] of client.guilds.cache) {
        const config = getConfig(guild.id);
        if (!config.prisonRoleId) continue;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        const role = guild.roles.cache.get(config.prisonRoleId);
        if (role && member.roles.cache.has(role.id)) {
          await releaseUser(guild, userId, config, null);
        }
      }
    }
  } catch(e) { console.error('Jail watcher error:', e.message); }
}, 15_000); // check every 15 seconds

// ---- PASSIVE INCOME TICK ENGINE ----
const { tickPassiveIncome } = require('./utils/effects');
setInterval(tickPassiveIncome, 60_000);
tickPassiveIncome();

// ---- STOCK PRICE TICK ENGINE ----
// ---- STOCK PRICE TICK ENGINE ----
const stockMomentum = {};

// Built-in default coins
const DEFAULT_COIN_PROFILES = {
  DOGE2:  { vol:0.18, drift:0.002,  crashChance:0.04, moonChance:0.05, crashMag:0.45, moonMag:1.80, floor:0.01,  name:'Doge 2.0',       emoji:'🐕', color:'#f5c518', desc:'Such wow. Much gains. Very moon.' },
  PEPE:   { vol:0.30, drift:-0.001, crashChance:0.06, moonChance:0.04, crashMag:0.60, moonMag:2.50, floor:0.001, name:'PepeCoin',        emoji:'🐸', color:'#2ecc71', desc:"Feels good man. Until it doesn't." },
  RUGPUL: { vol:0.45, drift:-0.008, crashChance:0.10, moonChance:0.03, crashMag:0.80, moonMag:3.00, floor:0.001, name:'RugPull Finance',  emoji:'🪤', color:'#ff3b3b', desc:'This is fine. Everything is fine.' },
  MOON:   { vol:0.25, drift:0.005,  crashChance:0.03, moonChance:0.08, crashMag:0.40, moonMag:4.00, floor:0.01,  name:'MoonShot',        emoji:'🚀', color:'#00d2ff', desc:'To the moon. Or the floor.' },
  BODEN:  { vol:0.12, drift:0.001,  crashChance:0.02, moonChance:0.02, crashMag:0.30, moonMag:1.40, floor:0.10,  name:'BodenBucks',      emoji:'🦅', color:'#9b59b6', desc:'Not financial advice. Literally ever.' },
  CHAD:   { vol:0.35, drift:0.003,  crashChance:0.05, moonChance:0.07, crashMag:0.55, moonMag:3.50, floor:0.001, name:'ChadToken',       emoji:'💪', color:'#ff6b35', desc:'Alpha moves only.' },
};

let COIN_PROFILES = { ...DEFAULT_COIN_PROFILES };

// Load custom coins from MongoDB
async function loadCustomCoins() {
  try {
    const { col } = require('./utils/mongo');
    const c    = await col('customCoins');
    const docs = await c.find({}).toArray();
    for (const d of docs) {
      const id = d._id;
      COIN_PROFILES[id] = { ...d };
      if (!stockMomentum[id]) stockMomentum[id] = 0;
    }
    if (docs.length) console.log(`📈 Loaded ${docs.length} custom coins`);
  } catch(e) { console.error('loadCustomCoins error:', e.message); }
}

function getCoinProfiles() { return COIN_PROFILES; }

async function saveCustomCoin(id, profile) {
  COIN_PROFILES[id] = profile;
  if (!stockMomentum[id]) stockMomentum[id] = 0;
  try {
    const { col } = require('./utils/mongo');
    const c = await col('customCoins');
    await c.replaceOne({ _id: id }, { _id: id, ...profile }, { upsert: true });
  } catch(e) { console.error('saveCustomCoin error:', e.message); }
}

async function deleteCustomCoin(id) {
  delete COIN_PROFILES[id];
  delete stockMomentum[id];
  try {
    const { col } = require('./utils/mongo');
    const c = await col('customCoins');
    await c.deleteOne({ _id: id });
  } catch(e) { console.error('deleteCustomCoin error:', e.message); }
}

module.exports.getCoinProfiles  = getCoinProfiles;
module.exports.saveCustomCoin   = saveCustomCoin;
module.exports.deleteCustomCoin = deleteCustomCoin;

function tickStockPrices() {
  const { col } = require('./utils/mongo');

  col('stockPrices').then(async pc => {
    const doc = await pc.findOne({ _id: 'prices' }).catch(()=>null);
    const prices = doc ? { ...doc } : {};
    delete prices._id;

    const hc = await col('stockHistory');
    const hdoc = await hc.findOne({ _id: 'history' }).catch(()=>null);
    const history = hdoc ? { ...hdoc } : {};
    delete history._id;

    Object.entries(COIN_PROFILES).forEach(([id, profile]) => {
      if (!stockMomentum[id]) stockMomentum[id] = 0;
      const current = prices[id] || (10 + Math.random() * 490);
      const crashRoll = Math.random();
      const moonRoll  = Math.random();
      let multiplier = 1;

      if (crashRoll < profile.crashChance) {
        const crashAmt = profile.crashMag * (0.5 + Math.random() * 0.5);
        multiplier = 1 - crashAmt;
        stockMomentum[id] = -0.3;
      } else if (moonRoll < profile.moonChance) {
        const moonAmt = (profile.moonMag - 1) * (0.4 + Math.random() * 0.8);
        multiplier = 1 + moonAmt;
        stockMomentum[id] = 0.3;
      } else {
        const noise    = (Math.random() - 0.5) * 2 * profile.vol;
        const momentum = stockMomentum[id] * 0.6;
        multiplier = 1 + noise + profile.drift + momentum;
        stockMomentum[id] *= 0.75;
        stockMomentum[id] += (Math.random() - 0.5) * 0.05;
        stockMomentum[id]  = Math.max(-0.5, Math.min(0.5, stockMomentum[id]));
      }

      prices[id] = Math.max(profile.floor, current * multiplier);
      if (!history[id]) history[id] = [];
      history[id].push(Math.round(prices[id] * 10000) / 10000);
      if (history[id].length > 1440) history[id] = history[id].slice(-1440);
    });

    await pc.replaceOne({ _id:'prices' }, { _id:'prices', ...prices }, { upsert:true });
    await hc.replaceOne({ _id:'history'}, { _id:'history',...history}, { upsert:true });
  }).catch(()=>{});
}

loadCustomCoins().then(() => setInterval(tickStockPrices, 10_000));

// ---- LOTTERY TICK ENGINE ----
const LOTTERY_FILE = path.join(__dirname, 'data/lottery.json');

async function tickLottery() {
  try {
    if (!fs.existsSync(LOTTERY_FILE)) return;
    const lottery = JSON.parse(fs.readFileSync(LOTTERY_FILE, 'utf8'));
    if (!lottery.active || lottery.drawAt > Date.now()) return;
    if (!lottery.tickets.length || lottery.pot <= 0) {
      // No tickets — reset timer
      const config = require('./utils/db').getConfig();
      lottery.drawAt = Date.now() + (config.lottery?.intervalHours ?? 24) * 3600000;
      fs.writeFileSync(LOTTERY_FILE, JSON.stringify(lottery, null, 2));
      return;
    }

    // Apply bonus pot randomization from config
    const minBonus = config.lottery?.minBonus || 0;
    const maxBonus = config.lottery?.maxBonus || 0;
    const minPot   = config.lottery?.minPot   || 0;
    if (maxBonus > minBonus) lottery.pot += Math.floor(minBonus + Math.random() * (maxBonus - minBonus));
    if (lottery.pot < minPot) lottery.pot = minPot;

    // Pick a winner weighted by ticket count
    const totalTickets = lottery.tickets.reduce((s, t) => s + t.count, 0);
    let roll = Math.random() * totalTickets;
    let winner = lottery.tickets[lottery.tickets.length - 1];
    for (const entry of lottery.tickets) {
      roll -= entry.count;
      if (roll <= 0) { winner = entry; break; }
    }

    const db      = require('./utils/db');
    const config  = db.getConfig();
    const winUser = db.getOrCreateUser(winner.userId);
    winUser.wallet += lottery.pot;
    db.saveUser(winner.userId, winUser);

    // Announce in purge channel if set
    const channelId = config.purgeChannelId;
    if (channelId) {
      const { EmbedBuilder } = require('discord.js');
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        await channel.send({ embeds: [new EmbedBuilder()
          .setColor(0xf5c518)
          .setTitle('🎟️ Lottery Drawing!')
          .setDescription(`<@${winner.userId}> won the lottery and takes home **$${lottery.pot.toLocaleString()}**!`)
          .setTimestamp()
        ]});
      }
    }

    // Reset lottery
    lottery.lastWinner = winner.userId;
    lottery.lastPot    = lottery.pot;
    lottery.pot        = 0;
    lottery.tickets    = [];
    lottery.drawAt     = Date.now() + (config.lottery?.intervalHours ?? 24) * 3600000;
    fs.writeFileSync(LOTTERY_FILE, JSON.stringify(lottery, null, 2));

  } catch (e) { console.error('Lottery tick error:', e); }
}

setInterval(tickLottery, 60_000);

// ---- BUSINESS REVENUE TICK ENGINE ----
setInterval(() => {
  try {
    const bizDb = require('./utils/bizDb');
    const all   = bizDb.getAllBusinesses();
    const now   = Date.now();
    let changed = false;
    for (const ownerId in all) {
      const biz    = all[ownerId];
      const income = bizDb.calcIncome(biz);
      biz.revenue  = (biz.revenue || 0) + income;
      changed = true;
    }
    if (changed) {
      const fsb  = require('fs');
      const pathb = require('path');
      fsb.writeFileSync(pathb.join(__dirname, 'data/businesses.json'), JSON.stringify(all, null, 2));
    }
  } catch {}
}, 60_000);

// ---- CUSTOMER ALGORITHM TICK ----
const { tickCustomers, CUSTOMER_VISIT_INTERVAL } = require('./utils/customerAlgo');
setInterval(async () => {
  const cfg = require('./utils/db').getConfig();
  await tickCustomers(client, cfg.purgeChannelId);
}, CUSTOMER_VISIT_INTERVAL);

// ---- CONSUME DEBUFF TICK ----
const { tickConsumeDebuffs } = require('./utils/consumeBuffs');
setInterval(tickConsumeDebuffs, 60_000);

// ---- POLICE HEAT DECAY ----
const { decayHeat } = require('./utils/police');
setInterval(decayHeat, 60_000);

// ---- GANG WAR RESOLUTION ----
setInterval(async () => {
  try {
    const { getAllWars, deleteWar, getGang, saveGang } = require('./utils/gangDb');
    const { EmbedBuilder } = require('discord.js');
    const wars = getAllWars();
    const cfg  = require('./utils/db').getConfig();
    for (const warId in wars) {
      const war = wars[warId];
      if (Date.now() < war.endsAt) continue;
      // Resolve
      const gang1 = getGang(war.gang1Id);
      const gang2 = getGang(war.gang2Id);
      const gang1Wins = (war.gang1Score || 0) >= (war.gang2Score || 0);
      const winner    = gang1Wins ? gang1 : gang2;
      const loser     = gang1Wins ? gang2 : gang1;

      if (winner) { winner.wins = (winner.wins||0)+1; winner.rep = (winner.rep||0)+50; if (war.bet>0) winner.bank=(winner.bank||0)+war.bet*2; await saveGang(winner.id, winner); }
      if (loser)  { loser.losses=(loser.losses||0)+1; if(war.bet>0&&loser.bank>=war.bet){loser.bank-=war.bet;}  await saveGang(loser.id,  loser);  }

      await deleteWar(warId);

      if (cfg.purgeChannelId) {
        const channel = await client.channels.fetch(cfg.purgeChannelId).catch(()=>null);
        if (channel) {
          await channel.send({ embeds: [new EmbedBuilder()
            .setColor(0xff3b3b)
            .setTitle('⚔️ War Over!')
            .setDescription(`**${winner?.name || 'Unknown'}** defeated **${loser?.name || 'Unknown'}**!\n\nFinal: ${war.gang1Score} vs ${war.gang2Score}${war.bet>0?`\n💰 Winner takes $${(war.bet*2).toLocaleString()}`:''}`)
          ]});
        }
      }
    }
  } catch(e) { console.error('War resolution error:', e); }
}, 60_000);

// ---- PET CARE TICK ENGINE (every hour) ----
setInterval(() => {
  try {
    const { getAllPets, PET_TYPES, calcPetStats } = require('./utils/petDb');
    const fsp   = require('fs');
    const pathp = require('path');
    const all   = getAllPets();
    let changed = false;
    for (const userId in all) {
      const pet  = all[userId];
      const type = PET_TYPES[pet.type];
      if (!type) continue;
      pet.hunger    = Math.max(0, (pet.hunger    || 100) - type.hungerDrain);
      pet.happiness = Math.max(0, (pet.happiness || 100) - type.happinessDrain);
      if (pet.hunger === 0) {
        const maxHp = calcPetStats(pet).hp;
        pet.hp      = Math.max(0, (pet.hp || maxHp) - Math.floor(maxHp * 0.05));
      }
      all[userId] = pet;
      changed = true;
    }
    if (changed) fsp.writeFileSync(pathp.join(__dirname, 'data/pets.json'), JSON.stringify(all, null, 2));
  } catch(e) { console.error('Pet tick error:', e); }
}, 60 * 60 * 1000);

// Export client so dashboard server can send Discord messages
require('./index.client').set(client);

require('./dashboard/server.js');

// ---- LOGIN ----
client.login(process.env.TOKEN);
