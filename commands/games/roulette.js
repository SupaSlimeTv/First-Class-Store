const { SlashCommandBuilder } = require('discord.js');
const { getUser, saveUser } = require('../../utils/db');
const { rouletteEmbed, errorEmbed } = require('../../utils/embeds');

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

const BET_TYPES = {
  red:    { payout:1,  desc:'Lands on red',    check:(n)=>n!==0&&RED_NUMBERS.has(n),  color:'red'   },
  black:  { payout:1,  desc:'Lands on black',  check:(n)=>n!==0&&!RED_NUMBERS.has(n), color:'black' },
  even:   { payout:1,  desc:'Lands on even',   check:(n)=>n!==0&&n%2===0,             color:'black' },
  odd:    { payout:1,  desc:'Lands on odd',    check:(n)=>n!==0&&n%2!==0,             color:'black' },
  low:    { payout:1,  desc:'1–18',            check:(n)=>n>=1&&n<=18,                color:'black' },
  high:   { payout:1,  desc:'19–36',           check:(n)=>n>=19&&n<=36,               color:'black' },
  dozen1: { payout:2,  desc:'1st dozen 1–12',  check:(n)=>n>=1&&n<=12,                color:'black' },
  dozen2: { payout:2,  desc:'2nd dozen 13–24', check:(n)=>n>=13&&n<=24,               color:'black' },
  dozen3: { payout:2,  desc:'3rd dozen 25–36', check:(n)=>n>=25&&n<=36,               color:'black' },
  green:  { payout:35, desc:'Green 0 jackpot', check:(n)=>n===0,                      color:'green' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Spin the roulette wheel!')
    .addIntegerOption((o) => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('type').setDescription('What to bet on').setRequired(true)
      .addChoices(
        { name: '🔴 Red (1:1)',          value: 'red'    },
        { name: '⚫ Black (1:1)',         value: 'black'  },
        { name: '🔢 Even (1:1)',          value: 'even'   },
        { name: '🔢 Odd (1:1)',           value: 'odd'    },
        { name: '📉 Low 1-18 (1:1)',      value: 'low'    },
        { name: '📈 High 19-36 (1:1)',    value: 'high'   },
        { name: '1️⃣ 1st Dozen (2:1)',     value: 'dozen1' },
        { name: '2️⃣ 2nd Dozen (2:1)',     value: 'dozen2' },
        { name: '3️⃣ 3rd Dozen (2:1)',     value: 'dozen3' },
        { name: '🟢 Green 0 (35:1)',      value: 'green'  },
      )),

  async execute(interaction) {
    const bet     = interaction.options.getInteger('bet');
    const betType = interaction.options.getString('type');
    const user    = getUser(interaction.user.id);

    if (bet > user.wallet) return interaction.reply({ embeds: [errorEmbed(`You only have **$${user.wallet.toLocaleString()}** in your wallet!`)], ephemeral: true });

    const result  = Math.floor(Math.random() * 37);
    const info    = BET_TYPES[betType];
    const won     = info.check(result);
    const color   = result === 0 ? 'green' : RED_NUMBERS.has(result) ? 'red' : 'black';

    if (won) { user.wallet += bet * info.payout; }
    else     { user.wallet -= bet; }
    saveUser(interaction.user.id, user);

    await interaction.reply({ embeds: [rouletteEmbed(betType, info.desc, result, color, bet, won, info.payout, user.wallet)] });
  },
};
