// ============================================================
// commands/economy/illuminatiops.js — /illuminatiops
// Member-only Illuminati operations.
// Hidden from non-members via setDefaultMemberPermissions(0n).
// Server admin must grant the '🔺 Illuminati' role access in
// Server Settings → Integrations → [Bot] → /illuminatiops
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const illuminati = require('./illuminati');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('illuminatiops')
    .setDescription('🔺 Illuminati operations — members only.')
    .setDefaultMemberPermissions(0n)
    .addSubcommand(s => s.setName('invite').setDescription('Invite an eligible member (Elder/Grandmaster only)')
      .addUserOption(o => o.setName('user').setDescription('Who to invite').setRequired(true)))
    .addSubcommand(s => s.setName('faction').setDescription('Join a faction (Elders and Grandmasters only)')
      .addStringOption(o => o.setName('name').setDescription('Faction to join').setRequired(true)
        .addChoices(
          { name: '💰 Financial Elite',      value: 'financial_elite'   },
          { name: '🏛️ Political Power',      value: 'political_power'   },
          { name: '🎬 Entertainment Moguls', value: 'entertainment'     },
          { name: '🔮 Secret Societies',     value: 'secret_societies'  },
          { name: '💻 Tech Giants',          value: 'tech_giants'       },
          { name: '🔨 Freemason Lodge',      value: 'freemason_lodge'   },
          { name: '🏆 Sports Syndicate',     value: 'sports_syndicate'  },
          { name: '👑 Old Blood Elite',      value: 'old_blood_elite'   },
          { name: '🎭 Hollywood Cabal',      value: 'hollywood_cabal'   },
        )))
    .addSubcommand(s => s.setName('ritual').setDescription('Perform a ritual')
      .addStringOption(o => o.setName('name').setDescription('Ritual to perform').setRequired(true)
        .addChoices(
          { name: '🔺 The Awakening',                                                              value: 'initiation'        },
          { name: '💰 Prosperity Circle',                                                           value: 'career_boost'      },
          { name: '👑 Dominion Ritual',                                                             value: 'power_grab'        },
          { name: '🖤 Soul Exchange',                                                               value: 'soul_exchange'     },
          { name: '🌑 Blood Moon Sacrifice',                                                        value: 'blood_moon'        },
          { name: '🔨 Brotherhood Oath',                                                            value: 'brotherhood_oath'  },
          { name: '💫 Championship Hex',                                                            value: 'championship_hex'  },
          { name: '🎭 Starmaker Rite',                                                              value: 'starmaker_rite'    },
          { name: '⛓️ The Covenant',                                                               value: 'covenant'          },
          { name: '🕯️ Dark Bargain',                                                               value: 'dark_bargain'      },
          { name: '⚰️ Grand Sacrifice — ransom or seize a member\'s assets',                      value: 'grand_sacrifice'   },
          { name: '🌒 Blood Eclipse — drain ALL non-member wallets 8% ($1M vault)',               value: 'blood_eclipse'     },
          { name: '💀 Soul Harvest — seize 20% from every soul-sold member',                       value: 'soul_harvest'      },
          { name: '✨ Dark Enlightenment — +2 biz + 250K followers to all members ($300K vault)', value: 'dark_enlightenment'},
          { name: '🕳️ Abyssal Pact — untouchable 7 days + server announcement ($500K vault)',    value: 'abyssal_pact'      },
        ))
      .addUserOption(o => o.setName('target').setDescription('Target user (Blood Moon, Hex, Starmaker, Dark Bargain, Grand Sacrifice)').setRequired(false)))
    .addSubcommand(s => s.setName('family').setDescription('Influence a family (Illuminati only)')
      .addUserOption(o => o.setName('target').setDescription('User whose family to influence').setRequired(true))
      .addStringOption(o => o.setName('action').setDescription('Type of influence').setRequired(true)
        .addChoices(
          { name: '✨ Bless',        value: 'bless'       },
          { name: '💀 Curse',        value: 'curse'       },
          { name: '🎯 Opportunity',  value: 'opportunity' },
        )))
    .addSubcommand(s => s.setName('vault').setDescription('Contribute to or view the vault')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to contribute (leave blank to view)').setRequired(false).setMinValue(1)))
    .addSubcommand(s => s.setName('promote').setDescription('Promote a member (Grandmaster only)')
      .addUserOption(o => o.setName('user').setDescription('Member to promote').setRequired(true)))
    .addSubcommand(s => s.setName('excommunicate').setDescription('Exile a member (Elder/Grandmaster only)')
      .addUserOption(o => o.setName('user').setDescription('Member to exile').setRequired(true)))
    .addSubcommand(s => s.setName('operate').setDescription('Execute an operation using vault funds')
      .addStringOption(o => o.setName('operation').setDescription('Operation to run').setRequired(true)
        .addChoices(
          { name: '🕵️ Shadow Rob — anonymously drain 10% from a user ($50k)',                   value: 'shadow_rob'          },
          { name: '📡 Intel Report — full profile on any user ($25k)',                            value: 'intel'               },
          { name: '🛡️ Protection Racket — demand tribute from a gang (free)',                    value: 'protection'          },
          { name: '📊 Market Manipulation — pump or dump a coin 30min ($200k)',                  value: 'market_manip'        },
          { name: '💸 Tribute Collection — collect owed tribute now',                             value: 'collect_tribute'     },
          { name: '📸 Blackmail — control a Celebrity+ ($150k)',                                  value: 'blackmail'           },
          { name: '🎵 Force Sign — force a Celebrity+ onto your label (free)',                    value: 'sign_artist'         },
          { name: '🎤 Sabotage Artist — crash a signed artist career ($75k)',                     value: 'sabotage'            },
          { name: '🔇 Silence Campaign — suppress a user phone posts ($60k)',                     value: 'silence_campaign'    },
          { name: '💰 Extort — demand payment or face shadow rob ($0)',                           value: 'extort'              },
          { name: '🌱 Industry Plant — make any artist a superstar overnight ($500k)',            value: 'industry_plant'      },
          { name: '🏛️ Policy Change — alter server rules temporarily ($100k)',                   value: 'policy_change'       },
          { name: '💻 Data Breach — steal sensitive info from all users ($75k)',                  value: 'data_breach'         },
          { name: '🎬 Viral Campaign — create a viral trend for faction benefit ($50k)',          value: 'viral_campaign'      },
          { name: '🔮 Ancient Ritual — powerful ritual affecting the whole server ($300k)',       value: 'ancient_ritual'      },
          { name: '🔨 Lodge Meeting — brotherhood dividend paid to all Masons (free)',            value: 'lodge_meeting'       },
          { name: '🏆 Match Fix — rigged winnings paid to Sports Syndicate members ($150k)',      value: 'match_fix'           },
          { name: '👑 Bloodline Dividend — amplify bank interest for Old Blood members ($250k)', value: 'bloodline_dividend'  },
          { name: '🎭 Industry Blacklist — kill target phone earnings for 7 days ($80k)',         value: 'blacklist'           },
          { name: '🏛️ Market Policy — Political Power: bull/bear all coins 1hr ($150k)',         value: 'political_market'    },
          { name: '💻 Volatility Hack — Tech Giants: 2x market chaos 1hr ($125k)',               value: 'tech_volatility'     },
        ))
      .addUserOption(o => o.setName('target').setDescription('Target user (not needed for market manipulation)').setRequired(false))
      .addStringOption(o => o.setName('coin').setDescription('Coin ticker (market manipulation only — type to search)').setRequired(false).setAutocomplete(true))
      .addStringOption(o => o.setName('direction').setDescription('Direction (pump/dump for market_manip, bull/bear for political_market)').setRequired(false)
        .addChoices(
          { name: '📈 Pump / Bull', value: 'pump' },
          { name: '📉 Dump / Bear', value: 'dump' },
        ))),

  autocomplete: (interaction) => illuminati.autocomplete(interaction),
  execute:      (interaction) => illuminati.execute(interaction),
};
