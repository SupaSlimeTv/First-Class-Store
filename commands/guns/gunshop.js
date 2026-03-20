const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { getGangByMember } = require('../../utils/gangDb');
const { getGunShop, getGunInventory, saveGunInventory, getGunById } = require('../../utils/gunDb');
const { noAccount } = require('../../utils/accountCheck');
const { COLORS } = require('../../utils/embeds');

const RARITY_COLORS = { Common:0x888888, Uncommon:0x2ecc71, Rare:0x3498db, Epic:0x9b59b6, Legendary:0xff6b35, Mythic:0xff0000 };
const RARITY_EMOJI  = { Common:'⚪', Uncommon:'🟢', Rare:'🔵', Epic:'🟣', Legendary:'🟠', Mythic:'🔴' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gunshop')
    .setDescription('Browse and buy weapons from the gang gun shop.')
    .addStringOption(o => o.setName('type').setDescription('Filter by weapon type').setRequired(false)
      .addChoices(
        { name:'🔫 Pistols',   value:'Pistol'  },
        { name:'💨 SMGs',      value:'SMG'     },
        { name:'🪖 Rifles',    value:'Rifle'   },
        { name:'💥 Shotguns',  value:'Shotgun' },
        { name:'🎯 Snipers',   value:'Sniper'  },
        { name:'🚀 Heavy',     value:'Heavy'   },
      )
    ),

  async execute(interaction) {
    if (await noAccount(interaction)) return;

    // Gang check
    const gang = getGangByMember(interaction.user.id);
    if (!gang) {
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle('🔒 Gang Members Only')
        .setDescription('The gun shop is only accessible to gang members.\n\nJoin or create a gang first with `/gang create` or wait for an invite.')
      ], ephemeral: true });
    }

    const shop   = getGunShop();
    const filter = interaction.options.getString('type');
    const guns   = filter ? shop.guns.filter(g => g.type === filter && g.enabled !== false) : shop.guns.filter(g => g.enabled !== false);

    if (!guns.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription('No weapons available right now.')], ephemeral: true });

    const perPage = 3;
    const pages   = Math.ceil(guns.length / perPage);
    let page      = 0;

    const buildEmbed = (p) => {
      const slice = guns.slice(p * perPage, (p+1) * perPage);
      const embed = new EmbedBuilder()
        .setColor(0xff3b3b)
        .setTitle(`🔫 Gang Gun Shop ${gang.color}`)
        .setDescription(`*Gang members only. What happens in the shop stays in the shop.*\n\nPage ${p+1}/${pages}`)
        .setFooter({ text: `${gang.name} ${gang.tag} · /gunbuy <gun_id> to purchase` });

      for (const gun of slice) {
        const dmg = `${gun.damage[0]}–${gun.damage[1]}`;
        embed.addFields({
          name: `${gun.emoji} **${gun.name}** ${RARITY_EMOJI[gun.rarity]} ${gun.rarity}`,
          value: `*${gun.desc}*\n\`\`\`Type: ${gun.type} | Damage: ${dmg} | Accuracy: ${Math.round(gun.accuracy*100)}%\nFire Rate: ${gun.fireRate} | Capacity: ${gun.capacity} rounds\`\`\`💰 **$${gun.price.toLocaleString()}** — ID: \`${gun.id}\``,
          inline: false,
        });
      }
      return embed;
    };

    const buildRow = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gs_prev_${p}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p===0),
      new ButtonBuilder().setCustomId(`gs_buy_${p}`).setLabel('💳 Buy a Gun').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`gs_next_${p}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p>=pages-1),
    );

    await interaction.reply({ embeds: [buildEmbed(page)], components: [buildRow(page)], ephemeral: true });
    const msg = await interaction.fetchReply();
    const col = msg.createMessageComponentCollector({ time: 120_000 });

    col.on('collect', async btn => {
      if (btn.user.id !== interaction.user.id) return btn.reply({ content:'Not your shop.', ephemeral:true });
      if (btn.customId.startsWith('gs_prev')) page = Math.max(0, page-1);
      if (btn.customId.startsWith('gs_next')) page = Math.min(pages-1, page+1);
      if (btn.customId.startsWith('gs_buy')) {
        // Show select menu for current page guns
        const slice   = guns.slice(page * perPage, (page+1) * perPage);
        const selRow  = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('gs_select_gun')
            .setPlaceholder('Choose a weapon...')
            .addOptions(slice.map(g => ({
              label:       `${g.name} — $${g.price.toLocaleString()}`,
              description: `${g.type} | Dmg: ${g.damage[0]}-${g.damage[1]} | ${g.rarity}`,
              value:       g.id,
              emoji:       g.emoji,
            })))
        );
        return btn.update({ embeds: [buildEmbed(page)], components: [buildRow(page), selRow] });
      }
      await btn.update({ embeds: [buildEmbed(page)], components: [buildRow(page)] });
    });
  },
};
