// ============================================================
// commands/economy/createitem.js — /createitem
// Admin/owner slash command to create store items without
// needing to open the dashboard
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getStore, saveStore, getConfig } = require('../../utils/db');
const { COLORS } = require('../../utils/embeds');

const EFFECT_TYPES = [
  { name:'💸 Drain Wallet',     value:'drain_wallet' },
  { name:'💻 Drain All',        value:'drain_all' },
  { name:'🔇 Silence',          value:'silence' },
  { name:'🔫 Hitman',           value:'hitman' },
  { name:'🏅 Give Role on Use', value:'give_role' },
  { name:'🏅 Remove Role on Use',value:'remove_role' },
  { name:'💰 Passive Income',   value:'passive_income' },
  { name:'🛡️ Shield',           value:'shield' },
  { name:'⚡ EMP Device',       value:'emp' },
  { name:'🎲 Gamble',           value:'gamble' },
  { name:'None',                value:'none' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createitem')
    .setDescription('Create a new item in the store (admin/owner only)')
    .addStringOption(o => o.setName('name').setDescription('Display name of the item').setRequired(true).setMaxLength(50))
    .addIntegerOption(o => o.setName('price').setDescription('Price in dollars').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('description').setDescription('Item description').setRequired(true).setMaxLength(200))
    .addStringOption(o => o.setName('type').setDescription('Item type').setRequired(true)
      .addChoices(
        { name:'🛒 Buyable (owned, no effect on use)', value:'buyable' },
        { name:'⚡ Useable (has effect when used)',   value:'useable' },
        { name:'🎁 Role Reward (grants role on buy)', value:'role_reward' },
      ))
    .addStringOption(o => o.setName('effect').setDescription('Effect when used (useable items only)').setRequired(false)
      .addChoices(...EFFECT_TYPES))
    .addRoleOption(o => o.setName('role').setDescription('Role to give on purchase OR give/remove on use').setRequired(false))
    .addBooleanOption(o => o.setName('reusable').setDescription('Can this item be used multiple times?').setRequired(false))
    .addBooleanOption(o => o.setName('enabled').setDescription('Is this item available in the store?').setRequired(false))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to prefix the item name (optional)').setRequired(false).setMaxLength(4)),

  async execute(interaction) {
    // Admin/owner only
    const isAdmin = interaction.member.permissions.has('Administrator') || interaction.member.permissions.has('ManageGuild');
    const config  = getConfig(interaction.guildId);
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    if (!isAdmin && !isOwner) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('🚫 Only admins and the server owner can create store items.')
      ], ephemeral:true });
    }

    const name    = interaction.options.getString('name');
    // Auto-generate ID from name: lowercase, spaces→hyphens, strip special chars
    const rawId   = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-_]/g,'').slice(0,30);
    const price   = interaction.options.getInteger('price');
    const desc    = interaction.options.getString('description');
    const type    = interaction.options.getString('type');
    const effect  = interaction.options.getString('effect') || 'none';
    const role    = interaction.options.getRole('role');
    const reusable= interaction.options.getBoolean('reusable') ?? false;
    const enabled = interaction.options.getBoolean('enabled') ?? true;
    const emoji   = interaction.options.getString('emoji') || '';

    const store = getStore(interaction.guildId);
    if (store.items.find(i => i.id === rawId)) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`An item with ID \`${rawId}\` already exists. Choose a different ID.`)
      ], ephemeral:true });
    }

    // Build effect object
    let effectObj = null;
    if (type === 'useable' && effect !== 'none') {
      if (effect === 'give_role' || effect === 'remove_role') {
        if (!role) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
          .setDescription('You must specify a **role** option when using give/remove role effect.')
        ], ephemeral:true });
        effectObj = { type:'edit_roles', action: effect === 'give_role' ? 'add' : 'remove', roleId: role.id, target:'self' };
      } else {
        effectObj = { type: effect };
        // Set sensible defaults for common effects
        if (effect === 'drain_wallet') { effectObj.amount = 0.25; effectObj.drainType = 'percent'; effectObj.drainTarget = 'wallet'; }
        if (effect === 'drain_all')    { effectObj.amount = 0.25; effectObj.drainType = 'percent'; effectObj.drainTarget = 'both'; }
        if (effect === 'silence')      { effectObj.durationHours = 1; }
        if (effect === 'passive_income'){ effectObj.amount = 100; effectObj.durationHours = 24; }
        if (effect === 'shield')       { effectObj.durationHours = 24; }
        if (effect === 'gamble')       { effectObj.minMultiplier = 0.5; effectObj.maxMultiplier = 3; }
      }
    }

    const newItem = {
      id:          rawId,
      name:        emoji ? `${emoji} ${name}` : name,
      description: desc,
      price,
      type:        type === 'role_reward' ? 'buyable' : type,
      reusable,
      enabled,
      roleReward:  (type === 'role_reward' && role) ? role.id : (role && type !== 'useable' ? role.id : null),
      effect:      effectObj,
      requirements:null,
      isDrug:      false,
      isWeapon:    false,
    };

    store.items.push(newItem);
    saveStore(store, interaction.guildId);

    const effectLabel = EFFECT_TYPES.find(e=>e.value===effect)?.name || 'None';

    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`✅ Item Created — ${newItem.name}`)
      .setDescription(`\`${rawId}\` has been added to **${interaction.guild.name}**'s item store.`)
      .addFields(
        { name:'💰 Price',    value:`$${price.toLocaleString()}`,                               inline:true },
        { name:'📦 Type',     value:type,                                                        inline:true },
        { name:'⚡ Effect',   value:effectLabel,                                                 inline:true },
        { name:'🏅 Role',     value:role ? `<@&${role.id}>` : 'None',                           inline:true },
        { name:'♻️ Reusable', value:reusable ? 'Yes' : 'No',                                    inline:true },
        { name:'🟢 Enabled',  value:enabled ? 'Yes' : 'No',                                     inline:true },
        { name:'📝 Description', value:desc,                                                     inline:false },
      )
      .setFooter({ text:'Edit full settings anytime in the dashboard → Item Store' })
    ], ephemeral:true });
  },
};
