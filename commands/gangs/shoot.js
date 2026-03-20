const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getConfig, isPurgeActive } = require('../../utils/db');
const { getGangByMember } = require('../../utils/gangDb');
const { getGunInventory, saveGunInventory, getGunById, getHealth, saveHealth, getStatus, MAX_HP } = require('../../utils/gunDb');
const { addHeat, isJailed, getJailTimeLeft } = require('../../utils/police');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const SHOOT_COOLDOWN = 3 * 60 * 1000; // 3 min
const cooldowns      = new Map();

const OUTCOME_MSGS = {
  miss:     ['The shot went wide.', 'Missed entirely.', 'You need more practice.', 'Bullet hit a wall.'],
  graze:    ['A graze — that stung.', 'Barely caught them.', 'Glancing blow.', 'Just a scratch... for now.'],
  hit:      ['Clean hit.', 'That connected.', 'Right on target.', 'Solid shot.'],
  critical: ['CRITICAL HIT!', 'Right between the eyes!', 'Devastating shot!', 'They\'re not getting up from that.'],
  kill:     ['They\'re down.', 'Lights out.', 'Gone.', 'Done.'],
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shoot')
    .setDescription('Shoot another player with your equipped gun.')
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

    if (isJailed(userId)) return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x003580).setTitle('🚔 Jailed').setDescription(`You're locked up. ${getJailTimeLeft(userId)} minutes left.`)], ephemeral:true });

    // Check shooter has a gun
    const inv = getGunInventory(userId);
    if (!inv.length) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have any weapons. Buy one at `/gunshop`.")], ephemeral:true });

    // Pick gun
    let gunEntry = gunId && gunId !== '__none__' ? inv.find(i => i.gunId === gunId) : inv[0];
    if (!gunEntry) gunEntry = inv[0];
    const gun = getGunById(gunEntry.gunId);
    if (!gun) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription("That gun is no longer in the shop. Strange.")], ephemeral:true });

    // Ammo check
    if ((gunEntry.ammo || 0) <= 0) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Your **${gun.name}** is out of ammo! Buy another gun for more rounds.`)], ephemeral:true });

    // Cooldown
    const lastShot = cooldowns.get(userId);
    if (lastShot && Date.now() - lastShot < SHOOT_COOLDOWN) {
      const left = Math.ceil((SHOOT_COOLDOWN - (Date.now()-lastShot))/1000);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`Wait **${left}s** before shooting again.`)], ephemeral:true });
    }
    cooldowns.set(userId, Date.now());

    // Use ammo
    gunEntry.ammo = Math.max(0, (gunEntry.ammo||0) - 1);
    saveGunInventory(userId, inv);

    // Hit calculation
    const hitRoll     = Math.random();
    const hit         = hitRoll < gun.accuracy;
    const critRoll    = Math.random();
    const isCrit      = hit && critRoll < 0.20;
    const isMiss      = !hit;

    let damage = 0;
    let outcomeType = 'miss';

    if (!isMiss) {
      const baseDmg = gun.damage[0] + Math.floor(Math.random() * (gun.damage[1] - gun.damage[0]));
      damage        = isCrit ? Math.floor(baseDmg * 1.75) : baseDmg;
      if (damage < 15)      outcomeType = 'graze';
      else if (damage < 40) outcomeType = 'hit';
      else if (isCrit)      outcomeType = 'critical';
      else                  outcomeType = 'hit';
    }

    // Apply damage to target health
    const targetHealth = getHealth(target.id);
    const purge        = isPurgeActive();

    let newHp = Math.max(0, (targetHealth.hp || MAX_HP) - damage);
    let died  = false;

    if (damage > 0 && newHp <= 0) {
      died       = true;
      outcomeType= 'kill';
      newHp      = 0;
      targetHealth.deathCount  = (targetHealth.deathCount||0) + 1;
      targetHealth.status      = 'dead';
      targetHealth.hospitalUntil = Date.now() + 15 * 60 * 1000; // 15 min recovery
    } else if (newHp <= 20 && damage > 0) {
      targetHealth.status = 'critical';
    } else if (newHp <= 50 && damage > 0) {
      targetHealth.status = 'injured';
    } else {
      targetHealth.status = 'alive';
    }
    targetHealth.hp          = newHp;
    targetHealth.lastUpdated = Date.now();
    saveHealth(target.id, targetHealth);

    // Heat — no consequences during purge
    const heatAdded = purge ? 0 : (died ? 40 : damage > 30 ? 20 : 8);
    if (heatAdded > 0) addHeat(userId, heatAdded, 'shooting');

    // Steal money if killed
    let stolen = 0;
    if (died) {
      const victim   = getOrCreateUser(target.id);
      stolen         = Math.floor(victim.wallet * 0.25);
      victim.wallet  = Math.max(0, victim.wallet - stolen);
      const shooter  = getOrCreateUser(userId);
      shooter.wallet += stolen;
      saveUser(target.id, victim);
      saveUser(userId, shooter);
    }

    // Build result embed
    const targetStatus = getStatus(newHp);
    const outcomeMsg   = OUTCOME_MSGS[outcomeType]?.[Math.floor(Math.random()*OUTCOME_MSGS[outcomeType].length)] || '';
    const hpBar        = '█'.repeat(Math.floor(newHp/10)) + '░'.repeat(10-Math.floor(newHp/10));

    const color = died ? 0x111111 : isCrit ? 0xff0000 : isMiss ? 0x444444 : 0xff6600;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(isMiss ? `${gun.emoji} Miss!` : died ? `${gun.emoji} 💀 ELIMINATED` : `${gun.emoji} ${outcomeType === 'critical' ? '💥 CRITICAL HIT!' : 'Shot fired!'}`)
      .setDescription(isMiss
        ? `*${outcomeMsg}*\n\n${gun.emoji} **${gun.name}** fired at <@${target.id}> — but missed.`
        : `*${outcomeMsg}*\n\n${gun.emoji} **${gun.name}** hit <@${target.id}> for **${damage} damage**!`)
      .addFields(
        { name: `<@${target.id}> HP`, value: `[${hpBar}] ${newHp}/${MAX_HP}\n${targetStatus.label}`, inline: true },
        { name: '📦 Ammo Left', value: `${gunEntry.ammo} rounds`, inline: true },
      );

    if (!isMiss && !purge) embed.addFields({ name:'🌡️ Heat', value:`+${heatAdded}`, inline:true });
    if (died && stolen > 0) embed.addFields({ name:'💰 Looted', value:`$${stolen.toLocaleString()} taken`, inline:true });
    if (died) embed.addFields({ name:'🏥 Recovery', value:`<@${target.id}> is down for **15 minutes**. Visit a hospital to recover faster.`, inline:false });

    await interaction.reply({ embeds:[embed] });

    // DM the target
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(died ? 0x111111 : 0xff6600)
        .setTitle(died ? '💀 You\'ve Been Eliminated!' : `${gun.emoji} You've Been Shot!`)
        .setDescription(`**${interaction.user.username}** shot you with a **${gun.name}**!\n\n${died ? 'You\'re down for 15 minutes. Visit a hospital to recover.' : `You took **${damage} damage**. Current HP: **${newHp}/${MAX_HP}**`}`)
        .addFields({ name:'Your Status', value: targetStatus.label, inline:true });
      await target.send({ embeds:[dmEmbed] });
    } catch {}
  },
};
