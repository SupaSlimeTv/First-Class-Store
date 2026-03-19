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
        { name: '💰 Economy',     value: [`${p}bal`, `${p}dep <amt>`, `${p}with <amt>`, `${p}daily`, `${p}rob @user`, `${p}shop`, `${p}inv`, `${p}collect`, `${p}work`, `${p}beg`, `${p}slots <bet>`, `${p}duel @user <amt>`, `${p}lb`].join(' · '), inline: false },
        { name: '📈 Market',      value: [`${p}market`, `${p}invest <coin> <amt>`, `${p}cashout <coin>`, `${p}portfolio`].join(' · '), inline: false },
        { name: '🎮 Games',       value: [`${p}cf <bet>`, `${p}roll`, `${p}8ball <q>`, `${p}rps <choice>`, `${p}lottery`, `/blackjack`, `/roulette`, `/slots`].join(' · '), inline: false },
        { name: '🏢 Entrepreneur',value: [`${p}biz`, `${p}bizview`, `${p}bizcollect`, `${p}bizupgrade`].join(' · '), inline: false },
        { name: '🏴 Gangs',       value: [`${p}gang`, `${p}ganginfo`, `${p}gangcrime <crime>`, `${p}gangwar`, `${p}gangs`, `${p}wl`].join(' · '), inline: false },
        { name: '🤖 AI',          value: [`${p}myai`, `${p}talk <entity>`].join(' · '), inline: false },
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
const { tickPassiveIncome } = require('./utils/effects');
setInterval(tickPassiveIncome, 60_000);
tickPassiveIncome();

// ---- STOCK PRICE TICK ENGINE ----
const stockFs   = require('fs');
const stockPath = require('path');
const PRICES_FILE  = stockPath.join(__dirname, 'data/stockPrices.json');
const HISTORY_FILE = stockPath.join(__dirname, 'data/stockHistory.json');
const STOCK_COINS  = ['DOGE2','PEPE','RUGPUL','MOON','BODEN','CHAD'];

function tickStockPrices() {
  let prices  = {};
  let history = {};
  try { prices  = JSON.parse(stockFs.readFileSync(PRICES_FILE,  'utf8')); } catch {}
  try { history = JSON.parse(stockFs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}

  STOCK_COINS.forEach(id => {
    const current = prices[id] || (50 + Math.random() * 450);
    const swing   = (Math.random() - 0.5) * 0.25;
    prices[id]    = Math.max(1, current * (1 + swing));

    // Keep last 1440 ticks (~4 hours at 10s intervals)
    if (!history[id]) history[id] = [];
    history[id].push(prices[id]);
    if (history[id].length > 1440) history[id] = history[id].slice(-1440);
  });

  stockFs.writeFileSync(PRICES_FILE,  JSON.stringify(prices,  null, 2));
  stockFs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

if (!stockFs.existsSync(PRICES_FILE)) tickStockPrices();
setInterval(tickStockPrices, 10_000);

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

      if (winner) { winner.wins = (winner.wins||0)+1; winner.rep = (winner.rep||0)+50; if (war.bet>0) winner.bank=(winner.bank||0)+war.bet*2; saveGang(winner.id, winner); }
      if (loser)  { loser.losses=(loser.losses||0)+1; if(war.bet>0&&loser.bank>=war.bet){loser.bank-=war.bet;}  saveGang(loser.id,  loser);  }

      deleteWar(warId);

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
require('./dashboard/server.js');

// ---- LOGIN ----
client.login(process.env.TOKEN);
