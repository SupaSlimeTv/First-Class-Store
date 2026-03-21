const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllUsers, getConfig, getStore } = require('../../utils/db');
const { getAllGangs } = require('../../utils/gangDb');
const { getAllBusinesses } = require('../../utils/bizDb');
const { getAllPets } = require('../../utils/petDb');
const fs   = require('fs');
const path = require('path');

function isAdmin(member) {
  return member.permissions.has('Administrator') || member.permissions.has('ManageGuild');
}

function getWarningCount() {
  try {
    const f = path.join(__dirname, '../../data/warnings.json');
    if (!fs.existsSync(f)) return 0;
    const w = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Object.values(w).reduce((s, arr) => s + arr.length, 0);
  } catch { return 0; }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('overview')
    .setDescription('Server economy overview — admin only.')
    .setDefaultMemberPermissions(0x20), // Manage Guild

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content:'❌ You need **Administrator** or **Manage Server** permission.', ephemeral:true });
    }
    await interaction.deferReply();
    await buildAndSend(interaction, interaction.guild);
  },

  // Called by prefix handler
  async executePrefix(message) {
    if (!message.member.permissions.has('Administrator') && !message.member.permissions.has('ManageGuild')) {
      return message.reply('❌ You need **Administrator** or **Manage Server** permission.');
    }
    await buildAndSendPrefix(message, message.guild);
  },
};

async function buildOverviewEmbed(guild, guildId) {
  const users       = getAllUsers();
  const userList    = Object.values(users);
  const accounts    = userList.filter(u => u.accountOpen !== false);
  const totalMoney  = userList.reduce((s, u) => s + (u.wallet||0) + (u.bank||0), 0);
  const store       = getStore();
  const config      = getConfig(guildId);
  const gangs       = getAllGangs();
  const businesses  = getAllBusinesses ? Object.keys(getAllBusinesses()) : [];
  const pets        = getAllPets ? Object.keys(getAllPets()) : [];
  const warnings    = getWarningCount();

  // Guild member count from Discord
  let memberCount = guild.memberCount || '?';
  try { await guild.members.fetch(); memberCount = guild.memberCount; } catch {}

  const purge = config.purgeActive;
  const purgeStr = purge
    ? '🔴 **PURGE IS ACTIVE**'
    : '🟢 Purge Off';

  const fmtMoney = (n) => {
    if (n >= 1e12) return '$' + (n/1e12).toFixed(1) + 'T';
    if (n >= 1e9)  return '$' + (n/1e9).toFixed(1)  + 'B';
    if (n >= 1e6)  return '$' + (n/1e6).toFixed(1)  + 'M';
    if (n >= 1e3)  return '$' + Math.round(n).toLocaleString();
    return '$' + n;
  };

  return new EmbedBuilder()
    .setColor(purge ? 0xff3b3b : 0x2ecc71)
    .setTitle(`📊 ${guild.name} — Server Overview`)
    .setThumbnail(guild.iconURL())
    .addFields(
      { name:'👥 Server Members',   value:memberCount.toLocaleString(),               inline:true },
      { name:'📂 Accounts Open',    value:accounts.length.toLocaleString(),           inline:true },
      { name:'💰 Economy Total',    value:fmtMoney(totalMoney),                       inline:true },
      { name:'🏪 Store Items',      value:(store.items||[]).length.toLocaleString(),  inline:true },
      { name:'🏴 Active Gangs',     value:gangs.length.toLocaleString(),              inline:true },
      { name:'🏢 Businesses',       value:businesses.length.toLocaleString(),         inline:true },
      { name:'🐾 Pets Owned',       value:pets.length.toLocaleString(),               inline:true },
      { name:'⚠️ Total Warnings',   value:warnings.toLocaleString(),                  inline:true },
      { name:'⚙️ Prefix',           value:`\`${config.prefix || '!'}\``,              inline:true },
      { name:'🌩️ Purge Status',     value:purgeStr,                                   inline:false },
    )
    .setFooter({ text:`Use the dashboard for full control · Lottery: ${config.lottery?.active ? 'Active' : 'Off'}` })
    .setTimestamp();
}

async function buildAndSend(interaction, guild) {
  const embed = await buildOverviewEmbed(guild, guild.id);
  await interaction.editReply({ embeds:[embed] });
}

async function buildAndSendPrefix(message, guild) {
  const embed = await buildOverviewEmbed(guild, guild.id);
  await message.reply({ embeds:[embed] });
}
