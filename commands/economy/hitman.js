// ============================================================
// commands/economy/hitman.js
// Slash command: /hitman <target> <action>
//
// Requires a "hitman" item in inventory.
// Actions:
//   rob     — steal 50% of target's TOTAL balance (wallet+bank)
//   silence — ban target from using the bot for 24 hours
//
// Dice roll (50/50):
//   SUCCESS → action executes
//   FAIL    → sender loses 50% of their total balance → given to target as karma
//
// TEACHES: Item consumption, complex conditional logic, ephemeral reveals,
//          timed bans, dramatic UX with staged message editing
// ============================================================

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getUser, saveUser, removeItem, isBotBanned, COLORS } = require('../../utils/db');
const { errorEmbed, COLORS: C } = require('../../utils/embeds');
const { isRestricted } = require('../../utils/permissions');

const HITMAN_ITEM_ID = 'hitman';
const SUCCESS_CHANCE = 0.5; // 50/50

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hitman')
    .setDescription('Deploy your hitman against another user.')
    .addUserOption((o) =>
      o.setName('target').setDescription('Who to target').setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('What the hitman should do if successful')
        .setRequired(true)
        .addChoices(
          { name: '💰 Rob — steal 50% of their total balance', value: 'rob' },
          { name: '🔇 Silence — lock them out of the bot for 24h', value: 'silence' }
        )
    ),

  async execute(interaction) {
    const senderId = interaction.user.id;

    // ---- RESTRICTED ROLE CHECK ----
    if (isRestricted(interaction.member)) {
      return interaction.reply({
        embeds: [errorEmbed("You don't have permission to use the hitman.")],
        ephemeral: true,
      });
    }

    // ---- BOT-BAN CHECK ----
    if (isBotBanned(senderId)) {
      const user = getUser(senderId);
      const mins = Math.ceil((user.bannedUntil - Date.now()) / 60000);
      return interaction.reply({
        embeds: [errorEmbed(`🔫 You're currently locked out. **${mins}m** remaining.`)],
        ephemeral: true,
      });
    }

    const target   = interaction.options.getUser('target');
    const action   = interaction.options.getString('action');
    const sender   = getUser(senderId);

    // ---- VALIDATION ----
    if (target.id === senderId) {
      return interaction.reply({ embeds: [errorEmbed('You can\'t hitman yourself.')], ephemeral: true });
    }
    if (target.bot) {
      return interaction.reply({ embeds: [errorEmbed('You can\'t hitman a bot.')], ephemeral: true });
    }

    // Check inventory for hitman item
    const inv = sender.inventory || [];
    if (!inv.includes(HITMAN_ITEM_ID)) {
      return interaction.reply({
        embeds: [errorEmbed('You don\'t have a hitman in your inventory!\nBuy one from `/shop browse`.')],
        ephemeral: true,
      });
    }

    // ---- CONFIRMATION BUTTON ----
    // Show a confirmation before consuming the item — big decisions need confirmation
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('hitman_confirm')
        .setLabel('Deploy Hitman')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('hitman_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    const actionLabel = action === 'rob'
      ? `steal **50% of ${target.username}'s total balance**`
      : `silence **${target.username}** for **24 hours**`;

    const confirmMsg = await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('🔫 Deploy Hitman?')
          .setDescription(
            `**Target:** ${target.username}\n` +
            `**Mission:** ${actionLabel}\n\n` +
            `⚠️ 50/50 chance of success.\n` +
            `If it **fails**, you lose **50% of your own total balance** — given to ${target.username} as karma.\n\n` +
            `This will consume 1 hitman from your inventory.`
          ),
      ],
      components: [confirmRow],
      fetchReply: true,
    });

    const collector = confirmMsg.createMessageComponentCollector({
      filter: (i) => i.user.id === senderId,
      max: 1,
      time: 30_000,
    });

    collector.on('collect', async (btn) => {
      await btn.deferUpdate();

      if (btn.customId === 'hitman_cancel') {
        return confirmMsg.edit({
          embeds: [new EmbedBuilder().setColor(C.INFO).setDescription('❌ Hitman deployment cancelled.')],
          components: [],
        });
      }

      // ---- CONSUME THE ITEM ----
      removeItem(senderId, HITMAN_ITEM_ID);

      // ---- DRAMATIC DICE ROLL ----
      await confirmMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('🎲 Rolling the dice...')
            .setDescription('The hitman is on their way...'),
        ],
        components: [],
      });

      // Brief suspense delay
      await new Promise((r) => setTimeout(r, 2500));

      const success = Math.random() < SUCCESS_CHANCE;

      if (success) {
        // ---- SUCCESS ----
        const targetData = getUser(target.id);

        if (action === 'rob') {
          const totalTarget = targetData.wallet + targetData.bank;
          const stolen = Math.floor(totalTarget * 0.5);

          // Take evenly from bank first, then wallet
          let fromBank = Math.min(stolen, targetData.bank);
          let fromWallet = stolen - fromBank;
          targetData.bank   -= fromBank;
          targetData.wallet -= fromWallet;
          targetData.wallet = Math.max(0, targetData.wallet); // floor at 0

          // Refresh sender data (in case something changed)
          const freshSender = getUser(senderId);
          freshSender.wallet += stolen;

          saveUser(target.id, targetData);
          saveUser(senderId, freshSender);

          await confirmMsg.edit({
            embeds: [
              new EmbedBuilder()
                .setColor(C.SUCCESS)
                .setTitle('✅ Mission Success — Rob')
                .setDescription(
                  `🔫 Your hitman delivered.\n\n` +
                  `You stole **$${stolen.toLocaleString()}** from **${target.username}**.\n` +
                  `(50% of their $${totalTarget.toLocaleString()} total)\n\n` +
                  `👜 Your wallet: **$${freshSender.wallet.toLocaleString()}**`
                ),
            ],
          });

          // Notify target via DM
          try {
            await target.send(`🔫 A hitman was deployed against you in **${interaction.guild.name}**.\nThey robbed you for **$${stolen.toLocaleString()}**.`);
          } catch { /* DMs closed */ }

        } else if (action === 'silence') {
          const SILENCE_MS = 24 * 60 * 60 * 1000; // 24 hours
          targetData.bannedUntil = Date.now() + SILENCE_MS;
          saveUser(target.id, targetData);

          await confirmMsg.edit({
            embeds: [
              new EmbedBuilder()
                .setColor(C.SUCCESS)
                .setTitle('✅ Mission Success — Silenced')
                .setDescription(
                  `🔫 Your hitman delivered.\n\n` +
                  `**${target.username}** is locked out of the bot for **24 hours**.\n` +
                  `They cannot use any commands until the silence lifts.`
                ),
            ],
          });

          try {
            await target.send(`🔇 A hitman silenced you in **${interaction.guild.name}**.\nYou cannot use bot commands for the next **24 hours**.`);
          } catch { /* DMs closed */ }
        }

      } else {
        // ---- FAILURE — KARMA ----
        const freshSender = getUser(senderId);
        const senderTotal = freshSender.wallet + freshSender.bank;
        const karmaLoss   = Math.floor(senderTotal * 0.5);

        // Drain from wallet first, then bank
        let fromWallet = Math.min(karmaLoss, freshSender.wallet);
        let fromBank   = karmaLoss - fromWallet;
        freshSender.wallet -= fromWallet;
        freshSender.bank   -= fromBank;
        freshSender.wallet = Math.max(0, freshSender.wallet);
        freshSender.bank   = Math.max(0, freshSender.bank);

        // Give karma money to target
        const targetData = getUser(target.id);
        targetData.wallet += karmaLoss;

        saveUser(senderId, freshSender);
        saveUser(target.id, targetData);

        await confirmMsg.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(C.ERROR)
              .setTitle('❌ Mission Failed — Karma Strikes')
              .setDescription(
                `🎲 The dice didn't go your way.\n\n` +
                `The hitman turned on you.\n` +
                `**$${karmaLoss.toLocaleString()}** (50% of your balance) was seized and given to **${target.username}** as karma.\n\n` +
                `👜 Your remaining wallet: **$${freshSender.wallet.toLocaleString()}**\n` +
                `🏦 Your remaining bank: **$${freshSender.bank.toLocaleString()}**`
              ),
          ],
        });

        try {
          await target.send(`⚖️ Karma paid you in **${interaction.guild.name}**!\nSomeone's hitman backfired — you received **$${karmaLoss.toLocaleString()}**.`);
        } catch { /* DMs closed */ }
      }
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        confirmMsg.edit({ components: [] }).catch(() => {});
      }
    });
  },
};
