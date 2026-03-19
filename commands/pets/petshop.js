const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getPet, savePet, PET_TYPES, calcPetStats } = require('../../utils/petDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const TIER_COLORS = [0x888888,0x2ecc71,0x2ecc71,0x3498db,0x3498db,0x9b59b6,0x9b59b6,0xe67e22,0xe67e22,0xff0000,0xff0000];
const RARITY_COLORS = { Common:'🟢', Uncommon:'🔵', Rare:'🟣', Epic:'🟠', Legendary:'🔴', Mythic:'⭐' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('petshop')
    .setDescription('Browse and buy pets from the pet shop.')
    .addStringOption(o => o.setName('pet').setDescription('Buy a specific pet').setRequired(false)
      .addChoices(...Object.entries(PET_TYPES).map(([id, p]) => ({ name: `${p.emoji} ${p.name} — ${p.rarity} ($${p.cost.toLocaleString()})`, value: id })))
    ),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const petId = interaction.options.getString('pet');

    if (!petId) {
      // Browse all pets — paginated
      const pets  = Object.entries(PET_TYPES);
      let page    = 0;
      const perPage = 3;
      const pages = Math.ceil(pets.length / perPage);

      const buildEmbed = (p) => {
        const slice = pets.slice(p * perPage, (p+1) * perPage);
        const embed = new EmbedBuilder()
          .setColor(0xff6b35)
          .setTitle('🐾 Pet Shop')
          .setDescription('Buy a pet to protect you, earn you money, and grow with you.\nThe more you care for them, the stronger they get.')
          .setFooter({ text: `Page ${p+1}/${pages} · Use /petshop <pet> to buy` });

        for (const [id, pet] of slice) {
          const stats = calcPetStats({ type: id, level: 1, bond: 0 });
          embed.addFields({
            name: `${pet.emoji} **${pet.name}** ${RARITY_COLORS[pet.rarity]} ${pet.rarity}`,
            value: `*${pet.desc}*\n💰 **$${pet.cost.toLocaleString()}** · Tier ${pet.tier}\n⚔️ Pwr: ${stats.power} · 🛡️ Def: ${stats.defense} · ❤️ HP: ${stats.hp}\n➡️ Evolves to: ${pet.evolvesTo ? PET_TYPES[pet.evolvesTo]?.emoji + ' ' + PET_TYPES[pet.evolvesTo]?.name + ` at Lv${pet.evolveLevel}` : 'MAX — cannot evolve further'}`,
            inline: false,
          });
        }
        return embed;
      };

      const buildRow = (p) => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ps_prev_${p}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p===0),
        new ButtonBuilder().setCustomId(`ps_next_${p}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p>=pages-1),
      );

      await interaction.reply({ embeds: [buildEmbed(page)], components: [buildRow(page)] });
      const msg = await interaction.fetchReply();
      const col = msg.createMessageComponentCollector({ time: 120_000 });
      col.on('collect', async btn => {
        if (btn.user.id !== interaction.user.id) return btn.reply({ content:'Not your shop.', ephemeral:true });
        if (btn.customId.startsWith('ps_prev')) page = Math.max(0, page-1);
        if (btn.customId.startsWith('ps_next')) page = Math.min(pages-1, page+1);
        await btn.update({ embeds: [buildEmbed(page)], components: [buildRow(page)] });
      });
      col.on('end', () => interaction.editReply({ components:[] }).catch(()=>{}));
      return;
    }

    // Buy a specific pet
    const existing = getPet(interaction.user.id);
    if (existing) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You already own **${PET_TYPES[existing.type]?.emoji} ${existing.name}**!\nRelease your current pet first with \`/pet release\`.`)], ephemeral: true });

    const petType = PET_TYPES[petId];
    const user    = getOrCreateUser(interaction.user.id);
    if (user.wallet < petType.cost) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You need **$${petType.cost.toLocaleString()}** to buy a ${petType.name}. You have **$${user.wallet.toLocaleString()}**.`)], ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pet_buy_confirm').setLabel(`Buy ${petType.name}`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('pet_buy_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(TIER_COLORS[petType.tier] || 0x5865f2)
      .setTitle(`${petType.emoji} Adopt a ${petType.name}?`)
      .setDescription(`*${petType.desc}*\n\nCost: **$${petType.cost.toLocaleString()}**\n\nYour pet needs food 🍖 and love 💕 to grow. Feed it with \`/pet feed\` and play with it with \`/pet play\`. An unhappy or hungry pet performs worse in battle.`)
    ], components: [row], ephemeral: true });

    const msg = await interaction.fetchReply();
    const col = msg.createMessageComponentCollector({ time: 30_000 });
    col.on('collect', async btn => {
      col.stop();
      if (btn.customId === 'pet_buy_cancel') return btn.update({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription('Purchase cancelled.')], components:[] });

      user.wallet -= petType.cost;
      saveUser(interaction.user.id, user);

      const pet = {
        ownerId:      interaction.user.id,
        type:         petId,
        name:         petType.name,
        emoji:        petType.emoji,
        level:        1,
        xp:           0,
        hunger:       100,
        happiness:    100,
        bond:         0,
        hp:           calcPetStats({ type:petId, level:1, bond:0 }).hp,
        maxHp:        calcPetStats({ type:petId, level:1, bond:0 }).hp,
        wins:         0,
        losses:       0,
        lastFed:      Date.now(),
        lastPlayed:   Date.now(),
        adoptedAt:    Date.now(),
        isProtecting: false,
      };
      savePet(interaction.user.id, pet);

      await btn.update({ embeds: [new EmbedBuilder()
        .setColor(TIER_COLORS[petType.tier] || 0x5865f2)
        .setTitle(`${petType.emoji} Welcome, ${petType.name}!`)
        .setDescription(`You adopted a **${petType.name}**!\n\n*${petType.desc}*\n\nUse \`/pet feed\` to keep it fed.\nUse \`/pet play\` to build happiness and bond.\nUse \`/pet attack @user\` to defend yourself.`)
        .addFields({ name:'💵 Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true })
      ], components:[] });
    });
  },
};
