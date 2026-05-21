// ============================================================
// commands/fun/info.js — /info
// Full bot guide for regular users — all systems documented
// ============================================================
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PAGES = [
  // Page 1: Getting Started
  new EmbedBuilder().setColor(0x5865f2)
    .setTitle('📖 First Class Store — Bot Guide (1/18)')
    .setDescription('Welcome to **First Class Store** — a full economy simulation with crime, business, fame, and more.\n\nNavigate pages with the buttons below.')
    .addFields(
      { name:'🏦 Getting Started', value:'`open account` — Create your account + get your SSN\n`!bal` — Check wallet & bank\n`!dep <amount>` — Deposit to bank\n`!with <amount>` — Withdraw from bank\n`!daily` — Claim daily reward\n`!work` — Earn hourly income', inline:false },
    ).setFooter({ text:'Page 1/18 · Use arrows to navigate' }),

  // Page 2: Economy
  new EmbedBuilder().setColor(0x2ecc71)
    .setTitle('💵 Economy (2/18)')
    .addFields(
      { name:'💰 Earning Money', value:'`/daily` `/work` `/beg` — Basic income\n`/business` — Own & collect from businesses\n`/home collect` — Passive income from home furnishings\n`/lottery` — Jackpot chance', inline:false },
      { name:'💸 Transferring', value:'`/pay @user <amount>` — Pay someone\n`/give @user <item>` — Gift an item\n`/wire <routing> <amount>` — Wire to business', inline:false },
      { name:'🎰 Gambling', value:'`/slots` `/blackjack` `/coinflip` `/roulette` `/duel`', inline:false },
    ).setFooter({ text:'Page 2/18' }),

  // Page 3: Crime
  new EmbedBuilder().setColor(0xe74c3c)
    .setTitle('🔫 Crime & Street Life (3/18)')
    .addFields(
      { name:'💰 Robbery', value:'`/rob @user` — Steal from wallet\n`/use break-in-kit target:@user` — Break into home (loot stash or rob wallet)', inline:false },
      { name:'🔥 Heat System', value:'`/myheat` — View your heat level\n`/wantedlevel` — See wanted level effects\nHigher heat = more police attention + auto-warrants at 25+ heat', inline:false },
      { name:'💊 Drugs', value:'`/drugmarket` — Browse drug prices\n`/use <drug>` — Use a drug item from inventory', inline:false },
      { name:'🔫 Guns', value:'`/gunshop` — Browse firearms\n`/gunbuy <gun>` — Purchase a gun\n`/shoot @user` — Attack someone\n`/guns` — View your arsenal', inline:false },
    ).setFooter({ text:'Page 3/18' }),

  // Page 4: Home System
  new EmbedBuilder().setColor(0xf5c518)
    .setTitle('🏠 Home System (4/18)')
    .addFields(
      { name:'🏚️ Home Tiers', value:'Studio → House → Mansion → Estate\nHigher tiers = more furnishing slots, better break-in defense, faster passive income', inline:false },
      { name:'🛋️ Furnishings', value:'`/home furnish` — Buy furnishings (select menu)\n• Safe 🔒 — +stash slots +defense\n• Security Camera 📷 — DM alert on break-in\n• Drug Lab 🧪 — Passive dirty income\n• Mining Rig ⛏️ — Passive clean income\n• Panic Room 🛡️ — Escape arrest\n• Grow House 🌿 — Drug production\n• Vault 🏦 — +stash +defense', inline:false },
      { name:'😴 Sleep System', value:'`/home sleep` — Go to sleep (8hr protection from attacks, true AFK)\nAny command wakes you automatically\n12hr cooldown between sleeps', inline:false },
      { name:'📦 Stash & Break-In', value:'`/home stash` — Hide items from police searches\n`/home view` — See your home details\n`/home collect` — Collect passive income\nBreak-in success based on tier defense + attacker kit bonus', inline:false },
    ).setFooter({ text:'Page 4/18' }),

  // Page 5: Business
  new EmbedBuilder().setColor(0x3498db)
    .setTitle('🏢 Business (5/18)')
    .addFields(
      { name:'🏗️ Starting a Business', value:'`/business start type:<type>` — Open a business\n`/business view` — Check revenue & employees\n`/business collect` — Collect earnings\n`/business upgrade` — Level up (more revenue)', inline:false },
      { name:'👥 Employees', value:'`/hire @user` — Hire a real player (max 5)\n`/hirenpc` — Browse & hire NPC staff (max 6)\n`/fire @user` — Remove employee\nEmployees increase revenue generation', inline:false },
      { name:'🎵 Record Label', value:'`/label signnpc` — Sign an NPC artist (10 archetypes)\n`/label sign @user` — Sign a real Celebrity+ user\n`/label promote artist_id: budget:` — Boost fanbase\n`/label roster` — View all signed artists\nRevenue pays every 15 minutes', inline:false },
      { name:'💡 Business Types', value:'Convenience Store, Restaurant, Car Wash, Tech Startup, Real Estate, Crypto Lab, Nightclub, Record Label\nGang leaders can also open: Trap House, Chop Shop, Money Laundromat', inline:false },
    ).setFooter({ text:'Page 5/18' }),

  // Page 6: Gangs
  new EmbedBuilder().setColor(0xe67e22)
    .setTitle('🏴 Gangs (6/18)')
    .addFields(
      { name:'🤝 Joining', value:'`/gang create` — Start a gang (costs money)\n`/ganginvite @user` — Invite members\n`/ganginfo` — View gang stats\n`/gangs` — List all gangs on server', inline:false },
      { name:'💊 Operations', value:'`/gangcrime` — Run a crew crime (split payout)\n`/launder` — Clean dirty money\n`/gangwar` — Declare war on rival gang', inline:false },
      { name:'⬆️ Upgrades', value:'`/gangupgrade` — Buy gang upgrades\nUnlocks: Locksmith, Police Payroll, Safecracker, Drug Network, Gang Vault, and more', inline:false },
      { name:'💼 Gang Payroll', value:'`/gangpayroll offer @officer` — Pay an officer to look away\nPayrolled officers cannot search your members\n30% evasion bonus vs non-payrolled officers', inline:false },
    ).setFooter({ text:'Page 6/18' }),

  // Page 7: Police
  new EmbedBuilder().setColor(0x3498db)
    .setTitle('🚔 Police System (7/18)')
    .addFields(
      { name:'🔒 Prison', value:'`/jail @user` — Jail someone (mod only)\n`/unjail @user` — Release a prisoner\n`/solitary @user` — Send to solitary (read-only)\n`/jailcreate` — Auto-create prison roles/channel', inline:false },
      { name:'🔍 Officer Commands', value:'`/police search @user` — Search for contraband (30min CD per target)\n`/police arrest @user` — Arrest target\n`/police warrant @user` — Issue a warrant\n`/police warrants` — View active warrants\n`/police raid` — Raid a location (3+ officers)', inline:false },
      { name:'💰 Corruption', value:'`/police bribe` — Bribe an officer ($500)\n`/police tip` — Tip off police about someone\n`/police squash` — Squash a warrant (payrolled only)\n`/police leak` — Leak warrant list', inline:false },
    ).setFooter({ text:'Page 7/18' }),

  // Page 8: Phone / Influence
  new EmbedBuilder().setColor(0xf5c518)
    .setTitle('📱 Phone & Influence (8/18)')
    .addFields(
      { name:'📱 Getting Started', value:'`/phoneshop` — Browse phone tiers\n`/phone status` — View your profile, influencer tier & **artist tier**', inline:false },
      { name:'📣 Posting & Growing', value:'`/phone post platform:<platform>` — Post on Flexgram/Chirp/Streamz\nEarns: Status, Hype, Followers, Money, and **Artist Fame**\nStreak bonuses up to 2× at 20-day streak', inline:false },
      { name:'⭐ Influencer Tiers', value:'Newcomer → Content Creator → Influencer → Celebrity → Superstar → Cultural Icon\nUnlocks: coin shoutouts, sponsor slots, bigger earnings, artist operations', inline:false },
      { name:'🎵 Artist Hierarchy', value:'🎙️ Unsigned → 🌆 Local Buzz → 🎵 Indie → 📻 Rising Star → 🎤 Mainstream → 🏆 Platinum → 👑 Legend\nFame grows from every post. Higher tier = more label revenue', inline:false },
      { name:'🎤 Artist Commands', value:'`/phone artist_shoutout @artist` — Influencer+ shouts out an artist (boosts their fame/hype/followers)\n`/phone artist_hate @artist` — Celebrity+ publicly beefs (tanks their stats, creates controversy)\n`/phone promo` — Pay influencers for your own promo boost', inline:false },
      { name:'🌟 Coins & Deals', value:'`/phone shoutout coin:<ticker>` — Celebrity+ boosts a coin price\n`/phone hate coin:<ticker>` — Cultural Icon only, crashes a coin\n`/sponsordeal` — Manage brand sponsorships', inline:false },
    ).setFooter({ text:'Page 8/18' }),

  // Page 9: Crypto/Stocks
  new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('📈 Crypto & Stocks (9/18)')
    .addFields(
      { name:'📊 Trading', value:'`/market` — View all coin prices (live chart)\n`/invest coin:<ticker> amount:<$|all>` — Buy shares\n`/portfolio` — View your holdings\n`/cashout coin:<ticker>` — Sell shares\n`/liquidate` — Sell everything', inline:false },
      { name:'🪙 Custom Coins', value:'`/coincreate` — Create your own coin (requires Crypto Lab business)\n`/coincontrol` — Pump/dump your coin\n`/rugpull` — Destroy your coin (scam investors)', inline:false },
      { name:'🏢 Business Stock Exchange', value:'`/bizstock list` — Browse tradeable business stocks\n`/bizstock buy business:<name> amount:<$>` — Invest in a business\n`/bizstock sell business:<name> percent:<1-100>` — Sell your shares\n`/bizstock portfolio` — View your holdings & P&L\nPrices update every 5 minutes based on business level & earnings', inline:false },
      { name:'📈 Market Events', value:'Celebrity shoutouts spike prices instantly\nIlluminati can manipulate markets for 30 minutes\nMarket prices fluctuate every tick based on volume & hype', inline:false },
    ).setFooter({ text:'Page 9/18' }),

  // Page 10: Credit & Identity
  new EmbedBuilder().setColor(0x2ecc71)
    .setTitle('💳 Credit & Identity (10/18)')
    .addFields(
      { name:'🪪 Your SSN', value:'Assigned when you open your account\n`/credit check` — View SSN (blurred), credit score, card\nKeep it private — others can steal it!', inline:false },
      { name:'💳 Credit Cards', value:'`/credit apply` — Apply based on your score\nScore 580+ required. Limit = % of bank balance\n`/credit spend <amount>` — Charge to card\n`/credit pay <amount|all>` — Pay down balance\n`/credit freeze` — Block identity theft', inline:false },
      { name:'📊 Credit Score', value:'300-579 🔴 Poor · 580-669 🟠 Fair · 670-739 🟡 Good\n740-799 🟢 Very Good · 800-850 💎 Excellent\nGoes up: paying on time, full payoffs\nGoes down: missed payments, fraud, identity theft', inline:false },
      { name:'💼 Business Loans', value:'670+ score required · `/credit loan amount: days:`\nAuto-deducted daily · Default = -80 score', inline:false },
    ).setFooter({ text:'Page 10/18' }),

  // Page 11: Hacking & Dark Web
  new EmbedBuilder().setColor(0x0a0a0a)
    .setTitle('💻 Hacking & Dark Web (11/18)')
    .addFields(
      { name:'💻 Laptop — Built-In', value:'Every account has a **built-in laptop** — no purchase needed.\n`/laptop open` — View apps + workflow guides\n`/laptop appstore` — Install apps from inventory\n`/laptop run app:<app>` — Execute installed app\nApp quality tier = success rate (+5% per tier)', inline:false },
      { name:'🔓 Hacking App Workflows', value:
        '**Credit Fraud path:**\n① **SSN Scanner** `target:@user` — steal their SSN\n② **Credit Cracker** `target:@user` — open fraud card\n③ **Card Drainer** `target:@user` — drain the card\n\n' +
        '**Intel apps:**\n👁️ **Stalker App** — full profile on anyone\n⌨️ **Keylogger** — view your stolen SSN vault\n🔍 **Dark Search** — search TOR market listings\n\n' +
        '**Business Hack:**\n🏢 **Biz Intruder** `routing:<#>` — check/withdraw/launder\n🏦 **Bank Mirror** `routing:<#>` — read balances\n\n' +
        '**Passive:**\n🧺 **LaunderBot** — launder dirty money\n🛡️ **VPN Shield** — reduce TOR trace risk', inline:false },
      { name:'🌐 TOR / Dark Web', value:'`/tor connect` — Get your anonymous handle\n`/tor market` — Browse stolen data listings\n`/tor sell victim: type: price:` — List stolen data\n`/tor buy listing_id:` — Purchase data\n⚠️ **30% trace risk** — Getting caught = jail + heat\n🛡️ VPN Shield app reduces trace risk\n🔺 Illuminati members are untraceable', inline:false },
    ).setFooter({ text:'Page 11/18' }),

  // Page 12: Illuminati
  new EmbedBuilder().setColor(0xf5c518)
    .setTitle('🔺 The Illuminati (12/18)')
    .addFields(
      { name:'🚪 Joining as Member', value:'Invite-only. Requirements:\n🏰 Estate home · 50+ status · Biz level 5+ · $500k wealth *(Power path)*\nOR 🎵 10K artist fame · 👥 1M followers · ⭐ 25K status *(Fame path)*\nInitiation fee: **$250,000** · `/illuminati status` — View org', inline:false },
      { name:'⛓️ Puppet Path — Anyone Can Join', value:'**No requirements to sell your soul as a puppet.**\n`/illuminati sellsoul` → Puppet offer appears for anyone\nCost: **30% of your wallet** into the vault\nNo rank · No voice · No perks · Drained by Soul Harvest\nPuppets appear in the order\'s hierarchy — at the very bottom.', inline:false },
      { name:'👑 Power Hierarchy (Top → Bottom)', value:'⚡ **Grandmaster** — Founded the order · Full control\n💎 **Elder** — Top contributors · Faction leaders\n👁️ **Operative** — Trusted members · Op access\n🔺 **Initiate** — New members · Soul sold\n─────────────────\n⛓️ **Puppet** — Soul-sold outsiders · No rank · Harvested freely', inline:false },
      { name:'⚡ Operations', value:'🕵️ Shadow Rob · 📡 Intel · 🛡️ Protection Racket\n📊 Market Manipulation · 💸 Collect Tribute\n📸 Blackmail · 🎵 Force Sign · 🎤 Sabotage Artist\n🔇 Silence Campaign · 💰 Extort · 🌱 Industry Plant', inline:false },
      { name:'🎁 Member Perks', value:'✅ 2 legit businesses · ✅ TOR untraceable\n✅ Police warrants need 2× heat\n✅ Shoutout redirects → vault · ✅ Label revenue 2×', inline:false },
    ).setFooter({ text:'Page 12/18' }),

  // Page 13: Voodoo
  new EmbedBuilder().setColor(0x2c0a3f)
    .setTitle('🕯️ Voodoo (13/18)')
    .addFields(
      { name:'🕯️ Getting Started', value:'`/voodoo initiate` — Begin your voodoo journey (**$50,000** one-time)\n`/voodoo status` — View your standing, energy & cooldowns\n`/voodoo ritual deity:<spirit>` — Perform a ritual', inline:false },
      { name:'☠️ The Six Lwa (Spirits)', value:
        '☠️ **Baron Samedi** — Death & protection · $25k · 60% success\n' +
        '💕 **Erzulie Freda** — Love & wealth · $15k · 55% success\n' +
        '⚔️ **Ogou** — War & strength · $20k · 65% success\n' +
        '🔑 **Papa Legba** — Crossroads & fate · $10k · 50/50\n' +
        '🌿 **Ayizan** — Commerce & healing · $30k · 70% success\n' +
        '🕯️ **Maman Brigitte** — Hex & justice · $40k · requires target',
        inline:false },
      { name:'💰 How It Works', value:'• Each ritual costs money as a **spirit offering**\n• Spirits roll the dice — success or failure is never guaranteed\n• **Success:** Major money payouts ($20k–$120k depending on spirit)\n• **Failure:** The spirit takes MORE from your wallet as punishment\n• Each spirit has a **cooldown** before they answer again (2–4 days)\n• Maman Brigitte can drain a **target\'s** wallet — or backfires on you', inline:false },
      { name:'⚡ Voodoo Energy', value:'Gained on ritual success (+2), lost on failure (-1)\nHigher energy means the spirits trust you more\n*Track it with `/voodoo status`*', inline:false },
    ).setFooter({ text:'Page 13/18 · All ritual outcomes are random — spend wisely' }),

  // Page 14: Pets
  new EmbedBuilder().setColor(0x2ecc71)
    .setTitle('🐾 Pets (14/18)')
    .addFields(
      { name:'🐾 Adopting', value:'`/petshop` — Browse available pets\n`/pet adopt <pet>` — Adopt a pet\n`/pets` — View all your pets\n`/pet feed` `/pet play` — Keep your pet happy', inline:false },
      { name:'⚔️ Combat', value:'`/petattack @user` — Send your pet to attack\nPet level determines damage & protection\nHigher level pets deal more damage and better protect you', inline:false },
    ).setFooter({ text:'Page 14/18' }),

  // Page 15: AI Entities
  new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('🤖 AI Entities (15/18)')
    .addFields(
      { name:'🤖 What They Are', value:'AI companions spawned by items in the store\nArchetypes: Robot, Phone, Computer, Drone, Assistant\n`/myai` — View your AI entity\n`/talk @entity` — Interact with an AI', inline:false },
      { name:'🎭 Effects', value:'AIs can give passive income, role changes, drain wallets\nStrength scales with owner status and item quality\nNeglect them or they become rogue', inline:false },
    ).setFooter({ text:'Page 15/18' }),

  // Page 16: Prefix Commands
  new EmbedBuilder().setColor(0x888888)
    .setTitle('⌨️ Prefix Commands (16/18)')
    .addFields(
      { name:'📋 Shortcuts', value:'Default prefix: `!` (configurable per server)\n`!bal` · `!dep` · `!with` · `!daily` · `!work` · `!beg`\n`!rob @user` · `!pay @user <amt>`\n`!depression CONFIRM` (owner only)', inline:false },
      { name:'🔧 Admin Prefix', value:'`!purge` · `!jail @user` · `!unjail @user`\n`!ban @user` · `!kick @user` · `!mute @user`', inline:false },
    ).setFooter({ text:'Page 16/18' }),

  // Page 17: New Features Summary
  new EmbedBuilder().setColor(0x00d2ff)
    .setTitle('🆕 Recent Additions (17/18)')
    .addFields(
      { name:'💻 Laptop — Now Built-In', value:'Every account has a built-in laptop. No store purchase needed.\n`/laptop open` — See full workflow guides for credit fraud, business hacking, and more\n`/laptop appstore` — Install apps · `/laptop run` — Execute them', inline:false },
      { name:'🏢 Business Stock Exchange', value:'Trade shares in user-created businesses like a real stock market.\n`/bizstock list` — Browse · `/bizstock buy` — Invest · `/bizstock sell` — Cash out\n`/bizstock portfolio` — Track your holdings and P&L', inline:false },
      { name:'⛓️ Illuminati Puppet System', value:'Anyone can sell their soul as a Puppet — no requirements.\n`/illuminati sellsoul` — Either join as a member (high reqs) or become a puppet (30% wallet)\nPuppets appear in the hierarchy below all members and are drained by Soul Harvest rituals.', inline:false },
      { name:'🕯️ Voodoo', value:'Commune with the Lwa (Haitian spirits) for money, protection, or revenge.\n`/voodoo initiate` — $50k one-time · `/voodoo ritual deity:<name>` — Roll the dice\nSix spirits, each with unique payouts, costs, and failure consequences.', inline:false },
    ).setFooter({ text:'Page 17/18 · These systems are all live — try them now' }),

  // Page 18: Tips
  new EmbedBuilder().setColor(0x5865f2)
    .setTitle('💡 Pro Tips (18/18)')
    .addFields(
      { name:'🏆 Getting Ahead', value:'• Sleep at home to avoid being robbed\n• Freeze your credit before you go AFK\n• Use a VPN Shield app before TOR activity\n• Keep your SSN private — never share it\n• Diversify: business + investments + label artists', inline:false },
      { name:'🔺 End Game', value:'• Found the Illuminati and control the economy\n• Reach Icon status on your phone\n• Own an Estate with all furnishings maxed\n• Build a record label empire with 10+ artists\n• Become the most wanted criminal on the server\n• Sell your soul for power — or harvest those who did', inline:false },
    ).setFooter({ text:'Page 18/18 · Use /admininfo for server admin guide' }),
];

const buildRow = (page, total) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('info_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
  new ButtonBuilder().setCustomId('info_page').setLabel(`${page+1}/${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
  new ButtonBuilder().setCustomId('info_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === total-1),
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('📖 Full guide to every bot feature'),

  async execute(interaction) {
    let page = 0;
    await interaction.reply({ embeds:[PAGES[0]], components:[buildRow(0, PAGES.length)], ephemeral:true });
    const msg = await interaction.fetchReply();
    const coll = msg.createMessageComponentCollector({ filter:i=>i.user.id===interaction.user.id, time:10*60*1000 });
    coll.on('collect', async i => {
      if (i.customId === 'info_prev' && page > 0) page--;
      if (i.customId === 'info_next' && page < PAGES.length-1) page++;
      await i.update({ embeds:[PAGES[page]], components:[buildRow(page, PAGES.length)] });
    });
    coll.on('end', () => interaction.editReply({ components:[] }).catch(()=>{}));
  },
};
