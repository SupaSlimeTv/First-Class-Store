const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PAGES = [
  {
    title: '📖 Welcome to First Class Store',
    color: 0xff3b3b,
    desc: `First Class Store is a full economy bot with gangs, pets, guns, businesses, stocks, and more.\n\nUse the arrows below to flip through every feature. Type \`!open account\` or use any command to get started.`,
    fields: [
      { name:'💵 Starting Balance', value:'Every new user gets **$500** in their wallet when they open an account.', inline:false },
      { name:'📌 Prefix Commands', value:'All commands work as `/` slash commands **and** with the server prefix (default `!`). Examples: `!bal`, `!daily`, `!info`. Admins can change the prefix in the dashboard.', inline:false },
      { name:'🏦 Wallet vs Bank', value:'**Wallet** is exposed — it can be robbed, drained by items, or lost when shot. **Bank** is safe. Deposit money to protect it.', inline:false },
      { name:'📊 Dashboard', value:'Server owners and admins can manage everything at the dashboard URL. Manage users, gangs, items, purge, guns, and more.', inline:false },
    ],
  },
  {
    title: '💰 Economy Commands',
    color: 0x2ecc71,
    desc: 'The core economy. Earn, save, spend, and lose money.',
    fields: [
      { name:'/balance (!bal)', value:'Check your wallet and bank balance.', inline:true },
      { name:'/daily (!daily)', value:'Claim your daily reward. Streaks give bonus multipliers up to 3×.', inline:true },
      { name:'/work (!work)', value:'Work a random job for $50–$250. 1 hour cooldown.', inline:true },
      { name:'/deposit (!dep)', value:'Move money from wallet → bank.', inline:true },
      { name:'/withdraw (!with)', value:'Move money from bank → wallet.', inline:true },
      { name:'/rob @user (!rob)', value:'Steal from someone\'s wallet. Protected roles are immune.', inline:true },
      { name:'/beg (!beg)', value:'Beg for money. No cooldown but risky.', inline:true },
      { name:'/leaderboard (!lb)', value:'See the richest players on the server.', inline:true },
      { name:'/collect (!collect)', value:'Collect income from your assigned roles.', inline:true },
    ],
  },
  {
    title: '🎮 Games & Gambling',
    color: 0x9b59b6,
    desc: 'Risk your wallet for big rewards.',
    fields: [
      { name:'/slots (!slots) <bet>', value:'Spin the slot machine. Match 3 for jackpot.', inline:true },
      { name:'/coinflip (!cf) <bet>', value:'Heads or tails — double or nothing.', inline:true },
      { name:'/duel @user <bet>', value:'Challenge someone to a duel. Winner takes pot.', inline:true },
      { name:'/blackjack', value:'Play blackjack against the dealer.', inline:true },
      { name:'/roulette', value:'Bet on red, black, or a number.', inline:true },
      { name:'/roll (!roll)', value:'Roll dice with optional number of sides.', inline:true },
      { name:'/8ball (!8ball)', value:'Ask the magic 8 ball a question.', inline:true },
      { name:'/rps (!rps)', value:'Rock paper scissors.', inline:true },
    ],
  },
  {
    title: '🎟️ Lottery & 📈 Stock Market',
    color: 0xf5c518,
    desc: 'Two ways to gamble big.',
    fields: [
      { name:'🎟️ Lottery', value:'/lottery buy <tickets> — buy tickets\n/lottery info — see current pot and your odds\n\nWinner drawn on a timer. More tickets = better odds.', inline:false },
      { name:'📈 Memecoins — 9 Coins', value:'**DOGE2** · **PEPE** · **RUGPUL** · **MOON** · **BODEN** · **CHAD** + custom coins launched by Crypto Lab owners\n\nPrices update every 10 seconds. Each coin has its own personality — tendency to moon, rug, or stay stable.', inline:false },
      { name:'/invest (!invest)', value:'Invest $ from wallet into a coin at current price.', inline:true },
      { name:'/cashout (!cashout)', value:'Sell shares at current price.', inline:true },
      { name:'/portfolio (!portfolio)', value:'View your investments and P&L.', inline:true },
      { name:'/market (!market)', value:'View live coin prices with charts.', inline:true },
    ],
  },
  {
    title: '🏢 Entrepreneur System',
    color: 0xff6b35,
    desc: 'Own and run a business. Earn passive income every minute. 11 business types available.',
    fields: [
      { name:'/business start', value:'Open a business. Choose from 11 types including the new **🖥️ Crypto Lab**.', inline:false },
      { name:'/business collect (!bizcollect)', value:'Collect your accumulated revenue.', inline:true },
      { name:'/business upgrade (!bizupgrade)', value:'Level up for higher income. Max level 10.', inline:true },
      { name:'/business view (!biz)', value:'See your business stats and employees.', inline:true },
      { name:'/hire @user (!hire)', value:'Hire someone. They earn 10% per collection.', inline:true },
      { name:'/fire @user (!fire)', value:'Remove an employee.', inline:true },
      { name:'🖥️ Crypto Lab ($25,000)', value:'Special business that lets you **launch your own memecoins**. Up to 3 coins. Full control over pump, rug, promote, or silence.\n`/coincreate` · `/coincontrol` · `/rugpull`', inline:false },
    ],
  },
  {
    title: '🏴 Gang System',
    color: 0xff3b3b,
    desc: 'Join or create a gang. Gang members unlock the **Gun Shop**.',
    fields: [
      { name:'/gang create', value:'Found a gang. Costs money. You become leader.', inline:true },
      { name:'/ganginvite @user (!gi)', value:'Invite someone. They get a DM with Accept/Decline.', inline:true },
      { name:'/gangcrime (!crime)', value:'Commit crimes for money + rep + heat.', inline:true },
      { name:'/gangwar challenge', value:'Challenge another gang to a 30-min war. Guns give bonus attack points.', inline:true },
      { name:'/gangwar attack', value:'Score points for your gang during a war.', inline:true },
      { name:'/gangupgrade (!gu)', value:'Upgrade police payroll, armory, safehouses, or convert to Mafia.', inline:true },
      { name:'/wantedlevel (!wl)', value:'Check your police heat level (0–100).', inline:true },
      { name:'/gangs', value:'Server-wide gang rankings by rep.', inline:true },
    ],
  },
  {
    title: '🔫 Gun Shop (Gang Members Only)',
    color: 0x888888,
    desc: 'Guns are **exclusive to gang members**. Anyone can be shot regardless of gang status.',
    fields: [
      { name:'/gunshop (!gs)', value:'Browse weapons by type: Pistol, SMG, Rifle, Shotgun, Sniper, Heavy.', inline:false },
      { name:'/gunbuy <gun> (!gb)', value:'Buy a weapon with autocomplete. Ammo included (3× magazine).', inline:true },
      { name:'/guns (!guns)', value:'View your weapon arsenal.', inline:true },
      { name:'/shoot @user (!shoot)', value:'Shoot someone. If hit — they lose wallet money based on damage AND get silenced from bot commands temporarily.', inline:false },
      { name:'/health (!health)', value:'Check HP status.', inline:true },
      { name:'/medkit (!medkit)', value:'Spend money to restore HP.', inline:true },
      { name:'🔩 Auto Switches', value:'Some guns can have an illegal auto switch — fires in bursts for bonus damage. Check /gunshop for which guns have it.', inline:false },
      { name:'🛡️ Protection', value:'Shields and protected roles block all gun damage. Your pet in guard mode can also intercept shots.', inline:false },
    ],
  },
  {
    title: '🐾 Pet System',
    color: 0xff6b35,
    desc: 'Adopt a pet from the shop. Range from 🐹 Hamster to 🐲 World Serpent. Pets fight, defend, evolve, and earn tokens.',
    fields: [
      { name:'/petshop (!petshop)', value:'Browse 10 pets by tier. Costs range from $500 to $1,000,000.', inline:false },
      { name:'/pet feed', value:'Feed your pet using **Pet Food** from the item shop.', inline:true },
      { name:'/pet mission', value:'Send pet on a mission to earn **XP + Pet Tokens**. 5 missions: Patrol → All-Out War.', inline:true },
      { name:'/pet upgrade <stat>', value:'Spend tokens to upgrade: ❤️ Health · 🛡️ Defense · 🧠 Intelligence · ⚔️ Attack. 5 levels each.', inline:false },
      { name:'/pet guard', value:'Toggle guard mode — pet defends you from attacks and intercepts shots.', inline:true },
      { name:'/pet evolve', value:'Evolve your pet at the required level.', inline:true },
    ],
  },
  {
    title: '🤖 AI Entities & ✨ Item Effects',
    color: 0x5865f2,
    desc: 'Buy special items from the shop with powerful effects.',
    fields: [
      { name:'🤖 AI Entities', value:'Items can spawn AI companions with moods and loyalty. Talk with `/talk`. Treat them well or they go **rogue**.\n\nArchetypes: 🤖 Robot · 📱 Phone · 🧠 Companion · 🚁 Drone · 💬 Assistant', inline:false },
      { name:'✨ Item Effect Types', value:'**Drain** · **Silence** · **Hitman** · **Shield** · **Passive Income** · **Consume Buff** · **Magic Chain** · **AI Entity**', inline:false },
      { name:'🔮 Magic Items', value:'Magic items can chain multiple actions: drain money, silence, add heat, give buffs, pet XP, or **control AI entities** — set loyalty, force mood, take over, or wipe memory.', inline:false },
      { name:'/status (!status)', value:'Check your currently active buffs.', inline:true },
      { name:'/use <item>', value:'Use an item from your inventory.', inline:true },
    ],
  },
  {
    title: '🪙 Crypto Lab & Custom Coins',
    color: 0xf5c518,
    desc: 'Own a Crypto Lab business to launch and control your own memecoins.',
    fields: [
      { name:'How to Start', value:'1. Get $25,000\n2. Run `/business start type:cryptolab`\n3. Now you can launch up to **3 memecoins**', inline:false },
      { name:'/coincreate', value:'Launch a memecoin. Set name, emoji, tendency (moon/rug/balanced) and volatility (low/extreme). Goes live on the market immediately.', inline:false },
      { name:'/coincontrol', value:'Manipulate your coin in real time:\n🚀 **Pump** — spike price up\n🪤 **Rug Pull** — crash the price\n📢 **Promote** — boost momentum\n😶 **Go Silent** — flatten activity', inline:false },
      { name:'/rugpull', value:'Permanently delist your coin. All investor holdings become worthless.', inline:true },
      { name:'⚠️ Rules', value:'Coins are visible to ALL servers. Investors can be from any server. You are responsible for your coin\'s behavior.', inline:false },
    ],
  },
  {
    title: '📋 Rules & Important Notes',
    color: 0xf5c518,
    desc: 'Read these before playing.',
    fields: [
      { name:'💰 Economy Rules', value:'• No cheating or exploiting bugs\n• Robbing, scamming, and attacks are part of the game\n• Protected role members cannot be robbed or attacked', inline:false },
      { name:'🏴 Gang Rules', value:'• Only gang members can buy guns\n• Crimes build police heat — too much = raid\n• Wars require at least 3 members each side', inline:false },
      { name:'🔫 Gun Rules', value:'• Only gang members can BUY guns\n• Anyone can be SHOT\n• Being shot silences you from commands temporarily\n• More damage = more money lost from wallet', inline:false },
      { name:'🐾 Pet Rules', value:'• Pets need Pet Food from the shop\n• Guard mode ON = pet can block shots\n• Tokens earned only through missions', inline:false },
      { name:'🪙 Crypto Lab Rules', value:'• Max 3 coins per Crypto Lab owner\n• Rug pulling your own coin affects real players\n• Custom coins persist across server restarts', inline:false },
      { name:'🚔 Police Heat', value:'• Heat builds from crimes and shooting\n• Decays 1 point per minute passively\n• Too much heat = police raid — fined + jailed', inline:false },
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

module.exports.PAGES = PAGES;
