const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser, getAllUsers, isPurgeActive } = require('../../utils/db');
const { getGangByMember, getAllGangs, saveGang, getWar, saveWar, deleteWar, getMemberRank } = require('../../utils/gangDb');
const { addHeat, checkPoliceRaid, isJailed, getJailTimeLeft } = require('../../utils/gangDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');
const { gangAutocomplete } = require('../../utils/autocomplete');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gangwar')
    .setDescription('Manage gang wars.')
    .addSubcommand(s => s.setName('challenge').setDescription('Challenge another gang to war')
      .addStringOption(o => o.setName('gang').setAutocomplete(true).setDescription('Gang name to challenge').setRequired(true))
      .addIntegerOption(o => o.setName('bet').setDescription('Gang bank bet amount').setRequired(false).setMinValue(0))
    )
    .addSubcommand(s => s.setName('attack').setDescription('Attack during an active war (adds heat)'))
    .addSubcommand(s => s.setName('status').setDescription('Check active war status'))
    .addSubcommand(s => s.setName('surrender').setDescription('Surrender the current war (leader only)')),


  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'gang') return gangAutocomplete(interaction);
  },
  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // Jail check
    if (isJailed(userId)) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x003580).setTitle('🚔 You\'re in Jail').setDescription(`You can't do that while locked up.\nRelease in **${getJailTimeLeft(userId)} minutes**.`)], ephemeral: true });
    }

    const myGang = getGangByMember(userId);
    if (!myGang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You're not in a gang.")], ephemeral: true });

    if (sub === 'challenge') {
      if (myGang.members.length < 3) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ Not Enough Members').setDescription(`You need at least **3 members** to declare war.\n\nYour gang has **${myGang.members.length}** member(s). Recruit more with \`/ganginvite @user\`.`)], ephemeral: true });
      const targetName = interaction.options.getString('gang');
      const bet        = interaction.options.getInteger('bet') || 0;

      const allGangs   = getAllGangs();
      const targetGang = Object.values(allGangs).find(g => g.name.toLowerCase().includes(targetName.toLowerCase()));
      if (!targetGang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`No gang found named **${targetName}**.`)], ephemeral: true });
      if (targetGang.id === myGang.id) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't war your own gang.")], ephemeral: true });

      if (bet > 0 && myGang.bank < bet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Your gang bank only has **$${myGang.bank.toLocaleString()}**.`)], ephemeral: true });

      const warId = `${myGang.id}_vs_${targetGang.id}_${Date.now()}`;
      const row   = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`war_accept_${warId}`).setLabel('⚔️ Accept War').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('war_decline').setLabel('🏳️ Decline').setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xff3b3b)
          .setTitle(`⚔️ War Declaration — ${myGang.name} vs ${targetGang.name}`)
          .setDescription(`**${myGang.name}** is declaring war on **${targetGang.name}**!\n\n${bet > 0 ? `💰 Stakes: **$${bet.toLocaleString()}** from each gang bank\n\n` : ''}A leader or officer of **${targetGang.name}** must accept.`)
          .addFields(
            { name: `${myGang.color} ${myGang.name}`, value: `${myGang.members.length} members · ${myGang.wins}W/${myGang.losses}L`, inline: true },
            { name: `${targetGang.color} ${targetGang.name}`, value: `${targetGang.members.length} members · ${targetGang.wins}W/${targetGang.losses}L`, inline: true },
          )
        ],
        components: [row],
      });

      const msg       = await interaction.fetchReply();
      const collector = msg.createMessageComponentCollector({ time: 120_000 });

      collector.on('collect', async btn => {
        const btnUser     = btn.user.id;
        const btnUserGang = getGangByMember(btnUser);
        if (!btnUserGang || btnUserGang.id !== targetGang.id) return btn.reply({ content: "Only members of the challenged gang can respond.", ephemeral: true });
        if (btnUserGang.leaderId !== btnUser && !btnUserGang.members.find(m => m.userId === btnUser && m.role === 'Officer')) return btn.reply({ content: "Only the leader or officers can accept wars.", ephemeral: true });
        if (btnUserGang.members.length < 3) return btn.reply({ content: `❌ Your gang needs at least **3 members** to go to war. You have **${btnUserGang.members.length}**.`, ephemeral: true });

        collector.stop();

        if (btn.customId === 'war_decline') {
          return btn.update({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription(`**${targetGang.name}** declined the war. Smart move.`)], components: [] });
        }

        // Start the war
        const war = {
          id:          warId,
          gang1Id:     myGang.id,
          gang2Id:     targetGang.id,
          gang1Name:   myGang.name,
          gang2Name:   targetGang.name,
          gang1Score:  0,
          gang2Score:  0,
          bet,
          startedAt:   Date.now(),
          endsAt:      Date.now() + 30 * 60 * 1000,
          attacks:     [],
        };
        await saveWar(warId, war);

        // War GIFs — roleplay
        const WAR_GIFS = [
          'https://media.giphy.com/media/l0HlKrB02QY0f1mbm/giphy.gif',
          'https://media.giphy.com/media/3ohzdYJK1wAdPWVk88/giphy.gif',
          'https://media.giphy.com/media/26BRrSvJAFWCsyBwc/giphy.gif',
          'https://media.giphy.com/media/l2JdZkQvMlHzLOuYg/giphy.gif',
          'https://media.giphy.com/media/26n6WywJyh39n1pBu/giphy.gif',
        ];
        const gif = WAR_GIFS[Math.floor(Math.random() * WAR_GIFS.length)];

        await btn.update({ embeds: [new EmbedBuilder()
          .setColor(0xff3b3b)
          .setTitle(`⚔️ WAR STARTED — ${myGang.name} vs ${targetGang.name}`)
          .setDescription(`The war has begun! Members from both gangs can use \`/gangwar attack\` to score points.\n\nEquip a gun from \`/gunshop\` for bonus attack points!\n\nWar ends in **30 minutes**. Highest score wins.${bet > 0 ? `\n\n💰 Winner takes **$${(bet*2).toLocaleString()}**!` : ''}`)
          .setImage(gif)
        ], components: [] });
      });
    }

    if (sub === 'attack') {
      const wars   = require('../../utils/gangDb').getAllWars();
      const myWar  = Object.values(wars).find(w =>
        (w.gang1Id === myGang.id || w.gang2Id === myGang.id) && w.endsAt > Date.now()
      );
      if (!myWar) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Your gang isn't in an active war.")], ephemeral: true });

      // Check attack cooldown per user (30 sec)
      const lastAttack = (myWar.attacks || []).filter(a => a.userId === userId).sort((a,b) => b.time - a.time)[0];
      if (lastAttack && Date.now() - lastAttack.time < 30_000) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You attacked recently. Wait **${Math.ceil((30000-(Date.now()-lastAttack.time))/1000)}s**.`)], ephemeral: true });
      }

      const isGang1 = myWar.gang1Id === myGang.id;

      // Gun bonus
      const { getGunInventory, getGunById } = require('../../utils/gunDb');
      const inv      = getGunInventory(userId);
      const bestGun  = inv.length ? inv.reduce((best, i) => {
        const g = getGunById(i.gunId);
        if (!g) return best;
        const avgDmg = (g.damage[0]+g.damage[1])/2;
        if (!best || avgDmg > best.avgDmg) return { ...i, avgDmg, gun: g };
        return best;
      }, null) : null;

      const gunBonus   = bestGun ? Math.floor((bestGun.gun.damage[0]+bestGun.gun.damage[1])/10) : 0;
      const roll        = Math.random();
      const accuracy    = bestGun ? bestGun.gun.accuracy : 0.5;
      const success     = roll < (0.35 + accuracy * 0.3);
      const basePoints  = success ? Math.floor(5 + Math.random() * 15) : 0;
      const points      = basePoints + gunBonus;
      const heatAdded   = isPurgeActive(interaction.guildId) ? 0 : (success ? 8 : 3);

      // Use ammo
      if (bestGun && inv.length) {
        const entry = inv.find(i => i.gunId === bestGun.gunId);
        if (entry && entry.ammo > 0) { entry.ammo--; require('../../utils/gunDb').saveGunInventory(userId, inv); }
      }

      if (isGang1) myWar.gang1Score += points;
      else         myWar.gang2Score += points;

      myWar.attacks = myWar.attacks || [];
      myWar.attacks.push({ userId, gangId: myGang.id, points, time: Date.now() });
      await saveWar(myWar.id, myWar);

      if (heatAdded > 0) await addHeat(userId, heatAdded, 'gang_attack');

      const config  = require('../../utils/db').getConfig(interaction.guildId);
      const raid    = isPurgeActive(interaction.guildId) ? null : await checkPoliceRaid(userId, interaction.client, config.purgeChannelId);

      const gunLine = bestGun ? `\n${bestGun.gun.emoji} Used **${bestGun.gun.name}** (+${gunBonus} bonus pts)` : '\n*(No weapon equipped — visit /gunshop)*';

      const embed = new EmbedBuilder()
        .setColor(success ? 0xff3b3b : 0x888888)
        .setTitle(success ? '⚔️ Attack Successful!' : '⚔️ Attack Failed!')
        .setDescription(success
          ? `You scored **${points} points** for **${myGang.name}**!${gunLine}`
          : `Your attack missed. No points scored.${gunLine}`)
        .addFields(
          { name: `${myWar.gang1Name}`, value: `${myWar.gang1Score} pts`, inline: true },
          { name: `${myWar.gang2Name}`, value: `${myWar.gang2Score} pts`, inline: true },
        );

      if (raid) embed.addFields({ name: '🚔 POLICE RAID!', value: `You got raided! Lost $${raid.stolen.toLocaleString()} and jailed for ${raid.jailTime} mins!` });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'status') {
      const wars  = require('../../utils/gangDb').getAllWars();
      const myWar = Object.values(wars).find(w =>
        (w.gang1Id === myGang.id || w.gang2Id === myGang.id) && w.endsAt > Date.now()
      );
      if (!myWar) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription("Your gang isn't in an active war.")], ephemeral: true });

      const timeLeft = Math.ceil((myWar.endsAt - Date.now()) / 60000);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle(`⚔️ Active War — ${myWar.gang1Name} vs ${myWar.gang2Name}`)
        .addFields(
          { name: myWar.gang1Name, value: `${myWar.gang1Score} pts`, inline: true },
          { name: myWar.gang2Name, value: `${myWar.gang2Score} pts`, inline: true },
          { name: '⏰ Time Left',  value: `${timeLeft} minutes`,      inline: true },
        )
        .setFooter({ text: myWar.bet > 0 ? `Stakes: $${myWar.bet.toLocaleString()} each` : 'No stakes' })
      ]});
    }

    if (sub === 'surrender') {
      if (myGang.leaderId !== userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Only the leader can surrender.")], ephemeral: true });
      const wars  = require('../../utils/gangDb').getAllWars();
      const myWar = Object.values(wars).find(w => (w.gang1Id === myGang.id || w.gang2Id === myGang.id) && w.endsAt > Date.now());
      if (!myWar) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription("No active war to surrender.")], ephemeral: true });

      // Force a loss
      const enemyGangId   = myWar.gang1Id === myGang.id ? myWar.gang2Id : myWar.gang1Id;
      const enemyGang     = require('../../utils/gangDb').getGang(enemyGangId);
      myGang.losses       = (myGang.losses || 0) + 1;
      if (enemyGang) { enemyGang.wins = (enemyGang.wins || 0) + 1; await saveGang(enemyGangId, enemyGang); }
      if (myWar.bet > 0 && myGang.bank >= myWar.bet) {
        myGang.bank -= myWar.bet;
        if (enemyGang) { enemyGang.bank = (enemyGang.bank || 0) + myWar.bet; await saveGang(enemyGangId, enemyGang); }
      }
      await saveGang(myGang.id, myGang);
      await deleteWar(myWar.id);

      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('🏳️ Surrendered').setDescription(`**${myGang.name}** has surrendered to **${myWar.gang1Id === myGang.id ? myWar.gang2Name : myWar.gang1Name}**.`)] });
    }
  },
};
