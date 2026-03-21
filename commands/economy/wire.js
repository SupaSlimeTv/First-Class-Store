const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, hasAccount } = require('../../utils/db');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wire')
    .setDescription('Request or send a large wire transfer — recipient must confirm.')
    .addUserOption(o => o.setName('user').setDescription('Who to wire money to').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to wire').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('from').setDescription('Send from wallet or bank').setRequired(false)
      .addChoices(
        { name:'💵 Wallet', value:'wallet' },
        { name:'🏦 Bank',   value:'bank'   },
      ))
    .addStringOption(o => o.setName('note').setDescription('Optional note/memo').setRequired(false).setMaxLength(100)),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const from   = interaction.options.getString('from') || 'bank';
    const note   = interaction.options.getString('note') || '';

    if (target.id === interaction.user.id) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't wire to yourself.")], ephemeral:true });
    if (target.bot) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Can't wire to bots.")], ephemeral:true });
    if (!hasAccount(target.id)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${target.id}> doesn't have an account yet.`)], ephemeral:true });

    const sender  = getOrCreateUser(interaction.user.id);
    const balance = from === 'bank' ? sender.bank : sender.wallet;

    if (balance < amount) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You only have **$${balance.toLocaleString()}** in your ${from}. Not enough to wire **$${amount.toLocaleString()}**.`)
      ], ephemeral:true });
    }

    const embed = new EmbedBuilder()
      .setColor(0x00d2ff)
      .setTitle('🏦 Wire Transfer Request')
      .setDescription(`<@${interaction.user.id}> wants to wire you money. Do you accept?`)
      .addFields(
        { name:'💰 Amount',   value:`$${amount.toLocaleString()}`,  inline:true },
        { name:'📤 From',     value:`${interaction.user.username}'s ${from}`, inline:true },
        { name:'⏱️ Expires',  value:'90 seconds',                   inline:true },
        ...(note ? [{ name:'📝 Note', value:note, inline:false }] : []),
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('wire_accept').setLabel('✅ Accept Wire').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('wire_decline').setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({ content:`<@${target.id}> — incoming wire transfer!`, embeds:[embed], components:[row] });
    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 90_000 });

    collector.on('collect', async btn => {
      if (btn.user.id !== target.id) return btn.reply({ content:'Only the recipient can respond.', ephemeral:true });

      if (btn.customId === 'wire_decline') {
        await btn.update({ embeds:[new EmbedBuilder().setColor(0x888888).setTitle('❌ Wire Declined').setDescription(`<@${target.id}> declined the wire transfer.`)], components:[] });
        return collector.stop();
      }

      // Re-check balance at time of acceptance
      const freshSender = getOrCreateUser(interaction.user.id);
      const freshBalance = from === 'bank' ? freshSender.bank : freshSender.wallet;
      if (freshBalance < amount) {
        await btn.update({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`<@${interaction.user.id}> no longer has enough funds.`)], components:[] });
        return collector.stop();
      }

      if (from === 'bank') freshSender.bank -= amount;
      else freshSender.wallet -= amount;
      saveUser(interaction.user.id, freshSender);

      const receiver = getOrCreateUser(target.id);
      receiver.wallet += amount;
      saveUser(target.id, receiver);

      await btn.update({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Wire Transfer Complete')
        .setDescription(`**$${amount.toLocaleString()}** successfully wired from <@${interaction.user.id}> to <@${target.id}>!`)
        .addFields(
          { name:`${interaction.user.username}'s ${from}`, value:`$${(from==='bank'?freshSender.bank:freshSender.wallet).toLocaleString()}`, inline:true },
          { name:`${target.username}'s Wallet`,            value:`$${receiver.wallet.toLocaleString()}`,                                      inline:true },
          ...(note ? [{ name:'📝 Note', value:note, inline:false }] : []),
        )
      ], components:[] });
      collector.stop();
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x888888).setTitle('⏱️ Wire Expired').setDescription('Recipient did not respond in 90 seconds.')], components:[] }).catch(()=>{});
      }
    });
  },
};
