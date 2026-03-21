const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PAGES = [
  {
    title: '📖 Welcome to First Class Store',
    color: 0xff3b3b,
    desc: `First Class Store is a full economy bot with gangs, pets, guns, businesses, stocks, trading, and more.\n\nType \`!open account\` or use any command to get started.`,
    fields: [
      { name:'💵 Starting Balance', value:'Every new user gets **$500** in their wallet when they open an account.', inline:false },
      { name:'📌 Prefix Commands', value:'All commands work as `/` slash commands **and** with the server prefix (default `!`). Examples: `!bal`, `!daily`, `!pay @user 1000`. Admins can change the prefix in the dashboard.', inline:false },
      { name:'🏦 Wallet vs Bank', value:'**Wallet** is exposed — it can be robbed, drained, or lost when shot. **Bank** is safe. Deposit money to protect it.', inline:false },
      { name:'📊 Dashboard', value:'Server owners and admins can manage everything at the dashboard URL. Manage users, gangs, items, purge, guns, coins, and more.', inline:false },
    ],
  },
  {
    title: '💰 Economy Commands',
    color: 0x2ecc71,
    desc: 'The core economy. Earn, save, spend, and lose money.',
    fields: [
      { name:'/balance (!bal)',     value:'Check your wallet and bank balance.',                               inline:true },
      { name:'/daily (!daily)',     value:'Claim your daily reward. Streaks give bonus multipliers up to 3×.', inline:true },
      { name:'/work (!work)',       value:'Work a random job for $50–$250. 1 hour cooldown.',                  inline:true },
      { name:'/deposit (!dep)',     value:'Move money from wallet → bank.',                                    inline:true },
      { name:'/withdraw (!with)',   value:'Move money from bank → wallet.',                                    inline:true },
      { name:'/rob @user (!rob)',   value:"Steal from someone's wallet. Protected roles are immune.",          inline:true },
      { name:'/beg (!beg)',         value:'Beg for money. No cooldown but low rewards.',                       inline:true },
      { name:'/leaderboard (!lb)', value:'See the richest players on the server.',                            inline:true },
      { name:'/collect (!collect)', value:'Collect income from your assigned roles.',                         inline:true },
    ],
  },
  {
    title: '💸 Trading & Transfers',
    color: 0x00d2ff,
    desc: 'Send money, trade items, and sell guns to other players.',
    fields: [
      { name:'/pay @user <amount> (!pay)', value:'Instantly send money from your wallet or bank to another player. No confirmation needed.', inline:false },
      { name:'/wire @user <amount>',       value:'Send a wire transfer that requires the recipient to **✅ Accept** before funds move. Supports a memo/note. Expires in 90 seconds.', inline:false },
      { name:'/give @user type: item_id:', value:'Give items, guns, money, or pet tokens to another player. You must own what you give.\n\n**Admins can also give:** 🐾 Pets · 🏴 Gang membership · 🏢 Business money', inline:false },
      { name:'/sell @user item_id: price:', value:'List an item or gun for sale at your asking price. Buyer gets a **✅ Accept / ❌ Decline** prompt. Transaction is automatic on accept — item transfers, money transfers.', inline:false },
    ],
  },
  {
    title: '🎮 Games & Gambling',
    color: 0x9b59b6,
    desc: 'Risk your wallet for big rewards.',
    fields: [
      { name:'/slots (!slots)',       value:'Spin the slot machine. Match 3 for jackpot.',   inline:true },
      { name:'/coinflip (!cf)',       value:'Heads or tails — double or nothing.',            inline:true },
      { name:'/duel @user',           value:'Challenge someone to a duel. Winner takes pot.', inline:true },
      { name:'/blackjack (!bj)',      value:'Play blackjack against the dealer.',             inline:true },
      { name:'/roulette',             value:'Bet on red, black, or a number.',                inline:true },
      { name:'/roll (!roll)',          value:'Roll dice with optional number of sides.',       inline:true },
      { name:'/8ball',                value:'Ask the magic 8 ball a question.',               inline:true },
      { name:'/rps',                  value:'Rock paper scissors.',                           inline:true },
    ],
  },
  {
    title: '🎟️ Lottery & 📈 Stock Market',
    color: 0xf5c518,
    desc: 'Two ways to gamble big.',
    fields: [
      { name:'🎟️ Lottery', value:'/lottery buy <tickets> — buy tickets\n/lottery info — see pot and odds\n\nWinner drawn on a timer. More tickets = better odds.', inline:false },
      { name:'📈 Memecoins', value:'**Built-in:** DOGE2 · PEPE · RUGPUL · MOON · BODEN · CHAD\n**Custom:** Crypto Lab owners can launch their own coins!\n\nPrices update every 10 seconds. Each coin has unique volatility and tendency.', inline:false },
      { name:'/invest',    value:'Invest $ from wallet into any coin.',  inline:true },
      { name:'/cashout',   value:'Sell shares at current price.',         inline:true },
      { name:'/portfolio', value:'View your investments and P&L.',        inline:true },
      { name:'/market',    value:'View live coin prices.',                inline:true },
    ],
  },
  {
    title: '🏢 Entrepreneur System',
    color: 0xff6b35,
    desc: 'Own a business, earn passive income, hire employees. 11 business types available.',
    fields: [
      { name:'/business start', value:'Open a business. Choose from 11 types including the **🖥️ Crypto Lab**.', inline:false },
      { name:'/business collect (!bizcollect)', value:'Collect your accumulated revenue.',          inline:true },
      { name:'/business upgrade (!bizupgrade)', value:'Level up for higher income. Max level 10.',  inline:true },
      { name:'/business view (!biz)',           value:'See your business stats and employees.',     inline:true },
      { name:'/hire @user (!hire)',             value:'Hire someone. They earn 10% per collection.',inline:true },
      { name:'/fire @user (!fire)',             value:'Remove an employee.',                        inline:true },
      { name:'🖥️ Crypto Lab ($25,000)', value:'Special business that lets you launch your own memecoins (up to 3).\n`/coincreate` · `/coincontrol` · `/rugpull` · `/liquidate`', inline:false },
    ],
  },
  {
    title: '🏴 Gang System',
    color: 0xff3b3b,
    desc: 'Join or create a gang. Gang members unlock the Gun Shop.',
    fields: [
      { name:'/gang create',           value:'Found a gang. You become leader.',                         inline:true },
      { name:'/ganginvite @user (!gi)',value:'Invite someone with Accept/Decline prompt.',               inline:true },
      { name:'/gangcrime (!crime)',    value:'Commit crimes for money + rep + heat.',                    inline:true },
      { name:'/gangwar challenge',     value:'Challenge another gang to a 30-min war.',                  inline:true },
      { name:'/gangwar attack',        value:'Score points during an active war.',                       inline:true },
      { name:'/gangupgrade (!gu)',     value:'Upgrade police payroll, armory, safehouses, or go Mafia.', inline:true },
      { name:'/wantedlevel (!wl)',     value:'Check your police heat level (0–100).',                    inline:true },
      { name:'/gangs',                 value:'Server-wide gang rankings by rep.',                        inline:true },
    ],
  },
  {
    title: '🔫 Gun Shop (Gang Members Only)',
    color: 0x888888,
    desc: 'Guns are **exclusive to gang members** to buy. Anyone can be shot regardless of gang status.',
    fields: [
      { name:'/gunshop (!gs)',  value:'Browse weapons: Pistol, SMG, Rifle, Shotgun, Sniper, Heavy.',                                            inline:false },
      { name:'/gunbuy (!gb)',   value:'Buy a weapon with autocomplete. Ammo included.',                                                          inline:true },
      { name:'/guns',           value:'View your arsenal.',                                                                                       inline:true },
      { name:'/shoot @user',    value:'Shoot someone — hit = they lose wallet money AND get silenced from bot commands temporarily.',             inline:false },
      { name:'/health (!hp)',   value:'Check your HP status.',                                                                                    inline:true },
      { name:'/medkit (!heal)', value:'Spend money to restore HP.',                                                                              inline:true },
      { name:'🔩 Switch',       value:'Some guns have an auto switch — fires in bursts for bonus damage.',                                       inline:true },
      { name:'🛡️ Protection',   value:'Shields, protected roles, and pet guard mode all block gun damage.',                                     inline:true },
      { name:'Trading Guns',    value:'Use `/give` or `/sell` to transfer guns between players.',                                                inline:false },
    ],
  },
  {
    title: '🐾 Pet System',
    color: 0xff6b35,
    desc: 'Adopt a pet from the shop. Range from 🐹 Hamster to 🐲 World Serpent. Pets fight, defend, evolve, and earn tokens.',
    fields: [
      { name:'/petshop (!petshop)',      value:'Browse 10 pets by tier. Costs range from $500 to $1,000,000.',                    inline:false },
      { name:'/pet',                     value:'View your pet\'s stats, hunger, happiness, XP, guard mode, and tokens.',          inline:true },
      { name:'/pet feed',                value:'Feed using Pet Food from the item shop.',                                         inline:true },
      { name:'/pet mission (!pm)',       value:'Send on a mission to earn **XP + Pet Tokens**. 5 missions.',                     inline:true },
      { name:'/pet upgrade <stat> (!pu)',value:'Spend tokens on ❤️ Health · 🛡️ Defense · 🧠 Intelligence · ⚔️ Attack.',        inline:true },
      { name:'/pet guard (!pg)',         value:'Toggle guard mode — pet intercepts attacks and shots.',                           inline:true },
      { name:'/pet evolve',              value:'Evolve your pet at the required level.',                                          inline:true },
      { name:'🧠 Intelligence',         value:'Each upgrade level gives +20% token yield from missions. Max 5 levels = 2× tokens.', inline:false },
    ],
  },
  {
    title: '🤖 AI Entities & ✨ Item Effects',
    color: 0x5865f2,
    desc: 'Buy special items from the shop with powerful effects.',
    fields: [
      { name:'🤖 AI Entities',   value:'Items can spawn AI companions with moods and loyalty. Talk with `/talk`. Treat them well or they go **rogue**.\n\nArchetypes: 🤖 Robot · 📱 Phone · 🧠 Companion · 🚁 Drone · 💬 Assistant', inline:false },
      { name:'✨ Effect Types',  value:'**Drain** · **Silence** · **Hitman** · **Shield** · **Passive Income** · **Consume Buff** · **Magic Chain** · **AI Entity**', inline:false },
      { name:'🔮 Magic Items',  value:'Chain multiple actions: drain, silence, add heat, give buffs, pet XP, or control AI — set loyalty, force mood, take over, or wipe memory.', inline:false },
      { name:'/status (!buffs)', value:'Check your currently active buffs.',   inline:true },
      { name:'/use <item>',     value:'Use an item from your inventory.',       inline:true },
    ],
  },
  {
    title: '🪙 Crypto Lab & Custom Coins',
    color: 0xf5c518,
    desc: 'Own a Crypto Lab business ($25,000) to launch and control your own memecoins.',
    fields: [
      { name:'How to Start', value:'1. Get $25,000\n2. `/business start type:cryptolab`\n3. Launch up to **3 memecoins**', inline:false },
      { name:'/coincreate',  value:'Launch a memecoin. Set name, emoji, tendency (moon/rug/balanced) and volatility. Goes live on the market instantly.', inline:false },
      { name:'/coincontrol', value:'Manipulate your coin:\n🚀 **Pump** — spike price\n🪤 **Rug** — crash price\n📢 **Promote** — boost hype\n😶 **Go Silent** — flatten activity', inline:false },
      { name:'/liquidate',   value:'Collect your coin investment revenue anytime without delisting.',                inline:true },
      { name:'/rugpull',     value:'Delist your coin + collect all revenue in one shot. Price crashes to $0.',      inline:true },
      { name:'💰 Revenue',  value:'You earn **10% of every investment** made into your coin — goes to your business revenue, collect with `/liquidate` or `/business collect`.', inline:false },
    ],
  },
  {
    title: '📋 Rules & Important Notes',
    color: 0xf5c518,
    desc: 'Read these before playing.',
    fields: [
      { name:'💰 Economy',    value:'• No cheating or exploiting bugs\n• Robbing, scamming, and attacks are part of the game\n• Protected role members cannot be robbed or attacked', inline:false },
      { name:'💸 Trading',    value:'• `/pay` is instant — no confirmation\n• `/wire` requires recipient approval\n• `/sell` requires buyer to accept the trade\n• `/give` requires you to own what you give (except admins)', inline:false },
      { name:'🏴 Gangs',      value:'• Only gang members can buy guns\n• Crimes build police heat — too much = raid\n• Wars require members on each side', inline:false },
      { name:'🔫 Guns',       value:'• Only gang members can BUY guns\n• Anyone can be SHOT\n• Being shot silences you temporarily and drains your wallet\n• Guns can be traded using `/give` or `/sell`', inline:false },
      { name:'🪙 Crypto Lab', value:'• Max 3 coins per owner\n• Rug pulling affects real investors\n• You earn 10% of all investments in your coins', inline:false },
      { name:'🚔 Police Heat', value:'• Builds from crimes and shooting\n• Decays 1 point per minute\n• Too much heat = police raid — fined + jailed', inline:false },
    ],
  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Full guide — everything you can do on this server.'),

  async execute(interaction) {
    let page = 0;
    const buildEmbed = (p) => new EmbedBuilder().setColor(PAGES[p].color).setTitle(PAGES[p].title).setDescription(PAGES[p].desc).addFields(PAGES[p].fields).setFooter({ text:`Page ${p+1}/${PAGES.length} — Use ◀ ▶ to navigate` });
    const buildRow   = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('info_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p===0),
      new ButtonBuilder().setCustomId('info_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p>=PAGES.length-1),
    );
    await interaction.reply({ embeds:[buildEmbed(page)], components:[buildRow(page)] });
    const msg = await interaction.fetchReply();
    const col = msg.createMessageComponentCollector({ time:5*60*1000 });
    col.on('collect', async btn => {
      if (btn.user.id !== interaction.user.id) return btn.reply({ content:'Not your guide.', ephemeral:true });
      if (btn.customId==='info_prev') page=Math.max(0,page-1);
      if (btn.customId==='info_next') page=Math.min(PAGES.length-1,page+1);
      await btn.update({ embeds:[buildEmbed(page)], components:[buildRow(page)] });
    });
    col.on('end', ()=>interaction.editReply({ components:[] }).catch(()=>{}));
  },
};

module.exports.PAGES = PAGES;
