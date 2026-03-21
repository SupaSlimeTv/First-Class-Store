const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getGangByMember } = require('../../utils/gangDb');
const { getGunInventory, saveGunInventory, getGunById } = require('../../utils/gunDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gunbuy')
    .setDescription('Buy a weapon from the gun shop.')
    .addStringOption(o => o.setName('gun').setDescription('Gun ID (from /gunshop)').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const { getGunShop } = require('../../utils/gunDb');
    const gang = getGangByMember(interaction.user.id);
    if (!gang) return interaction.respond([{ name: 'Join a gang first', value: '__none__' }]);
    const shop  = getGunShop();
    const typed = interaction.options.getFocused().toLowerCase();
    const opts  = shop.guns
      .filter(g => g.enabled !== false && (g.name.toLowerCase().includes(typed) || g.id.includes(typed)))
      .slice(0, 25)
      .map(g => ({ name: `${g.emoji} ${g.name} — $${g.price.toLocaleString()} (${g.rarity})`, value: g.id }));
    await interaction.respond(opts.length ? opts : [{ name: 'No guns found', value: '__none__' }]);
  },

  async execute(interaction) {
    if (await noAccount(interaction)) return;
    const gunId = interaction.options.getString('gun');
    if (gunId === '__none__') return interaction.reply({ content: 'Join a gang first.', ephemeral: true });

    const gang = getGangByMember(interaction.user.id);
    if (!gang) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription('You need to be in a gang to access the gun shop.')], ephemeral: true });

    const gun = getGunById(gunId);
    if (!gun || gun.enabled === false) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`\`${gunId}\` is not available.`)], ephemeral: true });

    const user = getOrCreateUser(interaction.user.id);
    if (user.wallet < gun.price) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`You need **$${gun.price.toLocaleString()}** to buy a **${gun.name}**. You have **$${user.wallet.toLocaleString()}**.`)], ephemeral: true });

    user.wallet -= gun.price;
    const inv   = getGunInventory(interaction.user.id);
    inv.push({ gunId, boughtAt: Date.now(), ammo: gun.capacity * 3 });
    await saveGunInventory(interaction.user.id, inv);
    await saveUser(interaction.user.id, user);

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0xff3b3b)
      .setTitle(`${gun.emoji} ${gun.name} Acquired!`)
      .setDescription(`You purchased a **${gun.name}** for **$${gun.price.toLocaleString()}**.\n\n*${gun.desc}*`)
      .addFields(
        { name:'⚔️ Damage',    value:`${gun.damage[0]}–${gun.damage[1]}`, inline:true },
        { name:'🎯 Accuracy',  value:`${Math.round(gun.accuracy*100)}%`,  inline:true },
        { name:'📦 Ammo',      value:`${gun.capacity * 3} rounds`,         inline:true },
        { name:'💵 Wallet',    value:`$${user.wallet.toLocaleString()}`,   inline:true },
      )
      .setFooter({ text: 'Use /guns to see your arsenal · /shoot @user to use it' })
    ], ephemeral: true });
  },
};
