const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser, getConfig } = require('../../utils/db');
const { getPet, savePet, PET_TYPES, calcPetStats, xpForLevel } = require('../../utils/petDb');
const { addHeat } = require('../../utils/police');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const attackCooldowns = new Map();
const ATTACK_CD = 5 * 60 * 1000; // 5 min

module.exports = {
  data: new SlashCommandBuilder()
    .setName('petattack')
    .setDescription('Send your pet to attack another player\'s wallet or pet.')
    .addUserOption(o => o.setName('target').setDescription('Who to attack').setRequired(true))
    .addStringOption(o => o.setName('mode').setDescription('What to target').setRequired(false)
      .addChoices(
        { name: '💵 Steal wallet money', value: 'wallet' },
        { name: '⚔️ Attack their pet',   value: 'pet'    },
      )
    ),

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const target  = interaction.options.getUser('target');
    const mode    = interaction.options.getString('mode') || 'wallet';
    const userId  = interaction.user.id;

    if (target.id === userId) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't attack yourself.")], ephemeral: true });
    if (target.bot)           return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You can't attack a bot.")], ephemeral: true });

    const myPet = getPet(userId);
    if (!myPet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription("You don't have a pet! Get one at `/petshop`.")], ephemeral: true });

    // Cooldown
    const lastAttack = attackCooldowns.get(userId);
    if (lastAttack && Date.now() - lastAttack < ATTACK_CD) {
      const left = Math.ceil((ATTACK_CD - (Date.now() - lastAttack)) / 60000);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${myPet.emoji} **${myPet.name}** needs to rest for **${left} more minute(s)**.`)], ephemeral: true });
    }

    // Hunger/happiness debuff
    if (myPet.hunger < 20 || myPet.happiness < 20) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${myPet.emoji} **${myPet.name}** is too hungry or unhappy to fight!\n\nFeed it with \`/pet feed\` and play with it with \`/pet play\` first.`)], ephemeral: true });
    }

    attackCooldowns.set(userId, Date.now());
    const pType   = PET_TYPES[myPet.type];
    const myStats = calcPetStats(myPet);

    // Drain hunger/happiness on attack
    myPet.hunger    = Math.max(0, myPet.hunger    - 15);
    myPet.happiness = Math.max(0, myPet.happiness - 10);

    if (mode === 'wallet') {
      const victim = getOrCreateUser(target.id);

      // Check if target has a pet defending them
      const defPet   = getPet(target.id);
      const defStats = defPet ? calcPetStats(defPet) : null;

      // Defense roll — their pet might block
      if (defPet && defPet.hp > 0 && defStats) {
        const defenseRoll = Math.random() * (defStats.defense + myStats.power);
        const attackRoll  = Math.random() * myStats.power;
        if (defenseRoll > attackRoll) {
          // Blocked by defender's pet
          const dmgToAttacker = Math.floor(defStats.power * 0.3);
          myPet.hp = Math.max(0, (myPet.hp||myStats.hp) - dmgToAttacker);
          savePet(userId, myPet);

          return interaction.reply({ embeds: [new EmbedBuilder()
            .setColor(0xff8800)
            .setTitle(`${defPet.emoji} Blocked!`)
            .setDescription(`${myPet.emoji} **${myPet.name}** tried to steal from <@${target.id}> but **${defPet.name}** blocked the attack!\n\n${pType.attackFlavor[0]} was repelled! ${myPet.name} took **${dmgToAttacker} damage** in the process.`)
            .addFields({ name:`${myPet.emoji} ${myPet.name} HP`, value:`${myPet.hp}/${myStats.hp}`, inline:true })
          ]});
        }
      }

      // Attack succeeds
      const stealPct = 0.05 + (myStats.power / 1000);
      const stolen   = Math.floor(victim.wallet * Math.min(0.30, stealPct));
      if (stolen < 1) {
        savePet(userId, myPet);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription(`${myPet.emoji} **${myPet.name}** attacked <@${target.id}> but they had nothing worth stealing.`)] });
      }

      victim.wallet -= stolen;
      const owner    = getOrCreateUser(userId);
      owner.wallet  += stolen;
      saveUser(target.id, victim);
      saveUser(userId, owner);

      // XP gain
      myPet.xp   = (myPet.xp||0) + 25;
      myPet.wins  = (myPet.wins||0) + 1;
      if (myPet.xp >= xpForLevel(myPet.level)) { myPet.xp -= xpForLevel(myPet.level); myPet.level++; }
      savePet(userId, myPet);

      // Add some heat
      await addHeat(userId, 5, 'pet_attack');

      const flavor = pType.attackFlavor[Math.floor(Math.random() * pType.attackFlavor.length)];
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle(`${myPet.emoji} Pet Attack!`)
        .setDescription(`${myPet.emoji} **${myPet.name}** ${flavor} <@${target.id}> and stole **$${stolen.toLocaleString()}**!`)
        .addFields(
          { name:'💰 Stolen',      value:`$${stolen.toLocaleString()}`,       inline:true },
          { name:'💵 Your Wallet', value:`$${owner.wallet.toLocaleString()}`, inline:true },
          { name:'⭐ XP',          value:`+25 (Lv${myPet.level})`,           inline:true },
        )
      ]});

      // DM target
      try { await target.send(`⚔️ ${myPet.emoji} **${myPet.name}** (owned by **${interaction.user.username}**) attacked you and stole **$${stolen.toLocaleString()}**!`); } catch {}
      return;
    }

    if (mode === 'pet') {
      const enemyPet = getPet(target.id);
      if (!enemyPet) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription(`<@${target.id}> doesn't have a pet to fight!`)], ephemeral: true });

      const enemyStats = calcPetStats(enemyPet);
      const enemyType  = PET_TYPES[enemyPet.type];

      // Battle simulation — 3 rounds
      let myHp    = myPet.hp    || myStats.hp;
      let enemyHp = enemyPet.hp || enemyStats.hp;
      const rounds = [];

      for (let r = 0; r < 3 && myHp > 0 && enemyHp > 0; r++) {
        // Attacker hits first
        const myDmg    = Math.max(1, Math.floor(myStats.power    * (0.7 + Math.random()*0.6) - enemyStats.defense * 0.3));
        const enemyDmg = Math.max(1, Math.floor(enemyStats.power * (0.7 + Math.random()*0.6) - myStats.defense    * 0.3));
        enemyHp -= myDmg;
        if (enemyHp > 0) myHp -= enemyDmg;
        rounds.push(`Round ${r+1}: ${myPet.emoji} dealt **${myDmg}** dmg · ${enemyPet.emoji} dealt **${enemyHp > 0 ? enemyDmg : 0}** dmg`);
      }

      const won = myHp > enemyHp;
      myPet.hp    = Math.max(0, myHp);
      enemyPet.hp = Math.max(0, enemyHp);

      if (won) {
        myPet.wins      = (myPet.wins||0)    + 1;
        myPet.xp        = (myPet.xp||0)      + 40;
        enemyPet.losses = (enemyPet.losses||0)+ 1;
        if (myPet.xp >= xpForLevel(myPet.level)) { myPet.xp -= xpForLevel(myPet.level); myPet.level++; }
      } else {
        myPet.losses    = (myPet.losses||0)  + 1;
        myPet.xp        = (myPet.xp||0)      + 10;
        enemyPet.wins   = (enemyPet.wins||0) + 1;
      }

      savePet(userId, myPet);
      savePet(target.id, enemyPet);

      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(won ? COLORS.SUCCESS : COLORS.ERROR)
        .setTitle(`⚔️ Pet Battle — ${myPet.emoji} vs ${enemyPet.emoji}`)
        .setDescription(rounds.join('\n'))
        .addFields(
          { name:`${myPet.emoji} ${myPet.name}`,    value:`❤️ ${Math.max(0,myHp)} HP left`,    inline:true },
          { name:`${enemyPet.emoji} ${enemyPet.name}`,value:`❤️ ${Math.max(0,enemyHp)} HP left`, inline:true },
          { name:'🏆 Result', value:won ? `${myPet.emoji} **${myPet.name}** wins!` : `${enemyPet.emoji} **${enemyPet.name}** wins!`, inline:false },
        )
        .setFooter({ text: `Heal your pet with /pet heal` })
      ]});

      try { await target.send(`⚔️ Your ${enemyPet.emoji} **${enemyPet.name}** was challenged by **${interaction.user.username}**'s ${myPet.emoji} **${myPet.name}**! Your pet has ${Math.max(0,enemyHp)} HP remaining.`); } catch {}
    }
  },
};
