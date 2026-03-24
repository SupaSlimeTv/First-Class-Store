// ============================================================
// commands/moderation/depression.js — /depression
// Owner-only command to crash the entire server economy.
// Also triggered via prefix: !depression
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getAllUsers, getConfig, saveConfig } = require('../../utils/db');
const { depressionEmbed, COLORS } = require('../../utils/embeds');

async function runDepression(guild, config, triggeredBy) {
  // 1. Wipe all wallets and banks for guild members
  try {
    const members    = await guild.members.fetch();
    const allUsers   = getAllUsers();
    let wiped = 0;
    for (const [memberId] of members) {
      if (allUsers[memberId]) {
        const u = getOrCreateUser(memberId);
        u.wallet = 0;
        u.bank   = 0;
        saveUser(memberId, u);
        wiped++;
      }
    }

    // 2. Wipe business revenues
    try {
      const bizDb = require('../../utils/bizDb');
      const allBiz = bizDb.getAllBusinesses();
      for (const [ownerId, biz] of Object.entries(allBiz)) {
        const member = members.get(ownerId);
        if (!member) continue;
        const businesses = Array.isArray(biz) ? biz : [biz];
        for (const b of businesses) {
          b.revenue = 0;
        }
        bizDb.saveBusinesses ? bizDb.saveBusinesses(ownerId, businesses) : null;
      }
    } catch {}

    // 3. Wipe gang dirty money for gangs in this guild
    try {
      const { getAllGangs, saveGang } = require('../../utils/gangDb');
      const { getGangGoons, saveGangGoons } = require('../../utils/goonDb');
      const gangs = getAllGangs();
      for (const [id, gang] of Object.entries(gangs)) {
        if (!(gang.members||[]).some(m => members.has(m.userId||m))) continue;
        const gd = getGangGoons(id);
        gd.dirtyMoney = 0;
        await saveGangGoons(id, gd);
      }
    } catch {}

    // 4. Mark depression active in config
    config.depressionActive    = true;
    config.depressionStartTime = Date.now();
    config.depressionBy        = triggeredBy;
    saveConfig(guild.id, config);

    return wiped;
  } catch(e) {
    console.error('Depression error:', e.message);
    return 0;
  }
}

module.exports = {
  runDepression,
  data: new SlashCommandBuilder()
    .setName('depression')
    .setDescription('💀 Crash the entire server economy — wipes all wallets, banks, and revenues (owner only)')
    .addStringOption(o => o.setName('confirm').setDescription('Type CONFIRM to execute').setRequired(true)),

  async execute(interaction) {
    // Owner only
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('🚫 Only the **server owner** can trigger the Great Depression.')
      ], ephemeral:true });
    }

    const confirm = interaction.options.getString('confirm');
    if (confirm !== 'CONFIRM') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
      .setDescription('Type exactly `CONFIRM` to execute. This cannot be undone.')
    ], ephemeral:true });

    await interaction.deferReply();

    const config = getConfig(interaction.guildId);
    const wiped  = await runDepression(interaction.guild, config, interaction.user.id);

    // Announce in channel
    const gifUrl = config.depressionGif || null;
    await interaction.editReply({ embeds:[depressionEmbed(true, gifUrl)] });
    await interaction.followUp({ content:`💀 Economy crashed. **${wiped}** accounts wiped to $0.`, ephemeral:true });
  },
};
