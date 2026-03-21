const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PAGES = [
  {
    title: '📖 Welcome to First Class Store',
    color: 0xff3b3b,
    desc: `First Class Store is a full-featured economy bot — gangs, businesses, pets, guns, phones, stocks, hacking, laundering, and more.\n\nType \`!open account\` or use any slash command to get started.`,
    fields: [
      { name:'💵 Starting Balance', value:'Every new user gets **$500** in their wallet when they open an account.', inline:false },
      { name:'📌 Prefix Commands',  value:'All commands work as `/` slash commands **and** with the server prefix (default `!`). Examples: `!bal`, `!daily`, `!pay @user 1000`.', inline:false },
      { name:'🏦 Wallet vs Bank',   value:'**Wallet** is exposed — can be robbed, drained, shot, or hacked. **Bank** is safe. Deposit to protect it.', inline:false },
      { name:'📊 Dashboard',        value:'Admins manage everything at the dashboard. Users, gangs, items, purge, guns, coins, police, prison, and more.', inline:false },
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
      { name:'/pay @user <amount>',        value:'Instant send from wallet or bank. No confirmation.',                                    inline:false },
      { name:'/wire @user <amount>',       value:'Wire transfer — recipient must **✅ Accept**. Supports memo. Expires in 90 seconds.',   inline:false },
      { name:'/give @user type:',          value:'Give items, guns, money, pet tokens, phone status/followers to another player. Admins can also give pets, gang membership, business money.', inline:false },
      { name:'/sell @user item_id: price:',value:'Put an item up for sale. Buyer gets Accept/Decline. Auto-transfers on accept.',         inline:false },
    ],
  },
  {
    title: '🎮 Games & Gambling',
    color: 0x9b59b6,
    desc: 'Risk your wallet for big rewards.',
    fields: [
      { name:'/slots (!slots)',    value:'Spin the slot machine.',           inline:true },
      { name:'/coinflip (!cf)',    value:'Double or nothing.',               inline:true },
      { name:'/duel @user',        value:'Winner takes the pot.',           inline:true },
      { name:'/blackjack (!bj)',   value:'Beat the dealer.',                inline:true },
      { name:'/roulette',          value:'Bet red, black, or a number.',    inline:true },
      { name:'/roll',              value:'Roll dice.',                      inline:true },
      { name:'/8ball',             value:'Ask the magic 8 ball.',           inline:true },
      { name:'/rps',               value:'Rock paper scissors.',            inline:true },
    ],
  },
  {
    title: '🎟️ Lottery & 📈 Stock Market',
    color: 0xf5c518,
    desc: 'Two ways to gamble big.',
    fields: [
      { name:'🎟️ Lottery',  value:'`/lottery buy <tickets>` · `/lottery info`\nWinner drawn on a timer. More tickets = better odds.', inline:false },
      { name:'📈 Memecoins', value:'**Built-in:** DOGE2 · PEPE · RUGPUL · MOON · BODEN · CHAD\n**Custom:** Crypto Lab owners launch their own! Influencers can shout out coins to spike prices.', inline:false },
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
      { name:'Legit Businesses',      value:'Restaurant · Pharmacy · Casino · Barbershop · Car Wash · Record Label · Real Estate · Tech Startup · Street Food · Gym · Crypto Lab', inline:false },
      { name:'💸 Cash-Only Fronts',   value:'🫧 Laundromat · 🚿 Cash Car Wash · 🎵 Nightclub\n*Cash businesses accept gang dirty money for laundering at lower fees.*', inline:false },
      { name:'/business start',       value:'Open a business.',               inline:true },
      { name:'/business collect',     value:'Collect revenue.',               inline:true },
      { name:'/business upgrade',     value:'Level up (max 10).',             inline:true },
      { name:'/hire · /fire',         value:'Manage employees.',              inline:true },
      { name:'/myrouting',            value:'View your private business routing number. Keep it secret — anyone with it can access your accounts via laptop.', inline:false },
    ],
  },
  {
    title: '📱 Phone & Influencer System',
    color: 0x5865f2,
    desc: 'Buy a phone, build your social media presence, and become a Cultural Icon — or use it to call police and run scams.',
    fields: [
      { name:'📱 Phones',         value:'`/phoneshop` to browse · `/phone buy type:`\n\n📵 Burner ($500) · 📱 Standard ($2k) · 📲 Flagship ($8k) · 🎙️ Creator Pro ($20k)', inline:false },
      { name:'📊 Status Tiers',   value:'🌱 Newcomer → 📱 Content Creator → 🔥 Influencer → ⭐ Celebrity → 💎 Superstar → 👑 Cultural Icon\n\nStatus unlocks higher earnings, bigger sponsor deals, and more NPC fans.', inline:false },
      { name:'/phone post',       value:'Post on 📸 Flexgram · 🐦 Chirp · 🎮 Streamz. Mention a coin ticker to shout it out — fans pile in and price spikes based on your Status.', inline:false },
      { name:'/phone sponsors',   value:'Collect active brand deals. Better status = bigger deals ($500 → $1M+).', inline:true },
      { name:'/phone calpolice',  value:'Report someone to police. Clean target? YOU go to jail for false report.', inline:true },
      { name:'/phone leaderboard',value:'Top influencers by status.',          inline:true },
      { name:'/phone status',     value:'View your stats, tier, and progress.', inline:true },
    ],
  },
  {
    title: '🏴 Gang System & Goons',
    color: 0xff3b3b,
    desc: 'Join or create a gang. Upgrade to Mafia. Hire NPC goons to run operations.',
    fields: [
      { name:'Gang Commands',  value:'`/gang create` · `/ganginvite @user` · `/gangcrime` · `/gangwar` · `/gangupgrade` · `/ganginfo` · `/wantedlevel`', inline:false },
      { name:'🔫 Upgrades',    value:'👮 Police Payroll · 🔫 Gang Armory · 🏠 Safehouses · 👔 Become a Mafia', inline:false },
      { name:'👊 Goons',       value:'Hire NPC goons to attack players, traffic drugs, and boost wars.\n`/goons hire` · `/goons roster` · `/goons shop` · `/goonattack @user`\n\n**Tiers:** 👀 Lookout · 👊 Thug · 💊 Dealer · 🪖 Enforcer · 🎯 Hitman · 🧠 Consigliere · 💼 Underboss', inline:false },
      { name:'🧾 Accountant',  value:'Hire the NPC Accountant to auto-launder dirty money into business revenue every tick.', inline:true },
      { name:'💊 Dirty Money', value:'Goons generate dirty money automatically every 5 minutes. Must launder before spending.', inline:true },
    ],
  },
  {
    title: '💊 Money Laundering & 🔒 Prison',
    color: 0x888888,
    desc: 'Clean dirty money. Do hard time.',
    fields: [
      { name:'/launder <amount>',  value:'Push gang dirty money through your business.\n• Cash business (Laundromat etc): **20% fee**\n• Legit business: **35% fee**\n• With NPC Accountant: **fee reduced 60%**', inline:false },
      { name:'🔒 Prison System',   value:'Admins run `/jailcreate` once to set up the prison.\n\n**🔒 Prisoner role** — locked out of all channels, can talk in `#prison-chat`\n**🔕 Solitary role** — same lockout, read-only in `#prison-chat`', inline:false },
      { name:'/jail @user',        value:'Manually jail anyone for X minutes.',            inline:true },
      { name:'/unjail @user',      value:'Early release.',                                 inline:true },
      { name:'/solitary @user',    value:'Put a prisoner in read-only solitary.',          inline:true },
      { name:'Auto-Release',       value:'Jail timer runs out → role removed automatically every 15 seconds.', inline:true },
    ],
  },
  {
    title: '💻 Hacking, Bitcoin & Phishing',
    color: 0x00d2ff,
    desc: 'Digital crime. Drain accounts, mix funds, trick business owners.',
    fields: [
      { name:'/hack @user mode:',   value:'Requires a hacking item from the shop.\n🏦 **Bank** — steal 20–50% of their bank\n🏢 **Business** — steal 30–70% of business revenue\n📱 **Social** — wipe followers, destroy status, drain sponsor funds', inline:false },
      { name:'/phish @user',        value:'Send a fake official DM to a business owner. If they reply with their routing number you intercept it and get full account access.', inline:false },
      { name:'/laptop routing: action:', value:'Access any business account with their routing number.\n📊 **Check** — view balances\n💸 **Launder** — push dirty → clean\n💵 **Withdraw** — pull clean revenue to your wallet\n\n*Owner gets a DM alert if $5k+ is taken.*', inline:false },
      { name:'₿ Bitcoin Mixer',     value:'All stolen funds land as **🔥 Hot Funds** — traceable. Mix through BTC before spending.\n`/bitcoin mix speed:` → `/bitcoin collect`\n\n🐢 Slow (4hr, 5%) · ⚡ Normal (1hr, 10%) · 🚀 Fast (instant, 20%)\n\n⚠️ If owner reported the theft, detection chance rises. Getting caught = arrested + funds seized.', inline:false },
    ],
  },
  {
    title: '🔫 Gun Shop & 🐾 Pets',
    color: 0x888888,
    desc: 'Weapons are gang-exclusive to buy. Pets fight, defend, and earn tokens.',
    fields: [
      { name:'/gunshop · /gunbuy',  value:'Browse and buy weapons. **Gang members only.**',                 inline:false },
      { name:'/shoot @user',        value:'Hit = drain wallet + silence from bot commands temporarily.',    inline:true },
      { name:'/health · /medkit',   value:'Check HP and heal.',                                             inline:true },
      { name:'/petshop',            value:'Adopt a pet ($500–$1M). 10 types from 🐹 Hamster to 🐲 World Serpent.', inline:false },
      { name:'/pet feed/mission/upgrade/guard/evolve', value:'Level up your pet, send on missions, toggle guard mode to intercept attacks.', inline:false },
    ],
  },
  {
    title: '🤖 AI Entities & ✨ Item Effects',
    color: 0x5865f2,
    desc: 'Shop items with powerful effects. AI companions that react to how you treat them.',
    fields: [
      { name:'🤖 AI Entities',  value:'Items can spawn AI companions. Talk with `/talk`. Treat them well — neglect = **rogue**.\n\nArchetypes: 🤖 Robot · 📱 Phone · 🧠 Companion · 🚁 Drone · 💬 Assistant', inline:false },
      { name:'✨ Effect Types', value:'Drain · Silence · Hitman · Shield · Passive Income · Consume Buff · Magic Chain · AI Entity · **Laptop** · **Minigame Drain**', inline:false },
      { name:'💻 Laptop Items', value:'Useable laptop item gives access to the `/laptop` command for routing-number account access.', inline:true },
      { name:'💊 Drug Items',   value:'Store items can be flagged as **drugs**. Police calls check inventory for drug items.', inline:true },
      { name:'/status (!buffs)',value:'Check active buffs.',  inline:true },
      { name:'/use <item>',     value:'Use an item.',        inline:true },
    ],
  },
  {
    title: '📋 Rules & Notes',
    color: 0xf5c518,
    desc: 'Read before playing.',
    fields: [
      { name:'💰 Economy',     value:'• Robbing, hacking, and attacks are part of the game\n• Protected role members cannot be robbed or attacked\n• `/pay` is instant — no confirmation', inline:false },
      { name:'🏴 Gangs',       value:'• Only gang members can BUY guns (anyone can be shot)\n• Crimes build police heat → too much = raid + jail\n• Dirty money must be laundered before spending', inline:false },
      { name:'📱 Influencers', value:'• Phone is separate from business — you can have both\n• Shouting out a coin moves its actual market price\n• False police reports land YOU in jail', inline:false },
      { name:'💻 Hacking',     value:'• Stolen money is HOT — mix through Bitcoin before using\n• Business owners get alerts when $5k+ is taken\n• Routing numbers are private — never share in DMs', inline:false },
      { name:'🔒 Prison',      value:'• Jail time is enforced by Discord role — you literally can\'t chat anywhere else\n• Solitary = read-only in prison chat\n• Auto-released when timer expires', inline:false },
    ],
  },
];

module.exports = {
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
