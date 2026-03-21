const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { PHONE_TYPES } = require('../../utils/phoneDb');
const { getPhone } = require('../../utils/phoneDb');
const { COLORS } = require('../../utils/embeds');

const RARITY = { burner:'t-muted', standard:'t-green', flagship:'t-blue', creator:'t-gold' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('phoneshop')
    .setDescription('Browse phones available for purchase.'),

  async execute(interaction) {
    const current = getPhone(interaction.user.id);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📱 Phone Shop')
      .setDescription('Buy a phone to post on social media, build influence, earn sponsor deals, and call the police on other users.\n\nUse `/phone buy type:` to purchase.')
      .addFields(
        ...Object.entries(PHONE_TYPES).map(([id, t]) => ({
          name: `${t.emoji} ${t.name}${current?.type===id?' ✅ (owned)':''}`,
          value: `*${t.desc}*\n💵 **$${t.cost.toLocaleString()}**\n✨ Hype Bonus: **+${Math.round(t.hypeBonus*100)}%**\n💰 Money Bonus: **+${Math.round(t.moneyBonus*100)}%**`,
          inline: true,
        }))
      )
      .addFields({ name:'📲 Platforms', value:'📸 **Flexgram** (45m CD) · 🐦 **Chirp** (20m CD) · 🎮 **Streamz** (90m CD)\n\nEach post earns hype, followers, and money. Go viral for 2–5× rewards. Shout out memecoins by mentioning their ticker in posts!', inline:false })
      .setFooter({ text:'You can only own one phone at a time.' });

    return interaction.reply({ embeds:[embed] });
  },
};
