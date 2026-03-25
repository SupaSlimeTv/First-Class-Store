const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getHome: _gh, isSleeping: _is } = require('../../utils/homeDb');
const { getOrCreateUser, saveUser, getConfig, isPurgeActive } = require('../../utils/db');
const { getGangByMember } = require('../../utils/gangDb');
const { getGunInventory, saveGunInventory, getGunById } = require('../../utils/gunDb');
const { addHeat, checkPoliceRaid, isJailed, getJailTimeLeft } = require('../../utils/police');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const SHOOT_COOLDOWN = 3 * 60 * 1000; // 3 min between shots
const cooldowns      = new Map();

const OUTCOME_MSGS = {
  miss:     ['The shot went wide.', 'Missed entirely.', 'You need more practice.', 'Bullet hit a wall.'],
  graze:    ['A graze — that stung.', 'Barely caught them.', 'Glancing blow.', 'Just a scratch... for now.'],
  hit:      ['Clean hit.', 'That connected.', 'Right on target.', 'Solid shot.'],
  critical: ['CRITICAL HIT!', 'Right between the eyes!', 'Devastating shot!', 'They\'re not getting up from that.'],
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shoot')
    .setDescription('Shoot another player with your equipped gun. (Gang members only)')
    .addUserOption(o => o.setName('target').setDescription('Who to shoot').setRequired(true))
    .addStringOption(o => o.setName('gun').setDescription('Which gun to use').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const inv   = getGunInventory(interaction.user.id);
    const typed = interaction.options.getFocused().toLowerCase();
    const opts  = inv
      .map(i => { const g = getGunById(i.gunId); return g ? { name:`${g.emoji} ${g.name} (${i.ammo} rounds)`, value:g.id } : null; })
      .filter(Boolean)
      .filter(o => o.name.toLowerCase().includes(typed))
      .slice(0, 25);
    await interaction.respond(opts.length ? opts : [{ name:'No guns in inventory', value:'__none__' }]);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target = interaction.options.getUser('target');
    const gunId  = interaction.options.getString('gun');
    const userId = interaction.user.id;

    if (target.id === userId) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't shoot yourself.")], ephemeral:true });
    if (target.bot)           return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("Bots don't bleed.")], ephemeral:true });

    // ── GANG CHECK — only gang members can shoot ──
    const gang = getGangByMember(userId);
    if (!gang) {
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle('🔒 Gang Members Only')
        .setDescription('Only gang members can use weapons.\n\nJoin or create a gang first with `/gang create`.')
      ], ephemeral:true });
    }

    if (isJailed(userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x003580).setTitle('🚔 Jailed').setDescription(`You're locked up. ${getJailTimeLeft(userId)} minutes left.`)], ephemeral:true });

    // ── CHECK SHOOTER HAS A GUN ──
    const inv = getGunInventory(userId);
    if (!inv.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have any weapons. Buy one at `/gunshop`.")], ephemeral:true });

    // Pick gun
    let gunEntry = gunId && gunId !== '__none__' ? inv.find(i => i.gunId === gunId) : inv[0];
    if (!gunEntry) gunEntry = inv[0];
    const gun = getGunById(gunEntry.gunId);
    if (!gun) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("That gun is no longer available.")], ephemeral:true });

    if ((gunEntry.ammo || 0) <= 0) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Your **${gun.name}** is out of ammo!`)], ephemeral:true });

    // Cooldown
    const lastShot = cooldowns.get(userId);
    if (lastShot && Date.now() - lastShot < SHOOT_COOLDOWN) {
      const left = Math.ceil((SHOOT_COOLDOWN - (Date.now()-lastShot))/1000);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Wait **${left}s** before shooting again.`)], ephemeral:true });
    }
    cooldowns.set(userId, Date.now());

    // ── AMMO — switch fires 3 rounds ──
    const burstCount  = gun.hasSwitch ? 3 : 1;
    gunEntry.ammo     = Math.max(0, (gunEntry.ammo||0) - burstCount);
    await saveGunInventory(userId, inv);

    // ── HIT CALCULATION ──
    // Switch gives +10% accuracy (realistic — more rounds, similar chance)
    const switchAccBonus = gun.hasSwitch ? 0.10 : 0;
    const hit     = Math.random() < Math.min(0.95, gun.accuracy + switchAccBonus);
    const isCrit  = hit && Math.random() < 0.20; // same crit chance regardless of switch
    const isMiss  = !hit;

    let damage = 0;
    let outcomeType = 'miss';

    if (!isMiss) {
      const baseDmg = gun.damage[0] + Math.floor(Math.random() * (gun.damage[1] - gun.damage[0]));
      // Switch adds exactly 1 extra round worth of damage (25% more), not multiplicative stacking
      const switchDmgBonus = gun.hasSwitch ? Math.floor(baseDmg * 0.25) : 0;
      damage = isCrit ? Math.floor(baseDmg * 1.5) : baseDmg;
      damage += switchDmgBonus;
      if (damage < 15)      outcomeType = 'graze';
      else if (damage < 40) outcomeType = 'hit';
      else if (isCrit)      outcomeType = 'critical';
      else                  outcomeType = 'hit';
    }

    // ── CHECK TARGET SHIELD (item-based) ──
    const purge = isPurgeActive(interaction.guildId);
    if (damage > 0) {
      const { getUserEffects } = require('../../utils/effects').getUserEffects
        ? require('../../utils/effects')
        : { getUserEffects: () => null };
      // Also check consume shield buff
      const { getConsumeBuff } = require('../../utils/consumeBuffs');
      const consumeShield = getConsumeBuff(target.id, 'shield');
      if (consumeShield) {
        return interaction.reply({ embeds:[new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle('🛡️ Blocked!')
          .setDescription(`${gun.emoji} **${gun.name}** fired at <@${target.id}> — but they're **shielded** and took no damage!`)
        ]});
      }

      // Check protected roles
      const config = getConfig(interaction.guildId);
      const protectedRoles = Array.isArray(config.protectedRoles) ? config.protectedRoles : [];
      if (protectedRoles.length > 0 && interaction.guild) {
        const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (targetMember && protectedRoles.some(r => targetMember.roles.cache.has(r))) {
          return interaction.reply({ embeds:[new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('🛡️ Protected!')
            .setDescription(`<@${target.id}> has a protected role and cannot be harmed.`)
          ], ephemeral:true });
        }
      }
    }

    // ── MONEY LOSS — damage = wallet loss ──
    // 1 damage = 0.4% of wallet, capped at 25%
    let moneyLost = 0;
    if (damage > 0 && !purge) {
      const victim  = getOrCreateUser(target.id);
      const lossPct = Math.min(0.25, damage * 0.004);
      moneyLost     = Math.floor(victim.wallet * lossPct);
      if (moneyLost > 0) {
        victim.wallet          = Math.max(0, victim.wallet - moneyLost);
        const shooter          = getOrCreateUser(userId);
        shooter.wallet        += Math.floor(moneyLost * 0.5);
        saveUser(target.id, victim);
        saveUser(userId, shooter);
      }
    }

    // ── PET GUARD CHECK ──
    let petDefended = false;
    if (damage > 0) {
      const { getPet, calcPetStats, savePet } = require('../../utils/petDb');
      const defPet = getPet(target.id);
      if (defPet && defPet.isGuarding && (defPet.hp||1) > 0) {
        const defStats  = calcPetStats(defPet);
        const blockChance = 0.25 + (defStats.defense / 600);
        if (Math.random() < blockChance) {
          petDefended    = true;
          defPet.hp      = Math.max(0, (defPet.hp||defStats.hp) - Math.floor(damage * 0.3));
          savePet(target.id, defPet);
          // Refund half the money if pet blocked
          if (moneyLost > 0) {
            const victim  = getOrCreateUser(target.id);
            victim.wallet += Math.floor(moneyLost * 0.5);
            saveUser(target.id, victim);
            moneyLost     = Math.floor(moneyLost * 0.5);
          }
        }
      }
    }

    // ── SHOT TIMEOUT — silence target from bot commands ──
    if (damage > 0 && !petDefended) {
      const config         = getConfig(interaction.guildId);
      const timeoutMins    = config.shotTimeoutMinutes ?? 5; // default 5 min, owner sets it
      if (timeoutMins > 0) {
        const victim         = getOrCreateUser(target.id);
        const existingBan    = victim.bannedUntil && victim.bannedUntil > Date.now() ? victim.bannedUntil : Date.now();
        victim.bannedUntil   = existingBan + timeoutMins * 60 * 1000;
        victim.shotBy        = interaction.user.username;
        saveUser(target.id, victim);
      }
    }

    const heatAdded = purge ? 0 : (damage > 0 ? (damage > 50 ? 20 : 8) : 3);
    if (heatAdded > 0) {
      await addHeat(userId, heatAdded, 'shooting');
      // Check if heat triggers arrest → prison
      const config = require('../../utils/db').getConfig(interaction.guildId);
      const raid = await checkPoliceRaid(userId, interaction.client, config.prisonChannelId || config.purgeChannelId);
      if (raid) {
        await interaction.followUp({ embeds:[{ color:0x003580, title:'🚨 Arrested After Shooting!', description:`Too much heat — police showed up!\n\n💸 Seized: **$${raid.stolen.toLocaleString()}**\n⏳ Jailed: **${raid.jailTime} minutes**` }], ephemeral:true });
      }
    }

    // ── BUILD EMBED ──
    const outcomeMsg = OUTCOME_MSGS[outcomeType]?.[Math.floor(Math.random()*OUTCOME_MSGS[outcomeType].length)] || '';
    const switchTag  = gun.hasSwitch ? ' 🔩' : '';
    const color      = isMiss ? 0x444444 : isCrit ? 0xff0000 : 0xff6600;
    const config     = getConfig(interaction.guildId);
    const timeoutMins = config.shotTimeoutMinutes ?? 5;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(isMiss
        ? `${gun.emoji} Miss!`
        : `${gun.emoji}${switchTag} ${isCrit ? '💥 CRITICAL HIT!' : 'Shot fired!'}`)
      .setDescription(isMiss
        ? `*${outcomeMsg}*\n\n${gun.emoji} **${gun.name}**${switchTag} fired at <@${target.id}> — missed.`
        : petDefended
        ? `*${outcomeMsg}*\n\n${gun.emoji} **${gun.name}**${switchTag} hit <@${target.id}> — their pet **blocked** it!`
        : `*${outcomeMsg}*\n\n${gun.emoji} **${gun.name}**${switchTag} hit <@${target.id}> for **${damage} damage**!`)
      .addFields(
        { name:'💸 Money Lost', value: damage > 0 ? `-$${moneyLost.toLocaleString()}` : 'None',                  inline:true },
        { name:'💰 You Gained', value: damage > 0 ? `+$${Math.floor(moneyLost*0.5).toLocaleString()}` : '—',      inline:true },
        { name:'📦 Ammo',       value:`${gunEntry.ammo} rounds`,                                                   inline:true },
      );

    if (gun.hasSwitch) embed.addFields({ name:'🔩 Auto Burst', value:`${burstCount} rounds fired`, inline:true });
    if (damage > 0 && !petDefended && timeoutMins > 0) embed.addFields({ name:'⏱️ Timed Out', value:`<@${target.id}> silenced for **${timeoutMins} min**`, inline:true });
    if (petDefended)   embed.addFields({ name:'🐾 Pet Blocked!', value:'Their guard pet intercepted the shot!', inline:false });
    if (!isMiss && !purge) embed.addFields({ name:'🌡️ Heat', value:`+${heatAdded}`, inline:true });

    await interaction.reply({ embeds:[embed] });

    // ── DM TARGET ──
    if (damage > 0) {
      try {
        await target.send({ embeds:[new EmbedBuilder()
          .setColor(0xff6600)
          .setTitle(`${gun.emoji} You've Been Shot!`)
          .setDescription(`**${interaction.user.username}** shot you with a **${gun.name}**${gun.hasSwitch?' 🔩':''}!\n\nYou lost **$${moneyLost.toLocaleString()}** from your wallet.${timeoutMins > 0 && !petDefended ? `\n\n⏱️ You're silenced from bot commands for **${timeoutMins} minutes**.` : ''}${petDefended ? '\n\n🐾 Your pet blocked some of the damage!' : ''}`)
        ]});
      } catch {}
    }
  },
};
