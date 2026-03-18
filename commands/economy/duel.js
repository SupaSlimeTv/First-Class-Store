const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, getUser, saveUser } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const pendingDuels = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('duel')
    .setDescription('Challenge someone to a winner-takes-all coin flip.')
    .addUserOption(o => o.setName('target').setDescription('Who to challenge').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to wager from your wallet').setRequired(true).setMinValue(10)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('target');
    const amount = interaction.options.getInteger('amount');

    if (target.id === interaction.user.id) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't duel yourself.")], ephemeral: true });
    if (target.bot) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't duel a bot.")], ephemeral: true });

    const challenger = getOrCreateUser(interaction.user.id);
    if (amount > challenger.wallet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You only have **$${challenger.wallet.toLocaleString()}** in your wallet.`)], ephemeral: true });

    const targetData = getUser(target.id);
    if (!targetData) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${target.username}** doesn't have an account yet.`)], ephemeral: true });
    if (amount > targetData.wallet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`**${target.username}** only has **$${targetData.wallet.toLocaleString()}** — they can't match your bet.`)], ephemeral: true });

    const duelId = `${interaction.user.id}_${target.id}_${Date.now()}`;
    pendingDuels.set(duelId, { challengerId: interaction.user.id, targetId: target.id, amount });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`duel_accept_${duelId}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`duel_decline_${duelId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({
      content: `<@${target.id}>`,
      embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('⚔️ Duel Challenge!')
        .setDescription(`**${interaction.user.username}** challenges **${target.username}** to a duel!\n\nWager: **$${amount.toLocaleString()}** each\nWinner takes **$${(amount * 2).toLocaleString()}** total.\n\nDo you accept?`)
        .setFooter({ text: 'Challenge expires in 60 seconds' })
      ],
      components: [row],
    });

    // Handle button clicks
    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 60_000 });

    collector.on('collect', async btn => {
      if (btn.user.id !== target.id) return btn.reply({ content: "This duel isn't for you.", ephemeral: true });

      collector.stop();
      pendingDuels.delete(duelId);

      if (btn.customId.startsWith('duel_decline')) {
        return btn.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('⚔️ Duel Declined').setDescription(`**${target.username}** backed down from the challenge.`)], components: [] });
      }

      // Accept — run the duel
      const c = getOrCreateUser(interaction.user.id);
      const t = getOrCreateUser(target.id);

      if (amount > c.wallet || amount > t.wallet) {
        return btn.update({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ Duel Failed').setDescription('One of you no longer has enough money.')], components: [] });
      }

      const challengerWins = Math.random() < 0.5;
      if (challengerWins) {
        c.wallet += amount; t.wallet -= amount;
      } else {
        c.wallet -= amount; t.wallet += amount;
      }
      saveUser(interaction.user.id, c);
      saveUser(target.id, t);

      const winner = challengerWins ? interaction.user.username : target.username;
      const loser  = challengerWins ? target.username : interaction.user.username;

      await btn.update({
        embeds: [new EmbedBuilder()
          .setColor(0xf5c518)
          .setTitle('⚔️ Duel Complete!')
          .setDescription(`🎉 **${winner}** wins the duel!\n💸 **${loser}** pays **$${amount.toLocaleString()}**`)
          .addFields(
            { name: `${interaction.user.username}'s Wallet`, value: `$${c.wallet.toLocaleString()}`, inline: true },
            { name: `${target.username}'s Wallet`,           value: `$${t.wallet.toLocaleString()}`, inline: true },
          )
        ],
        components: [],
      });
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        pendingDuels.delete(duelId);
        interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('⚔️ Duel Expired').setDescription('The challenge was not accepted in time.')], components: [] }).catch(() => {});
      }
    });
  },
};
