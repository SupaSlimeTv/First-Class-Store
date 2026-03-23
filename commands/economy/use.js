// ============================================================
// commands/economy/use.js
// Uses autocomplete to show the user's actual inventory items
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getOrCreateUser, removeItem, getStore, isBotBanned, saveUser } = require('../../utils/db');
const { executeEffect } = require('../../utils/effects');
const { errorEmbed, COLORS } = require('../../utils/embeds');
const { isRestricted } = require('../../utils/permissions');
const { generateChallenge } = require('../../utils/minigames');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use an item from your inventory.')
    .addStringOption((o) =>
      o.setName('item').setDescription('Choose an item from your inventory').setRequired(true).setAutocomplete(true)
    )
    .addUserOption((o) =>
      o.setName('target').setDescription('Target user (required for attack items)').setRequired(false)
    ),

  // ---- AUTOCOMPLETE HANDLER ----
  // Fires as the user types — returns their inventory as choices
  async autocomplete(interaction) {
    const user = getUser(interaction.user.id);
    if (!user || !user.inventory?.length) {
      return interaction.respond([{ name: 'Your inventory is empty', value: '__empty__' }]);
    }

    const store  = getStore(interaction.guildId);
    const inv    = user.inventory;
    const typed  = interaction.options.getFocused().toLowerCase();

    // Count duplicates and build unique list
    const counts = inv.reduce((a, id) => { a[id] = (a[id]||0)+1; return a; }, {});

    const choices = Object.entries(counts)
      .map(([id, cnt]) => {
        const item = store.items.find(i => i.id === id);
        const name = item ? `${item.name}${cnt > 1 ? ` ×${cnt}` : ''}` : id;
        return { name, value: id };
      })
      .filter(c => c.name.toLowerCase().includes(typed) || c.value.includes(typed))
      .slice(0, 25); // Discord max

    await interaction.respond(choices.length ? choices : [{ name: 'No matching items', value: '__empty__' }]);
  },

  async execute(interaction) {
    // Bot-ban check
    if (isBotBanned(interaction.user.id)) {
      const u = getOrCreateUser(interaction.user.id);
      const mins = Math.ceil((u.bannedUntil - Date.now()) / 60000);
      return interaction.reply({ embeds: [errorEmbed(`🔇 You're silenced. **${mins}m** remaining.`)], ephemeral: true });
    }

    const itemId     = interaction.options.getString('item').toLowerCase();
    const targetUser = interaction.options.getUser('target');
    const userId     = interaction.user.id;

    if (itemId === '__empty__') {
      return interaction.reply({ embeds: [errorEmbed('Your inventory is empty.')], ephemeral: true });
    }

    const user = getUser(userId);
    if (!user) {
      return interaction.reply({ embeds: [errorEmbed("You don't have an account yet! Type `!open account` to get started.")], ephemeral: true });
    }

    const inv = user.inventory || [];
    if (!inv.includes(itemId)) {
      return interaction.reply({ embeds: [errorEmbed(`You don't have **${itemId}** in your inventory.`)], ephemeral: true });
    }

    const store = getStore(interaction.guildId);
    const item  = store.items.find((i) => i.id === itemId);

    if (!item) return interaction.reply({ embeds: [errorEmbed(`Item \`${itemId}\` no longer exists in the store.`)], ephemeral: true });
    if (item.type !== 'useable') return interaction.reply({ embeds: [errorEmbed(`**${item.name}** is not a useable item.`)], ephemeral: true });

    // Items with trigger:'buy' shouldn't be manually used
    if (item.trigger === 'buy') {
      return interaction.reply({ embeds: [errorEmbed(`**${item.name}** activates automatically on purchase — it can't be used manually.`)], ephemeral: true });
    }

    const targetId = targetUser?.id || null;
    const allAttackTypes = ['drain_wallet', 'drain_all', 'silence', 'hitman', 'minigame_drain'];

    if (targetId && item.effect && allAttackTypes.includes(item.effect.type)) {
      if (isRestricted(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed("You don't have permission to use attack items.")], ephemeral: true });
      }
    }

    if ((item.effect?.type === 'hitman' || item.effect?.type === 'minigame_drain') && !targetId) {
      return interaction.reply({ embeds: [errorEmbed(`This item requires a target.\nUsage: \`/use item:${itemId} target:@user\``)], ephemeral: true });
    }

    const selfBlockTypes = ['drain_wallet', 'drain_all', 'silence', 'minigame_drain'];
    if (targetId === userId && item.effect && selfBlockTypes.includes(item.effect.type)) {
      return interaction.reply({ embeds: [errorEmbed("You can't use this item on yourself.")], ephemeral: true });
    }

    if (targetId && targetUser?.bot) return interaction.reply({ embeds: [errorEmbed("You can't target a bot.")], ephemeral: true });

    await interaction.deferReply();

    if (!item.reusable) removeItem(userId, itemId);

    let targetMember = null;
    if (targetId) targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);

    const result = await executeEffect(item, userId, targetId, targetMember);

    // ---- MINIGAME FLOW ----
    if (result.needsMinigame) {
      const effect    = result.effect;
      const timeLimit = (effect.timeLimitSeconds || 30) * 1000;
      const { word, scrambled } = generateChallenge();

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x00d2ff)
          .setTitle(`💻 ${item.name} — Hack Initiated!`)
          .setDescription(`You've targeted <@${targetId}>.\n\n**Unscramble this word to complete the hack:**\n\n## \`${scrambled}\`\n\nType the correct word within **${effect.timeLimitSeconds || 30} seconds**.\nFail and you'll be fined **${effect.finePercent || 10}%** of your balance.`)
          .setFooter({ text: `${word.length} letters` })
          .setTimestamp()
        ],
      });

      const filter = (m) => m.author.id === userId && m.channelId === interaction.channelId;
      let collected;
      try {
        collected = await interaction.channel.awaitMessages({ filter, max: 1, time: timeLimit, errors: ['time'] });
      } catch {
        const attacker   = getOrCreateUser(userId);
        const fine       = Math.floor((attacker.wallet + attacker.bank) * ((effect.finePercent || 10) / 100));
        const fromWallet = Math.min(fine, attacker.wallet);
        const fromBank   = Math.min(fine - fromWallet, attacker.bank);
        attacker.wallet -= fromWallet;
        attacker.bank    = Math.max(0, attacker.bank - fromBank);
        saveUser(userId, attacker);
        return interaction.followUp({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('⏰ Time\'s Up — Hack Failed!').setDescription(`You ran out of time! The word was **${word}**.\n\nYou were fined **$${fine.toLocaleString()}** for the failed attempt.`).addFields({name:'💵 Wallet',value:`$${attacker.wallet.toLocaleString()}`,inline:true},{name:'🏦 Bank',value:`$${attacker.bank.toLocaleString()}`,inline:true})] });
      }

      const answer = collected.first().content.trim().toLowerCase();
      if (answer === word) {
        const targetData = getOrCreateUser(targetId);
        let stolen = 0;
        if (effect.drainTarget === 'bank' || effect.drainTarget === 'both') {
          const amt = effect.drainType === 'percent' ? Math.floor(targetData.bank*(effect.amount/100)) : Math.min(effect.amount,targetData.bank);
          targetData.bank -= amt; stolen += amt;
        }
        if (effect.drainTarget === 'wallet' || effect.drainTarget === 'both') {
          const amt = effect.drainType === 'percent' ? Math.floor(targetData.wallet*(effect.amount/100)) : Math.min(effect.amount,targetData.wallet);
          targetData.wallet -= amt; stolen += amt;
        }
        const attacker = getOrCreateUser(userId);
        attacker.wallet += stolen;
        saveUser(targetId, targetData); saveUser(userId, attacker);
        collected.first().delete().catch(()=>{});
        await interaction.followUp({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle('✅ Hack Successful!').setDescription(`You unscrambled **${word}** and drained <@${targetId}>!\nYou stole **$${stolen.toLocaleString()}**.`).addFields({name:'💰 Stolen',value:`$${stolen.toLocaleString()}`,inline:true},{name:'💵 Your Wallet',value:`$${attacker.wallet.toLocaleString()}`,inline:true})] });
        try { await targetUser.send(`💻 You were hacked in **${interaction.guild.name}**! **$${stolen.toLocaleString()}** was drained.`); } catch {}
      } else {
        const attacker   = getOrCreateUser(userId);
        const fine       = Math.floor((attacker.wallet + attacker.bank) * ((effect.finePercent || 10) / 100));
        const fromWallet = Math.min(fine, attacker.wallet);
        const fromBank   = Math.min(fine - fromWallet, attacker.bank);
        attacker.wallet -= fromWallet; attacker.bank = Math.max(0, attacker.bank - fromBank);
        saveUser(userId, attacker);
        collected.first().delete().catch(()=>{});
        await interaction.followUp({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ Wrong Answer — Hack Failed!').setDescription(`Incorrect! The word was **${word}**.\n\nYou were fined **$${fine.toLocaleString()}**.`).addFields({name:'💵 Wallet',value:`$${attacker.wallet.toLocaleString()}`,inline:true},{name:'🏦 Bank',value:`$${attacker.bank.toLocaleString()}`,inline:true})] });
      }
      return;
    }

    // ---- ROLE EDIT FLOW ----
    if (result.needsRoleEdit) {
      const memberToEdit = result.target === 'target' ? targetMember : await interaction.guild.members.fetch(userId).catch(() => null);
      if (!memberToEdit) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ Failed').setDescription('Could not find member in server.')] });
      const roleObj  = interaction.guild.roles.cache.get(result.roleId);
      const roleName = roleObj?.name || result.roleId;
      try {
        if (result.action === 'add') await memberToEdit.roles.add(result.roleId);
        else await memberToEdit.roles.remove(result.roleId);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle(`🏅 Role ${result.action === 'add' ? 'Added' : 'Removed'}`).setDescription(`**${roleName}** was ${result.action === 'add' ? 'given to' : 'removed from'} ${result.target === 'target' ? `<@${result.targetId}>` : 'you'}.`).setFooter({ text: `${item.name} — ${item.reusable ? '♻️ Reusable' : '🗑️ Single-use'}` })] });
      } catch { return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ Role Error').setDescription('Could not modify role. Make sure the bot has permission.')] }); }
    }

    // ---- NORMAL FLOW ----
    const embed = new EmbedBuilder()
      .setColor(result.success ? COLORS.SUCCESS : COLORS.ERROR)
      .setTitle(result.title)
      .setDescription(result.description)
      .setTimestamp();
    if (result.fields) embed.addFields(result.fields);
    embed.setFooter({ text: `${item.name} — ${item.reusable ? '♻️ Reusable' : '🗑️ Single-use'}` });
    await interaction.editReply({ embeds: [embed] });

    const attackTypes = ['drain_wallet', 'drain_all', 'silence', 'hitman'];
    if (targetId && result.success && item.effect && attackTypes.includes(item.effect.type)) {
      try { await targetUser.send(`⚠️ You were hit by **${item.name}** in **${interaction.guild.name}**!\n${result.description}`); } catch {}
    }
  },
};
