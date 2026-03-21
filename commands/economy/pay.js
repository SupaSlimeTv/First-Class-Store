const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, hasAccount } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Send money to another player.')
    .addUserOption(o => o.setName('user').setDescription('Who to pay').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('from').setDescription('Send from wallet or bank').setRequired(false)
      .addChoices(
        { name:'💵 Wallet', value:'wallet' },
        { name:'🏦 Bank',   value:'bank'   },
      )),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const from   = interaction.options.getString('from') || 'wallet';

    if (target.id === interaction.user.id) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't pay yourself.")], ephemeral:true });
    if (target.bot) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't pay bots.")], ephemeral:true });
    if (!hasAccount(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> doesn't have an account yet.`)], ephemeral:true });

    const sender = getOrCreateUser(interaction.user.id);
    const balance = from === 'bank' ? sender.bank : sender.wallet;

    if (balance < amount) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You only have **$${balance.toLocaleString()}** in your ${from}. Not enough to send **$${amount.toLocaleString()}**.`)
      ], ephemeral:true });
    }

    if (from === 'bank') sender.bank -= amount;
    else sender.wallet -= amount;
    saveUser(interaction.user.id, sender);

    const receiver = getOrCreateUser(target.id);
    receiver.wallet += amount;
    saveUser(target.id, receiver);

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('💸 Payment Sent')
      .setDescription(`<@${interaction.user.id}> sent **$${amount.toLocaleString()}** to <@${target.id}>!`)
      .addFields(
        { name:`${interaction.user.username}'s ${from}`, value:`$${(from==='bank'?sender.bank:sender.wallet).toLocaleString()}`, inline:true },
        { name:`${target.username}'s Wallet`,            value:`$${receiver.wallet.toLocaleString()}`,                           inline:true },
      )
    ]});
  },
};
