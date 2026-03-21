const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getPet, savePet, deletePet, PET_TYPES, calcPetStats, xpForLevel } = require('../../utils/petDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const FEED_COOLDOWN    = 30 * 60 * 1000;
const MISSION_COOLDOWN = 2  * 60 * 60 * 1000; // 2 hours

const MISSIONS = [
  { id:'patrol',      name:'Patrol the Streets',  emoji:'🚶', xp:30,  tokens:2, minLevel:1,  desc:'Your pet scouts the area and returns safely.' },
  { id:'hunt',        name:'Hunt for Resources',  emoji:'🏹', xp:55,  tokens:4, minLevel:3,  desc:'Your pet tracks down valuable items in the wild.' },
  { id:'raid',        name:'Raid Enemy Territory',emoji:'⚔️', xp:90,  tokens:7, minLevel:7,  desc:'Your pet infiltrates hostile ground. High risk, high reward.' },
  { id:'assassination',name:'Silent Elimination', emoji:'🗡️', xp:140, tokens:12,minLevel:15, desc:'A precise and dangerous solo mission. Not for the faint of heart.' },
  { id:'war',         name:'All-Out War',         emoji:'💀', xp:220, tokens:20,minLevel:25, desc:'Total warfare. Your pet fights on the frontlines.' },
];

const UPGRADES = {
  health:      { name:'Health',      emoji:'❤️',  costs:[100,250,500,1000,2000], maxLevel:5, desc:'Increases max HP' },
  defense:     { name:'Defense',     emoji:'🛡️',  costs:[100,250,500,1000,2000], maxLevel:5, desc:'Reduces damage taken in pet battles' },
  intelligence:{ name:'Intelligence',emoji:'🧠',  costs:[150,300,600,1200,2500], maxLevel:5, desc:'Increases token gain from missions' },
  attack:      { name:'Attack',      emoji:'⚔️',  costs:[100,250,500,1000,2000], maxLevel:5, desc:'Increases damage dealt in pet attacks' },
};

function hpBar(hp, max) { const f=Math.round((hp/max)*10); return '❤️'.repeat(f)+'🖤'.repeat(10-f); }
function hungerBar(v)   { const f=Math.round(v/10); return '🟩'.repeat(f)+'⬛'.repeat(10-f); }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pet')
    .setDescription('Manage your pet.')
    .addSubcommand(s => s.setName('status').setDescription('View your pet stats'))
    .addSubcommand(s => s.setName('feed').setDescription('Feed your pet (requires pet food from shop)'))
    .addSubcommand(s => s.setName('mission').setDescription('Send your pet on a mission to earn XP and tokens')
      .addStringOption(o => o.setName('type').setDescription('Mission type').setRequired(true)
        .addChoices(...MISSIONS.map(m => ({ name:`${m.emoji} ${m.name} (Lv${m.minLevel}+, +${m.tokens} tokens)`, value:m.id })))
      )
    )
    .addSubcommand(s => s.setName('upgrade').setDescription('Upgrade your pet using pet tokens')
      .addStringOption(o => o.setName('stat').setDescription('What to upgrade').setRequired(true)
        .addChoices(
          { name:'❤️ Health — increases max HP', value:'health' },
          { name:'🛡️ Defense — reduces damage taken', value:'defense' },
          { name:'🧠 Intelligence — more tokens per mission', value:'intelligence' },
          { name:'⚔️ Attack — increases damage dealt', value:'attack' },
        )
      )
    )
    .addSubcommand(s => s.setName('guard').setDescription('Toggle guard mode — pet defends you when attacked'))
    .addSubcommand(s => s.setName('heal').setDescription('Heal your pet').addIntegerOption(o => o.setName('amount').setDescription('$ to spend').setRequired(true).setMinValue(10)))
    .addSubcommand(s => s.setName('rename').setDescription('Rename your pet').addStringOption(o => o.setName('name').setDescription('New name').setRequired(true)))
    .addSubcommand(s => s.setName('evolve').setDescription('Evolve your pet'))
    .addSubcommand(s => s.setName('release').setDescription('Release your pet')),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const pet    = getPet(userId);

    if (!pet && sub !== 'status') return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have a pet! Visit `/petshop` to adopt one.")], ephemeral:true });

    // ── STATUS ──
    if (sub === 'status') {
      if (!pet) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.INFO).setTitle('🐾 No Pet').setDescription("You don't have a pet yet.\nVisit `/petshop` to browse and adopt one!")], ephemeral:true });
      const pType  = PET_TYPES[pet.type];
      const stats  = calcPetStats(pet);
      const xpNext = xpForLevel(pet.level);
      const xpPct  = Math.round((pet.xp/xpNext)*100);
      const xpBar  = '█'.repeat(Math.floor(xpPct/10))+'░'.repeat(10-Math.floor(xpPct/10));
      const upgrades = pet.upgrades || {};
      const tokens   = pet.tokens || 0;

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xff6b35)
        .setTitle(`${pet.emoji} ${pet.name}`)
        .setDescription(`*${pType.desc}*\n\n${pet.isGuarding ? '🛡️ **GUARD MODE ON** — defending you from attacks' : '😴 Guard mode off'}`)
        .addFields(
          { name:'❤️ HP',         value:`${pet.hp||stats.hp}/${stats.hp}\n${hpBar(pet.hp||stats.hp,stats.hp)}`, inline:true },
          { name:'🍖 Hunger',     value:`${pet.hunger||100}/100\n${hungerBar(pet.hunger||100)}`,                  inline:true },
          { name:'🪙 Tokens',     value:`${tokens} pet tokens`,                                                    inline:true },
          { name:'⭐ Level',      value:`${pet.level} · ${pet.xp}/${xpNext}\n\`[${xpBar}] ${xpPct}%\``,          inline:true },
          { name:'⚔️ Power',     value:`${stats.power} (+${(upgrades.attack||0)*10})`,                             inline:true },
          { name:'🛡️ Defense',   value:`${stats.defense} (+${(upgrades.defense||0)*15})`,                          inline:true },
          { name:'🧠 Intelligence',value:`Lv${upgrades.intelligence||0}/5`,                                        inline:true },
          { name:'❤️ Health Upgr',value:`Lv${upgrades.health||0}/5`,                                              inline:true },
          { name:'🏆 Record',    value:`${pet.wins||0}W/${pet.losses||0}L`,                                       inline:true },
          { name:'📍 Upgrades',  value:Object.entries(UPGRADES).map(([k,u])=>`${u.emoji}${u.name}: Lv${upgrades[k]||0}/${u.maxLevel}`).join(' · '), inline:false },
        )
        .setFooter({ text:`${pType.rarity} · Tier ${pType.tier} · Use /pet mission to earn tokens` })
      ]});
    }

    // ── FEED ──
    if (sub === 'feed') {
      const user = getOrCreateUser(userId);
      // Check for pet food in inventory
      const hasPetFood = (user.inventory||[]).some(id => id.startsWith('pet_food') || id === 'pet_food' || id.includes('petfood') || id.includes('pet-food'));
      if (!hasPetFood) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setTitle('🍖 No Pet Food')
          .setDescription('Your pet is hungry but you have no pet food!\n\nBuy **Pet Food** from the `/shop` to feed your pet.')
        ], ephemeral:true });
      }
      const now = Date.now();
      if (now - (pet.lastFed||0) < FEED_COOLDOWN) {
        const left = Math.ceil((FEED_COOLDOWN-(now-(pet.lastFed||0)))/60000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${pet.emoji} **${pet.name}** is still full! Feed again in **${left} minutes**.`)], ephemeral:true });
      }
      // Remove one pet food
      const inv = user.inventory || [];
      const idx = inv.findIndex(id => id.startsWith('pet_food') || id === 'pet_food' || id.includes('petfood') || id.includes('pet-food'));
      inv.splice(idx, 1);
      user.inventory = inv;
      saveUser(userId, user);

      pet.hunger    = Math.min(100, (pet.hunger||100) + 40);
      pet.xp        = (pet.xp||0) + 10;
      pet.lastFed   = now;
      await savePet(userId, pet);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('🍖 Fed!').setDescription(`${pet.emoji} **${pet.name}** devoured the food! 🍖 Hunger: ${pet.hunger}/100 · +10 XP`)] });
    }

    // ── MISSION ──
    if (sub === 'mission') {
      const missionId = interaction.options.getString('type');
      const mission   = MISSIONS.find(m => m.id === missionId);
      if (!mission) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Unknown mission.')], ephemeral:true });

      if (pet.level < mission.minLevel) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${pet.emoji} **${pet.name}** needs to be **Level ${mission.minLevel}** for this mission. Currently Level ${pet.level}.`)], ephemeral:true });
      }

      if ((pet.hunger||100) < 20) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${pet.emoji} **${pet.name}** is too hungry to go on a mission! Feed it first with \`/pet feed\`.`)], ephemeral:true });
      }

      const now = Date.now();
      if (now - (pet.lastMission||0) < MISSION_COOLDOWN) {
        const left = Math.ceil((MISSION_COOLDOWN-(now-(pet.lastMission||0)))/60000);
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${pet.emoji} **${pet.name}** needs to rest for **${left} more minutes** before the next mission.`)], ephemeral:true });
      }

      // Intelligence bonus on tokens
      const upgrades = pet.upgrades || {};
      const intBonus = (upgrades.intelligence || 0) * 0.2; // 20% per level
      const tokensEarned = Math.floor(mission.tokens * (1 + intBonus));
      const xpEarned     = mission.xp;

      // Small chance of failure on high-level missions
      const failChance = mission.id === 'war' ? 0.20 : mission.id === 'assassination' ? 0.15 : mission.id === 'raid' ? 0.10 : 0.05;
      const failed     = Math.random() < failChance;

      pet.lastMission = now;
      pet.hunger      = Math.max(0, (pet.hunger||100) - 20);

      if (failed) {
        // Pet takes some damage on failure
        const stats  = calcPetStats(pet);
        const dmg    = Math.floor(stats.hp * 0.15);
        pet.hp       = Math.max(1, (pet.hp||stats.hp) - dmg);
        await savePet(userId, pet);
        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(0xff8800)
          .setTitle(`${mission.emoji} Mission Failed!`)
          .setDescription(`*${mission.desc}*\n\n${pet.emoji} **${pet.name}** ran into trouble and had to retreat!\nLost **${dmg} HP**. No tokens earned.`)
          .addFields({ name:'❤️ HP', value:`${pet.hp}/${calcPetStats(pet).hp}`, inline:true })
        ]});
      }

      pet.xp     = (pet.xp||0) + xpEarned;
      pet.tokens = (pet.tokens||0) + tokensEarned;
      pet.wins   = (pet.wins||0) + 1;

      // Level up check
      let leveled = false;
      while (pet.xp >= xpForLevel(pet.level)) {
        pet.xp -= xpForLevel(pet.level);
        pet.level++;
        leveled = true;
      }
      await savePet(userId, pet);

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`${mission.emoji} Mission Complete!`)
        .setDescription(`*${mission.desc}*\n\n${pet.emoji} **${pet.name}** completed the mission!`)
        .addFields(
          { name:'⭐ XP Gained',    value:`+${xpEarned} (${pet.xp}/${xpForLevel(pet.level)})`, inline:true },
          { name:'🪙 Tokens Earned', value:`+${tokensEarned} (${pet.tokens} total)`,             inline:true },
          { name:'🍖 Hunger',       value:`${pet.hunger}/100`,                                    inline:true },
        );
      if (leveled) embed.addFields({ name:'🎉 LEVEL UP!', value:`${pet.emoji} **${pet.name}** is now **Level ${pet.level}**!`, inline:false });
      return interaction.reply({ embeds:[embed] });
    }

    // ── UPGRADE ──
    if (sub === 'upgrade') {
      const stat    = interaction.options.getString('stat');
      const upg     = UPGRADES[stat];
      if (!upg) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription('Invalid upgrade.')], ephemeral:true });

      const upgrades  = pet.upgrades || {};
      const curLevel  = upgrades[stat] || 0;
      if (curLevel >= upg.maxLevel) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription(`${upg.emoji} **${upg.name}** is already at max level (${upg.maxLevel}).`)], ephemeral:true });

      const cost = upg.costs[curLevel];
      if ((pet.tokens||0) < cost) {
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription(`Not enough pet tokens!\n\n${upg.emoji} **${upg.name}** Lv${curLevel+1} costs **${cost} tokens**.\nYou have **${pet.tokens||0} tokens**.\n\nEarn tokens by sending your pet on missions with \`/pet mission\`.`)
        ], ephemeral:true });
      }

      pet.tokens          = (pet.tokens||0) - cost;
      upgrades[stat]      = curLevel + 1;
      pet.upgrades        = upgrades;
      // Apply health upgrade immediately
      if (stat === 'health') {
        const stats = calcPetStats(pet);
        pet.hp      = Math.min(stats.hp + 50 * (curLevel+1), stats.hp + 50 * (curLevel+1));
      }
      await savePet(userId, pet);

      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`${upg.emoji} ${upg.name} Upgraded!`)
        .setDescription(`${pet.emoji} **${pet.name}**'s ${upg.name} upgraded to **Level ${curLevel+1}/${upg.maxLevel}**!\n\n*${upg.desc}*`)
        .addFields(
          { name:'🪙 Tokens Spent',     value:`-${cost}`,             inline:true },
          { name:'🪙 Tokens Remaining', value:`${pet.tokens}`,        inline:true },
        )
      ]});
    }

    // ── GUARD ──
    if (sub === 'guard') {
      pet.isGuarding = !pet.isGuarding;
      await savePet(userId, pet);
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(pet.isGuarding ? 0x2ecc71 : 0x888888)
        .setTitle(pet.isGuarding ? '🛡️ Guard Mode ON' : '😴 Guard Mode OFF')
        .setDescription(pet.isGuarding
          ? `${pet.emoji} **${pet.name}** is now guarding you. It will defend you from attacks — and fight back!`
          : `${pet.emoji} **${pet.name}** is no longer on guard duty.`)
      ]});
    }

    // ── HEAL ──
    if (sub === 'heal') {
      const amount = interaction.options.getInteger('amount');
      const stats  = calcPetStats(pet);
      if ((pet.hp||stats.hp) >= stats.hp) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription(`${pet.emoji} **${pet.name}** is already at full HP!`)], ephemeral:true });
      const user   = getOrCreateUser(userId);
      if (user.wallet < amount) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You only have **$${user.wallet.toLocaleString()}**.`)], ephemeral:true });
      const healAmt = Math.floor(amount / 10);
      user.wallet  -= amount;
      pet.hp        = Math.min(stats.hp, (pet.hp||0) + healAmt);
      saveUser(userId, user);
      await savePet(userId, pet);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('💊 Healed!').setDescription(`Spent **$${amount.toLocaleString()}** healing ${pet.emoji} **${pet.name}**!`).addFields({ name:'❤️ HP', value:`${pet.hp}/${stats.hp}`, inline:true })] });
    }

    // ── RENAME ──
    if (sub === 'rename') {
      const newName = interaction.options.getString('name').slice(0,30);
      pet.name      = newName;
      await savePet(userId, pet);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2).setDescription(`${pet.emoji} Your pet has been renamed to **${newName}**!`)] });
    }

    // ── EVOLVE ──
    if (sub === 'evolve') {
      const pType = PET_TYPES[pet.type];
      if (!pType.evolvesTo) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription(`${pet.emoji} **${pet.name}** is already at its **final form**.`)], ephemeral:true });
      if (pet.level < pType.evolveLevel) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${pet.emoji} **${pet.name}** needs to be **Level ${pType.evolveLevel}** to evolve. Currently Level ${pet.level}.`)], ephemeral:true });
      const nextType = PET_TYPES[pType.evolvesTo];
      pet.type  = pType.evolvesTo;
      pet.emoji = nextType.emoji;
      pet.name  = nextType.name;
      pet.xp    = 0;
      const newStats = calcPetStats(pet);
      pet.hp    = newStats.hp;
      await savePet(userId, pet);
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('✨ EVOLVED!')
        .setDescription(`${pet.emoji} **${pet.name}** evolved!\n\n*${nextType.desc}*`)
        .addFields(
          { name:'⚔️ Power',   value:newStats.power.toString(),   inline:true },
          { name:'🛡️ Defense', value:newStats.defense.toString(), inline:true },
          { name:'❤️ HP',     value:newStats.hp.toString(),       inline:true },
        )
      ]});
    }

    // ── RELEASE ──
    if (sub === 'release') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pet_release_yes').setLabel('Release').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('pet_release_no').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setTitle('⚠️ Release Pet?').setDescription(`Are you sure you want to release **${pet.emoji} ${pet.name}**? This is permanent.`)], components:[row], ephemeral:true });
      const msg = await interaction.fetchReply();
      const col = msg.createMessageComponentCollector({ time:30_000 });
      col.on('collect', async btn => {
        col.stop();
        if (btn.customId === 'pet_release_no') return btn.update({ embeds:[new EmbedBuilder().setColor(0x888888).setDescription('Release cancelled.')], components:[] });
        await deletePet(userId);
        await btn.update({ embeds:[new EmbedBuilder().setColor(0x888888).setTitle('🌿 Released').setDescription(`**${pet.emoji} ${pet.name}** was released. They looked back once, then disappeared.`)], components:[] });
      });
    }
  },
};
