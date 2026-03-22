const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PAGES = [
  {
    title: '📖 Welcome to First Class Store',
    color: 0xff3b3b,
    desc: `First Class Store is a full-featured economy bot — gangs, businesses, pets, guns, phones, stocks, hacking, laundering, word games, and more.\n\nType \`!open account\` or use any slash command to get started.`,
    fields: [
      { name:'💵 Starting Balance', value:'Every new user gets **$500** in their wallet when they open an account.', inline:false },
      { name:'📌 Prefix Commands',  value:'All commands work as `/` slash commands **and** with the server prefix (default `!`). Examples: `!bal`, `!daily`, `!pay @user 1000`.', inline:false },
      { name:'🏦 Wallet vs Bank',   value:'**Wallet** is exposed — can be robbed, drained, shot, or hacked. **Bank** is safe. Deposit to protect it.', inline:false },
      { name:'📊 Dashboard',        value:'Admins manage everything at the dashboard. Users, gangs, items, prison, influencers, drug market, embed builder, and more.', inline:false },
    ],
  },
  {
    title: '💰 Economy Commands',
    color: 0x2ecc71,
    desc: 'The core economy. Earn, save, spend, and lose money.',
    fields: [
      { name:'/balance (!bal)',      value:'Check your wallet and bank.',                                   inline:true },
      { name:'/daily (!daily)',      value:'Claim daily reward. Streaks give up to 3× bonus.',              inline:true },
      { name:'/work (!work)',        value:'Work a job for $50–$250. 1hr cooldown.',                        inline:true },
      { name:'/deposit (!dep)',      value:'Move wallet → bank.',                                           inline:true },
      { name:'/withdraw (!with)',    value:'Move bank → wallet.',                                           inline:true },
      { name:'/rob @user (!rob)',    value:"Steal from someone's wallet.",                                  inline:true },
      { name:'/beg (!beg)',          value:'Beg for money. No cooldown.',                                   inline:true },
      { name:'/leaderboard (!lb)',   value:'Richest players on the server.',                                inline:true },
      { name:'/collect (!collect)',  value:'Collect passive income from assigned roles.',                   inline:true },
    ],
  },
  {
    title: '💸 Trading & Transfers',
    color: 0x00d2ff,
    desc: 'Send money, trade items, and deal with other players.',
    fields: [
      { name:'/pay @user <amount>',         value:'Instant send from wallet or bank. No confirmation.',                                     inline:false },
      { name:'/wire @user <amount>',        value:'Wire transfer — recipient must ✅ Accept. Supports memo. Expires in 90 seconds.',        inline:false },
      { name:'/give @user type:',           value:'Give items, guns, money, pet tokens, phone status/followers/hype to another player.',    inline:false },
      { name:'/sell @user type: price:',    value:'Sell items, guns, pets, phones, or even your entire business. Buyer gets Accept/Decline.', inline:false },
      { name:'/sponsordeal offer @user',    value:'Business owners can pay influencers to promote their business. Revenue boost lasts for the deal duration.', inline:false },
    ],
  },
  {
    title: '🎮 Games & Gambling',
    color: 0x9b59b6,
    desc: 'Risk your wallet for big rewards.',
    fields: [
      { name:'/slots (!slots)',    value:'Spin the slot machine.',                             inline:true },
      { name:'/coinflip (!cf)',    value:'Double or nothing.',                                 inline:true },
      { name:'/duel @user',        value:'Winner takes the pot.',                             inline:true },
      { name:'/blackjack (!bj)',   value:'Beat the dealer.',                                  inline:true },
      { name:'/roulette',          value:'Bet red, black, or a number.',                      inline:true },
      { name:'/roll',              value:'Roll dice.',                                        inline:true },
      { name:'/8ball',             value:'Ask the magic 8 ball.',                             inline:true },
      { name:'/rps',               value:'Rock paper scissors.',                              inline:true },
      { name:'/blacktea',          value:'🍵 Turn-based word game! Get a 3-letter combo and type a word containing it — or lose a life. Last player standing wins. Supports wagers.', inline:false },
    ],
  },
  {
    title: '🎟️ Lottery & 📈 Stock Market',
    color: 0xf5c518,
    desc: 'Two ways to gamble big.',
    fields: [
      { name:'🎟️ Lottery',  value:'`/lottery buy <tickets>` · `/lottery info`\nWinner drawn on a timer. More tickets = better odds.', inline:false },
      { name:'📈 Memecoins', value:'**Built-in:** DOGE2 · PEPE · RUGPUL · MOON · BODEN · CHAD\n**Custom:** Crypto Lab owners launch their own coins.\n\n⭐ Celebrity+ influencers can **shoutout** coins to spike prices.\n👑 Cultural Icons can **hate** on coins to crash them.', inline:false },
      { name:'/invest',      value:'Invest in any coin.',    inline:true },
      { name:'/cashout',     value:'Sell at current price.', inline:true },
      { name:'/portfolio',   value:'View your P&L.',        inline:true },
      { name:'/market',      value:'Live coin prices.',      inline:true },
    ],
  },
  {
    title: '🏢 Business System',
    color: 0xff6b35,
    desc: 'Own a business, earn passive income, hire employees. Two categories: **Legit** and **Cash-Only** (for laundering).',
    fields: [
      { name:'Legit Businesses',     value:'Restaurant · Pharmacy · Casino · Barbershop · Car Wash · Record Label · Real Estate · Tech Startup · Street Food · Gym · Crypto Lab', inline:false },
      { name:'💸 Cash-Only Fronts',  value:'🫧 Laundromat · 🚿 Cash Car Wash · 🎵 Nightclub — *Lower laundering fees. Influencer sponsorships boost your revenue passively.*', inline:false },
      { name:'/business start',      value:'Open a business.',               inline:true },
      { name:'/business collect',    value:'Collect revenue.',               inline:true },
      { name:'/business upgrade',    value:'Level up (max 10).',             inline:true },
      { name:'/hire · /fire',        value:'Manage employees.',              inline:true },
      { name:'/myrouting',           value:'Your private routing number — gives laptop access to your accounts. **Never share it in DMs.** Phishers will try to steal it.', inline:false },
      { name:'/sponsordeal view',    value:'Check active influencer sponsorships and their revenue boost to your business.', inline:false },
    ],
  },
  {
    title: '📱 Phone & Influencer System',
    color: 0x5865f2,
    desc: 'Build your brand from Newcomer to Cultural Icon. Post, promote, shoutout coins, and get paid.',
    fields: [
      { name:'📱 Phones',          value:'`/phoneshop` · `/phone buy type:`\n📵 Burner ($500) · 📱 Standard ($2k) · 📲 Flagship ($8k) · 🎙️ Creator Pro ($20k)\n\n🔥 **Burner phones** get disguised phishing templates — harder to detect.', inline:false },
      { name:'📊 Status Tiers',    value:'🌱 Newcomer → 📱 Content Creator → 🔥 Influencer → ⭐ Celebrity → 💎 Superstar → 👑 Cultural Icon\n\nHigher status = more earnings, bigger fan count, better sponsor deals.', inline:false },
      { name:'/phone post',        value:'Post on 📸 Flexgram (45min) · 🐦 Chirp (20min) · 🎮 Streamz (90min)\nEarn hype, followers, status, and money. Go viral for 2–5× rewards.', inline:false },
      { name:'/phone shoutout',    value:'⭐ **Celebrity+** — Shout out a coin ticker. Fans buy in, price spikes, you get paid a % of the fan volume generated.', inline:true },
      { name:'/phone hate',        value:'👑 **Cultural Icon only** — Publicly trash a coin. Fans panic sell, price crashes up to 85%. 1hr cooldown.', inline:true },
      { name:'/phone promo',       value:'🔥 **Influencer+** — Shout out another creator. They gain followers, hype, and status from your fan base.', inline:true },
      { name:'/phone calpolice',   value:'Report someone. Clean target = YOU get jailed for false report.', inline:true },
      { name:'/phone sponsors',    value:'Collect brand deals. Bigger status = bigger payouts ($500 → $1M+).', inline:true },
      { name:'/phone status',      value:'View your stats, tier, progress, cooldowns.',                      inline:true },
    ],
  },
  {
    title: '🏴 Gang System, Goons & Inventory',
    color: 0xff3b3b,
    desc: 'Join or create a gang. Upgrade to Mafia. Hire goons, traffic drugs, and manage a shared stash.',
    fields: [
      { name:'Gang Commands',       value:'`/gang create` · `/ganginvite @user` · `/gangcrime` · `/gangwar` · `/gangupgrade` · `/ganginfo` · `/wantedlevel`', inline:false },
      { name:'🔫 Upgrades',         value:'👮 Police Payroll · 🔫 Gang Armory · 🏠 Safehouses · 👔 Become a Mafia', inline:false },
      { name:'👊 Goons',            value:'Hire NPC goons to attack players, traffic drugs, boost wars.\n`/goons hire` · `/goons roster` · `/goonattack @user`\n\n👀 Lookout · 👊 Thug · 💊 Dealer · 🪖 Enforcer · 🎯 Hitman · 🧠 Consigliere · 💼 Underboss · 🧾 Accountant', inline:false },
      { name:'🎒 Gang Inventory',   value:'`/ganginventory view` — see the shared stash\n`/ganginventory deposit` — leader puts items/guns in\n`/ganginventory withdraw` — any member takes from stash', inline:false },
      { name:'💊 Dirty Money',      value:'Goons traffic drugs and generate dirty money every 5 min. Must launder before spending.', inline:true },
      { name:'🧾 Accountant',       value:'Auto-launders dirty money into business revenue every tick. Reduces launder fees by 60%.', inline:true },
    ],
  },
  {
    title: '💊 Drug Market, Laundering & Prison',
    color: 0x888888,
    desc: 'Order drugs, clean dirty money, and survive jail.',
    fields: [
      { name:'/drugmarket browse',  value:'See available drugs and their prices. Burner phone required to order.', inline:false },
      { name:'/drugmarket order',   value:'📵 **Burner phone only** — Order drugs cross-border. 2–5 min delivery. Risk of getting busted at the border (configurable %). Busted = +heat, possible jail.', inline:false },
      { name:'/launder <amount>',   value:'Push dirty money through your business.\n• Cash business: **20% fee** · Legit: **35% fee** · With Accountant: **fee -60%**', inline:false },
      { name:'🔒 Prison',           value:'🔒 **Prisoner** — locked out of all channels, can talk in prison chat\n🔕 **Solitary** — same lockout, read-only\n\nAuto-released when timer expires. `/jail` · `/unjail` · `/solitary`', inline:false },
    ],
  },
  {
    title: '💻 Hacking, Bitcoin & Phishing',
    color: 0x00d2ff,
    desc: 'Digital crime. Drain accounts, mix funds, phish routing numbers.',
    fields: [
      { name:'/hack @user mode:',        value:'Requires hacking item from the shop.\n🏦 **Bank** — steal 20–50% of their bank\n🏢 **Business** — steal 30–70% of revenue\n📱 **Social** — wipe followers, destroy status, drain sponsor funds\n\n⚡ **EMP Device** (shop item) — bypasses the word scramble. Level 1–5 (40–100% success guarantee).', inline:false },
      { name:'/phish @user',             value:'Send a fake official DM to a business owner. If they reply with their routing number you intercept it.\n\n🔥 **Burner phone** = disguised system message templates — harder to detect.', inline:false },
      { name:'/laptop routing: action:', value:'Access any business with their routing number.\n📊 Check · 💸 Launder dirty→clean · 💵 Withdraw revenue\n\n*Owner gets a DM if $5k+ taken. They can report to police.*', inline:false },
      { name:'₿ /bitcoin mix · collect', value:'Stolen money lands as 🔥 Hot Funds — traceable. Mix through BTC to clean it.\n🐢 Slow (4hr, 5%) · ⚡ Normal (1hr, 10%) · 🚀 Fast (instant, 20%)\n\n⚠️ If victim reported the theft, detection chance rises. Caught = arrested + funds seized.', inline:false },
    ],
  },
  {
    title: '🔫 Gun Shop & 🐾 Pets',
    color: 0x888888,
    desc: 'Weapons are gang-exclusive to buy. Pets fight, defend, and earn tokens.',
    fields: [
      { name:'/gunshop · /gunbuy',                      value:'Browse and buy weapons. **Gang members only to buy** — anyone can be shot.', inline:false },
      { name:'/shoot @user',                            value:'Hit = drain wallet + silence from bot commands temporarily.',                 inline:true },
      { name:'/health · /medkit',                       value:'Check HP and heal.',                                                         inline:true },
      { name:'/petshop',                                value:'Adopt a pet ($500–$1M). 10 types from 🐹 Hamster to 🐲 World Serpent.',     inline:false },
      { name:'/pet feed/mission/upgrade/guard/evolve', value:'Level up your pet, send on missions, toggle guard mode to intercept attacks.', inline:false },
    ],
  },
  {
    title: '🤖 AI Entities & ✨ Item Effects',
    color: 0x5865f2,
    desc: 'Shop items with powerful effects. AI companions that react to how you treat them.',
    fields: [
      { name:'🤖 AI Entities',  value:'Items can spawn AI companions. Talk with `/talk`. Treat them well — neglect = **rogue**.\n\nArchetypes: 🤖 Robot · 📱 Phone · 🧠 Companion · 🚁 Drone · 💬 Assistant', inline:false },
      { name:'✨ Effect Types', value:'Drain · Silence · Hitman · Shield · Passive Income · Consume Buff · Magic Chain · AI Entity · **Laptop** · **Minigame Drain** · **⚡ EMP Device**', inline:false },
      { name:'⚡ EMP Device',   value:'Attach to a laptop to bypass the hack word scramble. Level 1 = 40% success → Level 5 = 100% guaranteed. Single-use. Lock to specific hack type (bank/business/social) or any.', inline:true },
      { name:'💊 Drug Items',   value:'Items flagged as drugs are detectable by police. Users caught holding them when reported get arrested.', inline:true },
      { name:'/status (!buffs)',value:'Check active buffs.',  inline:true },
      { name:'/use <item>',     value:'Use an item.',        inline:true },
    ],
  },
  {
    title: '📋 Rules & Notes',
    color: 0xf5c518,
    desc: 'Read before playing.',
    fields: [
      { name:'💰 Economy',      value:'• Robbing, hacking, attacks are part of the game\n• Protected roles cannot be robbed or attacked\n• `/pay` is instant — no confirmation\n• You can sell businesses, pets, phones, and guns to other players via `/sell`', inline:false },
      { name:'🏴 Gangs',        value:'• Only gang members can BUY guns (anyone can be shot)\n• Crimes build police heat → too much = raid + jail\n• Dirty money must be laundered before spending\n• Gang inventory is shared — all members can withdraw', inline:false },
      { name:'📱 Influencers',  value:'• Phone is separate from business — you can have both\n• /phone shoutout (Celebrity+) pumps coins — you get paid\n• /phone hate (Cultural Icon) crashes coins\n• /phone promo (Influencer+) boosts other creators\n• False police reports land YOU in jail', inline:false },
      { name:'💻 Hacking',      value:'• Stolen money is HOT — mix through Bitcoin before using\n• Business owners get alerts when $5k+ is taken — can report to police\n• Routing numbers are private — phishers send fake DMs to steal them\n• EMP devices bypass the hack word scramble', inline:false },
      { name:'🍵 BlackTea',     value:'• `/blacktea` starts a word game — type words containing the given 3-letter combo\n• Wrong answer or timeout = lose a life\n• Last player standing wins\n• Supports entry wagers — winner takes the pot', inline:false },
    ],
  },
];

module.exports = {
  PAGES,
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Full guide — everything you can do on this server.'),

  async execute(interaction) {
    let page = 0;
    const buildEmbed = (p) => new EmbedBuilder()
      .setColor(PAGES[p].color)
      .setTitle(PAGES[p].title)
      .setDescription(PAGES[p].desc)
      .addFields(PAGES[p].fields)
      .setFooter({ text:`Page ${p+1}/${PAGES.length} — Use ◀ ▶ to navigate` });

    const buildRow = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('info_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
      new ButtonBuilder().setCustomId('info_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p === PAGES.length - 1),
    );

    await interaction.reply({ embeds:[buildEmbed(page)], components:[buildRow(page)] });

    const collector = interaction.channel.createMessageComponentCollector({ time: 5 * 60 * 1000 });
    collector.on('collect', async btn => {
      if (btn.user.id !== interaction.user.id) return btn.reply({ content:'Not your menu.', ephemeral:true });
      if (btn.customId==='info_prev') page=Math.max(0,page-1);
      if (btn.customId==='info_next') page=Math.min(PAGES.length-1,page+1);
      await btn.update({ embeds:[buildEmbed(page)], components:[buildRow(page)] });
    });
    collector.on('end', () => interaction.editReply({ components:[] }).catch(()=>{}));
  },
};
