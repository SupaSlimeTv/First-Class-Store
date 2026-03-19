const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getGangByMember, saveGang, getPoliceRecord, savePoliceRecord } = require('../../utils/gangDb');
const { addHeat, checkPoliceRaid, isJailed, getJailTimeLeft, getHeatLevel } = require('../../utils/police');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

// Street crimes available to everyone
const STREET_CRIMES = [
  { id:'pickpocket', name:'Pickpocket',    heat:5,  cd:5,   risk:0.15, min:50,   max:200,  gangPct:0.10, desc:'Lifted a wallet from a distracted tourist.', type:'street' },
  { id:'carjack',    name:'Carjack',       heat:15, cd:15,  risk:0.25, min:300,  max:800,  gangPct:0.15, desc:"Took someone's ride. Left the aux cord.", type:'street' },
  { id:'heist',      name:'Store Heist',   heat:25, cd:30,  risk:0.35, min:500,  max:2000, gangPct:0.15, desc:'Hit the corner store. Classic.', type:'street' },
  { id:'mugging',    name:'Mugging',       heat:12, cd:10,  risk:0.20, min:100,  max:500,  gangPct:0.10, desc:'Caught someone slipping. Their loss.', type:'street' },
  { id:'bankjob',    name:'Bank Job',      heat:40, cd:60,  risk:0.45, min:1000, max:5000, gangPct:0.20, desc:'You and the crew hit the vault.', type:'street' },
  { id:'murder',     name:'Hit Job',       heat:80, cd:120, risk:0.60, min:2000, max:8000, gangPct:0.20, desc:'Carried out a hit. Messy but effective.', type:'street' },
];

// Mafia-exclusive crimes — unlocked when type=mafia
const MAFIA_CRIMES = [
  { id:'extortion',    name:'Extortion',         heat:20, cd:20,  risk:0.20, min:500,  max:3000, gangPct:0.30, desc:'Convinced a business owner to pay... protection money.', type:'mafia' },
  { id:'moneylaundering', name:'Money Laundering', heat:30, cd:45, risk:0.30, min:1000, max:6000, gangPct:0.25, desc:'Ran dirty money through a shell company. Clean now.', type:'mafia' },
  { id:'bribery',      name:'Police Bribery',     heat:-20,cd:60,  risk:0.25, min:0,    max:0,    gangPct:0,    desc:'Paid off a cop. Heat reduced significantly.', type:'mafia', special:'reduce_heat' },
  { id:'contract_hit', name:'Contract Hit',       heat:60, cd:90,  risk:0.50, min:3000, max:12000,gangPct:0.25, desc:'Accepted a contract. Professional, quiet, effective.', type:'mafia' },
  { id:'trafficking',  name:'Smuggling Run',      heat:35, cd:75,  risk:0.40, min:2000, max:8000, gangPct:0.30, desc:'Moved a shipment across borders. No questions asked.', type:'mafia' },
  { id:'assassination', name:'Assassination',     heat:90, cd:180, risk:0.65, min:5000, max:20000,gangPct:0.20, desc:'High profile target eliminated. This will make headlines.', type:'mafia' },
];

const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gangcrime')
    .setDescription('Commit a crime for your gang.')
    .addStringOption(o => o.setName('crime').setDescription('Crime to commit').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const gang = getGangByMember(interaction.user.id);
    const isMafia = gang?.gangType === 'mafia';
    const crimes  = isMafia ? [...STREET_CRIMES, ...MAFIA_CRIMES] : STREET_CRIMES;
    const typed   = interaction.options.getFocused().toLowerCase();
    const choices = crimes
      .filter(c => c.name.toLowerCase().includes(typed))
      .map(c => ({ name: `${c.type==='mafia'?'👔 ':'🔫 '}${c.name} (Heat ${c.heat>0?'+':''}${c.heat}, CD ${c.cd}m)`, value: c.id }))
      .slice(0, 25);
    await interaction.respond(choices);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const userId  = interaction.user.id;
    const crimeId = interaction.options.getString('crime');

    if (isJailed(userId)) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x003580).setTitle('🚔 Jailed').setDescription(`Release in **${getJailTimeLeft(userId)} minutes**.`)], ephemeral: true });

    const myGang = getGangByMember(userId);
    if (!myGang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You need to be in a gang.")], ephemeral: true });

    const allCrimes = [...STREET_CRIMES, ...MAFIA_CRIMES];
    const crime     = allCrimes.find(c => c.id === crimeId);
    if (!crime) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Unknown crime.")], ephemeral: true });

    // Mafia crime restriction
    if (crime.type === 'mafia' && myGang.gangType !== 'mafia') {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('👔 Mafia Only').setDescription(`**${crime.name}** is a Mafia operation. Street gangs can't pull this off.\n\nUpgrade your gang type with \`/gangupgrade\` once you meet the requirements.`)], ephemeral: true });
    }

    // Police on payroll reduces heat for mafia
    const onPayroll = myGang.policeOnPayroll || 0;

    // Cooldown check
    const cdKey   = `${userId}_${crimeId}`;
    const lastUse = cooldowns.get(cdKey);
    if (lastUse && Date.now() - lastUse < crime.cd * 60_000) {
      const left = Math.ceil((crime.cd * 60_000 - (Date.now() - lastUse)) / 60000);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Lay low for **${left} more minute(s)**.`)], ephemeral: true });
    }
    cooldowns.set(cdKey, Date.now());

    // Special: bribery reduces heat instead of earning money
    if (crime.special === 'reduce_heat') {
      const record = getPoliceRecord(userId);
      const heatReduction = 20 + onPayroll * 5;
      record.heat  = Math.max(0, (record.heat||0) - heatReduction);
      savePoliceRecord(userId, record);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x003580)
        .setTitle('👮 Bribe Paid')
        .setDescription(`You slipped a cop some cash.\n\n🌡️ Heat reduced by **${heatReduction}** points.\nNew heat: ${record.heat}`)
      ]});
    }

    const caught = Math.random() < (crime.risk * (1 - onPayroll * 0.05));
    const effectiveHeat = Math.max(0, crime.heat - onPayroll * 3);
    const record = addHeat(userId, effectiveHeat, crime.id);
    const heatLvl = getHeatLevel(record.heat);

    if (caught) {
      const user     = getOrCreateUser(userId);
      const fine     = Math.floor(user.wallet * 0.2);
      user.wallet    = Math.max(0, user.wallet - fine);
      const jailMins = crime.cd;
      record.jailUntil = Date.now() + jailMins * 60_000;
      savePoliceRecord(userId, record);
      saveUser(userId, user);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x003580)
        .setTitle('🚔 Caught!')
        .setDescription(`Caught during **${crime.name}**!\n\n*${crime.desc}*\n\n💸 Fined **$${fine.toLocaleString()}**\n⏰ Jailed **${jailMins} minutes**\n🌡️ ${record.heat} heat — ${heatLvl.name}`)
      ]});
    }

    const payout  = Math.floor(crime.min + Math.random() * (crime.max - crime.min));
    const gangCut = Math.floor(payout * crime.gangPct);
    const userCut = payout - gangCut;

    const user  = getOrCreateUser(userId);
    user.wallet += userCut;
    myGang.bank  = (myGang.bank || 0) + gangCut;
    const member = myGang.members.find(m => m.userId === userId);
    if (member) { member.rep = (member.rep||0)+crime.heat; myGang.rep=(myGang.rep||0)+Math.floor(crime.heat/2); }
    saveUser(userId, user);
    saveGang(myGang.id, myGang);

    const config = require('../../utils/db').getConfig();
    const raid   = await checkPoliceRaid(userId, interaction.client, config.purgeChannelId);

    const mafiaTag = crime.type==='mafia' ? ' 👔' : ' 🔫';
    const embed = new EmbedBuilder()
      .setColor(crime.type==='mafia' ? 0x2c3e50 : 0xff3b3b)
      .setTitle(`💰 ${crime.name} — Success!${mafiaTag}`)
      .setDescription(`*${crime.desc}*`)
      .addFields(
        { name:'💵 Your Cut',    value:`$${userCut.toLocaleString()}`,                   inline:true },
        { name:'🏦 Gang Bank',   value:`+$${gangCut.toLocaleString()} (${Math.round(crime.gangPct*100)}%)`, inline:true },
        { name:'🌡️ Heat',       value:`${record.heat} — ${heatLvl.name}`,               inline:true },
        { name:'💵 Wallet',      value:`$${user.wallet.toLocaleString()}`,               inline:true },
      );

    if (raid) embed.addFields({ name:'🚔 RAIDED!', value:`Lost $${raid.stolen.toLocaleString()} and jailed ${raid.jailTime} mins!` });
    return interaction.reply({ embeds: [embed] });
  },
};
