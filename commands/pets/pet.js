const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getPet, savePet, deletePet, PET_TYPES, calcPetStats, xpForLevel } = require('../../utils/petDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const FEED_COOLDOWN  = 30 * 60 * 1000; // 30 min
const PLAY_COOLDOWN  = 60 * 60 * 1000; // 1 hour

function hungerBar(val) { const f = Math.round(val/10); return '🟩'.repeat(f) + '⬛'.repeat(10-f); }
function happyBar(val)  { const f = Math.round(val/10); return '💜'.repeat(f) + '🖤'.repeat(10-f); }
function bondBar(val)   { const f = Math.round(val/10); return '❤️'.repeat(f) + '🤍'.repeat(10-f); }
function hpBar(hp, max) { const f = Math.round((hp/max)*10); return '❤️'.repeat(f) + '🖤'.repeat(10-f); }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pet')
    .setDescription('Manage your pet.')
    .addSubcommand(s => s.setName('status').setDescription('View your pet\'s stats'))
    .addSubcommand(s => s.setName('feed').setDescription('Feed your pet 🍖'))
    .addSubcommand(s => s.setName('play').setDescription('Play with your pet 🎾'))
    .addSubcommand(s => s.setName('heal').setDescription('Heal your pet\'s HP').addIntegerOption(o => o.setName('amount').setDescription('$ to spend on healing').setRequired(true).setMinValue(10)))
    .addSubcommand(s => s.setName('rename').setDescription('Rename your pet').addStringOption(o => o.setName('name').setDescription('New name').setRequired(true)))
    .addSubcommand(s => s.setName('evolve').setDescription('Evolve your pet if requirements are met'))
    .addSubcommand(s => s.setName('release').setDescription('Release your pet back into the wild')),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const pet    = getPet(userId);

    if (!pet && sub !== 'status') return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have a pet! Visit the `/petshop` to adopt one.")], ephemeral: true });

    if (sub === 'status') {
      if (!pet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('🐾 No Pet').setDescription("You don't have a pet yet.\nVisit `/petshop` to browse and adopt one!")], ephemeral: true });
      const pType  = PET_TYPES[pet.type];
      const stats  = calcPetStats(pet);
      const xpNext = xpForLevel(pet.level);
      const xpPct  = Math.round((pet.xp / xpNext) * 100);
      const xpBar  = '█'.repeat(Math.floor(xpPct/10)) + '░'.repeat(10-Math.floor(xpPct/10));
      const evolveLine = pType.evolvesTo
        ? `Evolves to ${PET_TYPES[pType.evolvesTo]?.emoji} **${PET_TYPES[pType.evolvesTo]?.name}** at Lv${pType.evolveLevel}`
        : '**MAX EVOLUTION** — Final form.';
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xff6b35)
        .setTitle(`${pet.emoji} ${pet.name}`)
        .setDescription(`*${pType.desc}*`)
        .addFields(
          { name:'❤️ HP',        value:`${pet.hp}/${stats.hp}\n${hpBar(pet.hp, stats.hp)}`,  inline:true },
          { name:'🍖 Hunger',    value:`${pet.hunger}/100\n${hungerBar(pet.hunger)}`,         inline:true },
          { name:'💕 Happiness', value:`${pet.happiness}/100\n${happyBar(pet.happiness)}`,    inline:true },
          { name:'🔗 Bond',      value:`${pet.bond}/100\n${bondBar(pet.bond)}`,               inline:true },
          { name:'⭐ Level',     value:`${pet.level} · XP: ${pet.xp}/${xpNext}\n\`[${xpBar}] ${xpPct}%\``, inline:true },
          { name:'⚔️ Power',    value:stats.power.toString(),  inline:true },
          { name:'🛡️ Defense',  value:stats.defense.toString(), inline:true },
          { name:'🏆 Record',   value:`${pet.wins}W / ${pet.losses}L`, inline:true },
          { name:'🔮 Evolution', value:evolveLine,              inline:false },
        )
        .setFooter({ text:`${pType.rarity} · Tier ${pType.tier} · Adopted ${new Date(pet.adoptedAt).toLocaleDateString()}` })
      ]});
    }

    if (sub === 'feed') {
      const now = Date.now();
      const lastFed = pet.lastFed || 0;
      if (now - lastFed < FEED_COOLDOWN) {
        const left = Math.ceil((FEED_COOLDOWN - (now - lastFed)) / 60000);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${pet.emoji} **${pet.name}** is still full! Feed again in **${left} minutes**.`)], ephemeral: true });
      }
      pet.hunger    = Math.min(100, pet.hunger + 30);
      pet.happiness = Math.min(100, pet.happiness + 5);
      pet.lastFed   = now;
      pet.xp        = (pet.xp || 0) + 10;
      const stats   = calcPetStats(pet);
      pet.maxHp     = stats.hp;
      savePet(userId, pet);
      const msgs = [`${pet.emoji} **${pet.name}** devoured the food enthusiastically!`, `${pet.emoji} **${pet.name}** ate happily. Those eyes say *more please*.`, `${pet.emoji} **${pet.name}** finished every last bite and looked up for seconds.`];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('🍖 Fed!').setDescription(msgs[Math.floor(Math.random()*msgs.length)]).addFields({ name:'🍖 Hunger', value:`${pet.hunger}/100`, inline:true },{ name:'💕 Happiness', value:`${pet.happiness}/100`, inline:true },{ name:'⭐ XP', value:`+10 (${pet.xp}/${xpForLevel(pet.level)})`, inline:true })] });
    }

    if (sub === 'play') {
      const now = Date.now();
      if (now - (pet.lastPlayed||0) < PLAY_COOLDOWN) {
        const left = Math.ceil((PLAY_COOLDOWN - (now - (pet.lastPlayed||0))) / 60000);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${pet.emoji} **${pet.name}** is tired! Play again in **${left} minutes**.`)], ephemeral: true });
      }
      const bondGain = 2 + Math.floor(Math.random() * 4);
      pet.happiness  = Math.min(100, pet.happiness + 20);
      pet.bond       = Math.min(100, (pet.bond||0) + bondGain);
      pet.lastPlayed = now;
      pet.xp         = (pet.xp||0) + 15;
      savePet(userId, pet);
      const msgs = [`${pet.emoji} **${pet.name}** had a blast! Bond increased! 🎾`, `${pet.emoji} **${pet.name}** absolutely loved it. This is the best day of its life.`, `${pet.emoji} **${pet.name}** played until it was exhausted. Worth it.`];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle('🎾 Playtime!').setDescription(msgs[Math.floor(Math.random()*msgs.length)]).addFields({ name:'💕 Happiness', value:`${pet.happiness}/100`, inline:true },{ name:'🔗 Bond', value:`+${bondGain} → ${pet.bond}/100`, inline:true },{ name:'⭐ XP', value:`+15 (${pet.xp}/${xpForLevel(pet.level)})`, inline:true })] });
    }

    if (sub === 'heal') {
      const amount = interaction.options.getInteger('amount');
      const stats  = calcPetStats(pet);
      if (pet.hp >= stats.hp) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription(`${pet.emoji} **${pet.name}** is already at full HP!`)], ephemeral: true });
      const user = getOrCreateUser(userId);
      if (user.wallet < amount) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You only have **$${user.wallet.toLocaleString()}**.`)], ephemeral: true });
      const healAmt = Math.floor(amount / 10); // $1 = 0.1 HP
      user.wallet  -= amount;
      pet.hp        = Math.min(stats.hp, (pet.hp||0) + healAmt);
      saveUser(userId, user);
      savePet(userId, pet);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('💊 Healed!').setDescription(`Spent **$${amount.toLocaleString()}** healing ${pet.emoji} **${pet.name}**!`).addFields({ name:'❤️ HP', value:`${pet.hp}/${stats.hp}`, inline:true },{ name:'💵 Wallet', value:`$${user.wallet.toLocaleString()}`, inline:true })] });
    }

    if (sub === 'rename') {
      const newName   = interaction.options.getString('name').slice(0, 30);
      const oldName   = pet.name;
      pet.name        = newName;
      savePet(userId, pet);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(`${pet.emoji} **${oldName}** has been renamed to **${newName}**!`)] });
    }

    if (sub === 'evolve') {
      const pType = PET_TYPES[pet.type];
      if (!pType.evolvesTo) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription(`${pet.emoji} **${pet.name}** is already at its **final form**. No further evolution possible.`)], ephemeral: true });
      if (pet.level < pType.evolveLevel) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${pet.emoji} **${pet.name}** needs to be **Level ${pType.evolveLevel}** to evolve. Currently **Level ${pet.level}**.`)], ephemeral: true });

      const nextType  = PET_TYPES[pType.evolvesTo];
      const oldName   = pet.name;
      const oldEmoji  = pet.emoji;
      pet.type        = pType.evolvesTo;
      pet.emoji       = nextType.emoji;
      pet.name        = nextType.name;
      pet.hp          = calcPetStats(pet).hp;
      pet.xp          = 0;
      savePet(userId, pet);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('✨ EVOLVED!')
        .setDescription(`${oldEmoji} **${oldName}** evolved into ${nextType.emoji} **${nextType.name}**!\n\n*${nextType.desc}*`)
        .addFields(
          { name:'⚔️ New Power',   value:calcPetStats(pet).power.toString(),   inline:true },
          { name:'🛡️ New Defense', value:calcPetStats(pet).defense.toString(), inline:true },
          { name:'❤️ New HP',     value:calcPetStats(pet).hp.toString(),       inline:true },
        )
      ]});
    }

    if (sub === 'release') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pet_release_yes').setLabel('Release').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('pet_release_no').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('⚠️ Release Pet?').setDescription(`Are you sure you want to release **${pet.emoji} ${pet.name}**?\n\nThis is permanent. You will receive no refund.`)], components: [row], ephemeral: true });
      const msg = await interaction.fetchReply();
      const col = msg.createMessageComponentCollector({ time: 30_000 });
      col.on('collect', async btn => {
        col.stop();
        if (btn.customId === 'pet_release_no') return btn.update({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('Release cancelled.')], components:[] });
        deletePet(userId);
        await btn.update({ embeds:[new EmbedBuilder().setColor(0x888888).setTitle('🌿 Released').setDescription(`**${pet.emoji} ${pet.name}** was released into the wild.\n\nThey looked back once, then disappeared.`)], components:[] });
      });
    }
  },
};
