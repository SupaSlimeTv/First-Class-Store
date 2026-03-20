const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PAGES = [
  {
    title: '📖 Welcome to First Class Store',
    color: 0xff3b3b,
    desc: `First Class Store is a full economy bot with gangs, pets, guns, businesses, stocks, and more.\n\nUse the arrows below to flip through every feature. Type \`!open account\` or use any command to get started.`,
    fields: [
      { name:'💵 Starting Balance', value:'Every new user gets **$500** in their wallet when they open an account.', inline:false },
      { name:'📌 Prefix', value:'All commands work with `/` slash commands **and** the `!` prefix (e.g. `!bal`, `!daily`).', inline:false },
      { name:'🏦 Wallet vs Bank', value:'Your **wallet** is exposed — it can be robbed or drained by items. Your **bank** is safe. Deposit money to protect it.', inline:false },
    ],
  },
  {
    title: '💰 Economy Commands',
    color: 0x2ecc71,
    desc: 'The core economy system. Earn, save, spend, and lose money.',
    fields: [
      { name:'/balance (!bal)', value:'Check your wallet and bank balance.', inline:true },
      { name:'/daily (!daily)', value:'Claim your daily reward. Streaks give bonus multipliers up to 3×.', inline:true },
      { name:'/work (!work)', value:'Work a random job for $50–$250. 1 hour cooldown.', inline:true },
      { name:'/deposit (!dep)', value:'Move money from wallet → bank.', inline:true },
      { name:'/withdraw (!with)', value:'Move money from bank → wallet.', inline:true },
      { name:'/rob @user (!rob)', value:'Attempt to steal from someone\'s wallet. 65% base success. Protected roles are immune.', inline:true },
      { name:'/beg (!beg)', value:'Beg for money. No cooldown but risky — you might lose money.', inline:true },
      { name:'/leaderboard (!lb)', value:'See the richest players on the server.', inline:true },
      { name:'/collect (!collect)', value:'Collect income from your assigned roles (set by admin).', inline:true },
    ],
  },
  {
    title: '🎮 Games & Gambling',
    color: 0x9b59b6,
    desc: 'Risk your wallet for big rewards.',
    fields: [
      { name:'/slots (!slots) <bet>', value:'Spin the slot machine. Match 3 for jackpot, 2 for half back.', inline:true },
      { name:'/coinflip (!cf) <bet>', value:'Heads or tails — double or nothing.', inline:true },
      { name:'/duel @user <bet>', value:'Challenge someone to a duel. Winner takes the pot.', inline:true },
      { name:'/blackjack', value:'Play blackjack against the dealer. Get 21 or closer without busting.', inline:true },
      { name:'/roulette', value:'Bet on red, black, or a number.', inline:true },
      { name:'/roll (!roll)', value:'Roll dice. Optional number of sides.', inline:true },
      { name:'/8ball (!8ball)', value:'Ask the magic 8 ball a question.', inline:true },
      { name:'/rps (!rps)', value:'Rock paper scissors.', inline:true },
    ],
  },
  {
    title: '🎟️ Lottery & 📈 Stocks',
    color: 0xf5c518,
    desc: 'Two ways to gamble big.',
    fields: [
      { name:'🎟️ Lottery', value:'/lottery buy <tickets> — buy tickets\n/lottery info — see current pot and your odds\n\nWinner drawn on a timer set by the server owner. More tickets = better odds.', inline:false },
      { name:'📈 Stocks — 6 Memecoins', value:'**DOGE2** · **PEPE** · **RUGPUL** · **MOON** · **BODEN** · **CHAD**\n\nPrices update every 10 seconds with random volatility. Each coin has its own personality — some are stable, some crash and moon randomly.', inline:false },
      { name:'/invest (!invest)', value:'Invest $ from your wallet into a coin at current price.', inline:true },
      { name:'/cashout (!cashout)', value:'Sell your shares at current price. Can profit or lose.', inline:true },
      { name:'/portfolio (!portfolio)', value:'See all your active investments and current P&L.', inline:true },
      { name:'/market (!market)', value:'View live coin prices with charts.', inline:true },
    ],
  },
  {
    title: '🏢 Entrepreneur System',
    color: 0xff6b35,
    desc: 'Own and run a business. Earn passive income every minute.',
    fields: [
      { name:'/business start', value:'Open a business. Choose from 10 types. Costs money upfront.', inline:true },
      { name:'/business collect (!bizcollect)', value:'Collect your accumulated revenue.', inline:true },
      { name:'/business upgrade (!bizupgrade)', value:'Level up for higher income. More levels = more money.', inline:true },
      { name:'/business view (!biz)', value:'See your business stats, level, and employees.', inline:true },
      { name:'/hire @user (!hire)', value:'Hire someone as an employee. They earn 10% per collection.', inline:true },
      { name:'/fire @user (!fire)', value:'Remove an employee.', inline:true },
      { name:'/myjobs (!myjobs)', value:'See businesses you\'re employed at.', inline:true },
      { name:'/businesses (!businesses)', value:'Server-wide business rankings.', inline:true },
    ],
  },
  {
    title: '🏴 Gang System',
    color: 0xff3b3b,
    desc: 'Join or create a gang. Commit crimes, go to war, and build rep. Gang members unlock the **Gun Shop**.',
    fields: [
      { name:'/gang create', value:'Found a gang. Costs money. You become the leader.', inline:true },
      { name:'/ganginvite @user (!gi)', value:'Invite someone to your gang. They get a DM with Accept/Decline.', inline:true },
      { name:'/gangcrime (!crime)', value:'Commit a crime for your gang. Earns money + rep + heat. Street gangs get 6 crimes. Mafia unlocks 6 more.', inline:true },
      { name:'/gangwar challenge', value:'Challenge another gang to a 30-minute war. Members score points by attacking. Winner gets glory (and bets if staked).', inline:true },
      { name:'/gangwar attack', value:'Score points for your gang during an active war. Guns give bonus points.', inline:true },
      { name:'/gangupgrade (!gu)', value:'Upgrade your gang — police payroll, armory, safehouses, or convert to Mafia.', inline:true },
      { name:'/wantedlevel (!wl)', value:'Check your police heat level (0–100). Higher heat = more raid risk.', inline:true },
      { name:'/gangs', value:'Server-wide gang rankings by rep.', inline:true },
    ],
  },
  {
    title: '🔫 Gun Shop (Gang Members Only)',
    color: 0x888888,
    desc: 'Guns are **exclusive to gang members**. Join a gang to unlock the shop. Everyone can be shot regardless of gang status.',
    fields: [
      { name:'/gunshop (!gunshop)', value:'Browse all available weapons. Filtered by type: Pistol, SMG, Rifle, Shotgun, Sniper, Heavy.', inline:false },
      { name:'/gunbuy <gun> (!gunbuy)', value:'Buy a weapon with autocomplete. Ammo included.', inline:true },
      { name:'/guns (!guns)', value:'View your weapon inventory.', inline:true },
      { name:'/shoot @user (!shoot)', value:'Shoot another player. Hit = they lose wallet money based on damage. Miss = nothing happens.\n\nIf hit, target is **timed out** from bot commands temporarily.', inline:false },
      { name:'/health (!health)', value:'Check your or another player\'s health status.', inline:true },
      { name:'/medkit (!medkit)', value:'Spend money to restore HP.', inline:true },
      { name:'🔩 Auto Switches', value:'Some guns have an illegal auto switch — fires in bursts, slightly more damage. Check /gunshop for which guns have it.', inline:false },
      { name:'🛡️ Protection', value:'Shields and protected roles block all gun damage. Pet guard mode can also intercept shots.', inline:false },
    ],
  },
  {
    title: '🐾 Pet System',
    color: 0xff6b35,
    desc: 'Adopt a pet from the shop. Range from 🐹 Hamster to 🐲 World Serpent. Pets fight, defend, evolve, and level up.',
    fields: [
      { name:'/petshop (!petshop)', value:'Browse 10 pets by tier. Costs range from $500 to $1,000,000. Higher tier = more powerful.', inline:false },
      { name:'/pet feed', value:'Feed your pet using **Pet Food** from the item shop. Keeps it strong.', inline:true },
      { name:'/pet mission', value:'Send your pet on a mission to earn **XP** and **Pet Tokens**. 5 missions from Patrol to All-Out War. Higher missions need higher level.', inline:true },
      { name:'/pet upgrade <stat>', value:'Spend pet tokens to upgrade: ❤️ Health · 🛡️ Defense · 🧠 Intelligence · ⚔️ Attack. 5 levels each.', inline:false },
      { name:'/pet guard', value:'Toggle guard mode — pet defends you from attacks and can block shots. Pet takes damage instead of you.', inline:true },
      { name:'/pet evolve', value:'Evolve your pet at the required level into the next, more powerful form.', inline:true },
      { name:'/petattack @user', value:'Send your pet to steal money from someone\'s wallet, or battle their pet directly.', inline:true },
      { name:'/pets', value:'Server-wide pet power rankings.', inline:true },
    ],
  },
  {
    title: '🤖 AI Entities & ✨ Item Effects',
    color: 0x5865f2,
    desc: 'Buy special items from the shop with powerful effects.',
    fields: [
      { name:'🤖 AI Entities', value:'Some items spawn AI companions with moods and loyalty. Talk to them with `/talk`. Treat them well or they go **rogue** and work against you.\n\nArchetypes: 🤖 Robot · 📱 Phone · 🧠 Companion · 🚁 Drone · 💬 Assistant', inline:false },
      { name:'✨ Item Effect Types', value:'**Drain Wallet** — steal from target\n**Silence** — lock target out of bot\n**Hitman** — 50/50 rob or silence\n**Shield** — block incoming attacks\n**Passive Income** — earn $ over time\n**Consume** — edible buff (10 types)\n**Magic** — custom spell chain\n**Black Magic** — hex with backfire chance', inline:false },
      { name:'💊 Consume Buffs', value:'Eat/drink/inject items for timed buffs:\n🔫 Rob Boost · 💼 Work Boost · 🍀 Lucky · 🌡️ Crime Boost · 💰 Passive Boost · ⚡ Speed · 🎯 Focused · 🛡️ Shield · ☠️ Poisoned · 😵 High', inline:false },
      { name:'/status (!status)', value:'Check your currently active buffs and how long they last.', inline:true },
      { name:'/use <item>', value:'Use an item from your inventory.', inline:true },
    ],
  },
  {
    title: '📋 Rules & Important Notes',
    color: 0xf5c518,
    desc: 'Read these before playing.',
    fields: [
      { name:'💰 Economy Rules', value:'• No cheating or exploiting bugs — report them\n• Robbing, scamming, and attacks are part of the game\n• Protected role members cannot be robbed or attacked', inline:false },
      { name:'🏴 Gang Rules', value:'• Only gang members can access the gun shop\n• Gang crimes build police heat — too much heat = raid\n• Wars require at least 3 members on each side\n• Mafia conversion requires 50+ wins, $50k, 500 rep', inline:false },
      { name:'🔫 Gun Rules', value:'• Only gang members can BUY guns\n• Anyone can be SHOT — gang or not\n• Being shot silences you from commands temporarily\n• Shields and protected roles block all damage', inline:false },
      { name:'🐾 Pet Rules', value:'• Pets need Pet Food from the shop to stay fed\n• Starving pets lose HP over time\n• Guard mode ON = pet can block shots and attacks\n• Tokens are earned only through missions', inline:false },
      { name:'🚔 Police Heat', value:'• Heat builds from crimes and gang attacks\n• Heat decays 1 point per minute passively\n• Too much heat = police raid — you lose money and go to jail\n• Mafia police payroll upgrade reduces heat and arrest chance', inline:false },
      { name:'📞 Need Help?', value:'Contact a server admin or mod for issues.\nUse `/info` anytime to see this guide again.', inline:false },
    ],
  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Full guide — everything you can do on this server.'),

  async execute(interaction) {
    let page = 0;

    const buildEmbed = (p) => {
      const pg = PAGES[p];
      return new EmbedBuilder()
        .setColor(pg.color)
        .setTitle(pg.title)
        .setDescription(pg.desc)
        .addFields(pg.fields)
        .setFooter({ text: `Page ${p+1}/${PAGES.length} — Use ◀ ▶ to navigate` });
    };

    const buildRow = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('info_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
      new ButtonBuilder().setCustomId('info_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= PAGES.length - 1),
    );

    await interaction.reply({ embeds:[buildEmbed(page)], components:[buildRow(page)] });
    const msg = await interaction.fetchReply();
    const col = msg.createMessageComponentCollector({ time: 5 * 60 * 1000 });

    col.on('collect', async btn => {
      if (btn.user.id !== interaction.user.id) return btn.reply({ content:'Not your guide.', ephemeral:true });
      if (btn.customId === 'info_prev') page = Math.max(0, page - 1);
      if (btn.customId === 'info_next') page = Math.min(PAGES.length - 1, page + 1);
      await btn.update({ embeds:[buildEmbed(page)], components:[buildRow(page)] });
    });

    col.on('end', () => interaction.editReply({ components:[] }).catch(()=>{}));
  },
};

// Export pages so prefix handler can use them
module.exports.PAGES = PAGES;
