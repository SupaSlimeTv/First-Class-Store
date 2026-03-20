const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getConfig } = require('../../utils/db');
const { errorEmbed, COLORS } = require('../../utils/embeds');
const { noAccount } = require('../../utils/accountCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('collect')
    .setDescription('Collect income from your roles.'),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const config     = getConfig(interaction.guildId);
    const roleIncome = config.roleIncome || {};
    const now        = Date.now();
    const memberRoles = interaction.member.roles.cache.map(r => r.id);
    const eligible    = Object.entries(roleIncome).filter(([roleId]) => memberRoles.includes(roleId));
    if (!eligible.length) return interaction.reply({ embeds: [errorEmbed("You don't have any roles that earn income.")], ephemeral: true });

    const user = getOrCreateUser(interaction.user.id);
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

    saveUser(interaction.user.id, user);
    if (!collected.length) return interaction.reply({ embeds: [errorEmbed('Nothing ready to collect yet:\n' + onCooldown.join('\n'))], ephemeral: true });

    let desc = collected.join('\n');
    if (onCooldown.length) desc += '\n\n**Still on cooldown:**\n' + onCooldown.join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.DAILY).setTitle('💼 Income Collected!').setDescription(desc).addFields({name:'💵 Wallet',value:`$${user.wallet.toLocaleString()}`,inline:true},{name:'🏦 Bank',value:`$${user.bank.toLocaleString()}`,inline:true})] });
  },
};
