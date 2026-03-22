// ============================================================
// commands/fun/blacktea.js
// Turn-based word game — type a word containing the given 3 letters
// Last player standing wins. Integrated with economy for wagers.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getOrCreateUser, saveUser } = require('../../utils/db');
const { COLORS } = require('../../utils/embeds');

// ── WORD LIST ─────────────────────────────────────────────────
// Common 3-letter combos used in the game
const COMBOS = [
  'the','ing','tion','and','for','are','but','not','you','all',
  'can','her','was','one','our','out','day','get','has','him',
  'his','how','its','now','old','see','two','way','who','boy',
  'did','man','may','put','she','too','use','act','age','ago',
  'air','arm','art','ask','bad','big','bit','box','car','cat',
  'cut','dog','ear','eat','eye','far','few','fly','fun','god',
  'got','gun','hit','job','key','kid','law','let','lie','lot',
  'low','map','mix','new','pay','run','sea','set','sit','six',
  'sky','son','sun','ten','top','try','war','win','yet','end',
  'int','pre','pro','con','dis','mis','ful','ous','est','ish',
  'str','spl','spr','thr','shr','chr','whi','who','sch','phy',
];

// Simple English word list for validation (common words)
const WORD_LIST = new Set([
  'the','be','to','of','and','in','that','have','it','for','on','with','he','as','you','do','at',
  'this','but','his','by','from','they','we','say','her','she','or','an','will','my','one','all',
  'would','there','their','what','so','up','out','if','about','who','get','which','go','me','when',
  'make','can','like','time','no','just','him','know','take','people','into','year','your','good',
  'some','could','them','see','other','than','then','now','look','only','come','its','over','think',
  'also','back','after','use','two','how','our','work','first','well','way','even','new','want',
  'because','any','these','give','day','most','between','need','large','often','hand','high','place',
  'hold','turn','around','help','start','never','those','both','always','look','show','hear','play',
  'run','believe','hold','bring','happen','write','provide','sit','stand','lose','pay','meet','include',
  'continue','set','learn','change','lead','understand','watch','follow','stop','create','speak','read',
  'spend','grow','open','walk','win','offer','remember','love','consider','appear','buy','wait','serve',
  'die','send','expect','build','stay','fall','cut','reach','kill','remain','suggest','raise','pass',
  'sell','require','report','decide','pull','action','age','ago','air','arm','art','ask','bad','big',
  'bit','box','car','cat','cup','cut','dog','ear','eat','eye','far','few','fly','fun','god','got',
  'gun','hit','job','key','kid','law','let','lie','lot','low','map','mix','old','pay','put','run',
  'sea','set','sit','six','sky','son','sun','top','try','war','yet','able','area','army','baby',
  'back','ball','band','bank','base','bath','bear','beat','been','bell','best','bird','blow','blue',
  'boat','body','bone','book','born','boss','both','busy','call','came','care','case','cash','cast',
  'cave','cell','chat','chip','city','clap','claw','clay','clip','club','coal','coat','code','coin',
  'cold','cool','copy','core','corn','cost','coup','crew','crop','dark','data','date','dead','deal',
  'dear','debt','deep','desk','diet','dirt','disk','dock','does','door','down','draw','drop','drum',
  'duck','dull','dump','dust','each','edge','else','even','exam','face','fact','fail','fair','fall',
  'fame','farm','fast','fate','feel','feet','felt','file','fill','film','find','fine','fire','fish',
  'five','flag','flat','flew','flow','foam','fold','folk','fond','food','fool','foot','ford','fore',
  'form','fort','foul','four','free','from','fuel','full','fund','fuse','gain','game','gang','gate',
  'gave','gear','gene','gift','girl','give','glad','glow','glue','goal','goes','gold','golf','gone',
  'good','grab','gram','gray','grew','grey','grid','grin','grip','grow','gulf','gust','hall','hand',
  'hang','hard','harm','hate','head','heal','heap','heat','heel','held','hell','help','here','hero',
  'hide','hill','hint','hire','hold','hole','holy','home','hood','hook','hope','horn','host','hour',
  'huge','hull','hung','hunt','hurt','icon','idea','idle','inch','info','into','iron','item','jail',
  'join','joke','jump','just','keep','kind','king','knee','knew','lace','lack','laid','lake','lamb',
  'lamp','land','lane','last','late','lawn','lead','leaf','lean','left','lend','lens','less','lift',
  'like','lime','line','link','list','live','load','loan','lock','loft','logo','long','look','loop',
  'lord','lore','loss','loud','love','luck','lung','made','main','male','mall','many','mark','mass',
  'mate','math','mean','meat','meet','melt','memo','menu','mere','mesh','mile','milk','mill','mind',
  'mine','miss','mode','mood','moon','more','most','move','much','name','navy','near','neck','news',
  'next','nice','nine','node','none','norm','nose','note','oath','obey','odds','open','oral','oven',
  'over','owed','pace','pack','page','paid','pain','pair','pale','palm','park','part','past','path',
  'peak','peel','peer','pick','pier','pile','pill','pine','pink','pipe','plan','plus','poem','poet',
  'poll','pond','pool','poor','port','pose','post','pour','pray','prey','pure','push','quit','race',
  'rack','rage','raid','rail','rain','rake','rank','rare','rate','read','real','rear','reel','rely',
  'rent','rest','rice','rich','ride','ring','rise','risk','road','rock','role','roll','roof','room',
  'root','rope','rose','rude','ruin','rule','rush','rust','safe','sage','sail','sake','salt','same',
  'sand','sane','sang','sank','save','scan','scar','seal','seat','seed','seek','seem','seep','self',
  'send','sent','shed','ship','shoe','shot','show','shut','sick','side','sign','silk','sing','sink',
  'size','skin','slip','slot','slow','slum','snap','snow','soap','sock','soft','soil','sole','song',
  'soon','sore','sort','soul','soup','sour','span','spin','spit','spot','spur','stem','step','stir',
  'stop','stub','such','suit','sure','swap','swim','tail','tale','tall','tank','tape','task','team',
  'tear','tech','tell','tend','tent','term','test','text','than','then','they','thin','this','thus',
  'tide','till','time','tiny','tire','told','toll','tone','took','tool','tour','town','trap','tree',
  'trim','trip','true','tube','tuck','tune','twin','type','ugly','undo','unit','upon','used','user',
  'vary','vast','very','vice','view','vine','void','vote','wage','wake','wall','want','warm','warn',
  'wash','wave','weak','wear','weed','week','well','went','were','west','what','when','whom','wide',
  'wife','wild','will','wind','wine','wing','wire','wise','wish','with','woke','wolf','wood','wool',
  'word','wore','worm','worn','wrap','yard','yeah','year','your','zero','zone',
  // longer words
  'about','above','abuse','actor','acute','admit','adobe','adult','after','again','agent','agree',
  'ahead','alarm','album','alert','alien','align','alive','alley','allow','alone','along','alter',
  'angel','angry','anime','ankle','annex','apart','apple','apply','arena','argue','arise','array',
  'arson','asset','audit','avoid','award','awful','badly','baker','basic','basis','batch','beach',
  'begin','being','below','bench','bible','black','blade','blame','bland','blank','blast','bleed',
  'blend','bless','blind','block','blood','bloom','blown','board','boost','bound','brain','brand',
  'brave','break','breed','brick','bride','brief','bring','broad','broke','brook','brown','brunt',
  'brush','buddy','build','built','bunch','burst','buyer','cabin','camel','candy','carry','cause',
  'cease','chain','chair','chaos','chase','cheap','check','cheek','chess','chest','chief','child',
  'china','choir','chunk','civic','civil','claim','class','clean','clear','clerk','click','cliff',
  'climb','cling','clock','close','cloud','clown','coach','coast','color','comet','comma','count',
  'court','cover','crack','craft','crash','crazy','cream','crime','cross','crowd','crown','cruel',
  'crush','cycle','daily','dance','death','debut','decay','delay','depot','depth','derby','devil',
  'digital','dinner','dirty','disco','dizzy','dodge','doing','donor','doubt','dough','down','draft',
  'drain','drama','dream','dress','drift','drink','drive','drone','drove','dying','eager','eagle',
  'early','earth','eight','elite','email','empty','enemy','enjoy','enter','entry','equal','error',
  'essay','event','every','exact','exist','extra','faint','faith','false','fancy','favor','feast',
  'fence','fever','fiber','field','fifth','fifty','fight','final','fixed','flame','flash','fleet',
  'flesh','float','flood','floor','floor','flock','flute','focus','force','forge','forth','forty',
  'forum','found','frame','frank','fraud','fresh','front','frost','froze','fruit','funny','ghost',
  'giant','given','glass','gloom','glory','glove','going','grace','grade','grain','grand','grant',
  'grasp','grass','grave','great','green','greet','grief','grill','grind','groan','gross','group',
  'guard','guess','guest','guide','guild','guile','guilt','guise','harsh','haven','heart','heavy',
  'hence','herbs','hoard','honor','horse','hotel','house','human','humor','hurry','hyper','ideal',
  'image','imply','inbox','index','indie','infer','inner','input','intel','issue','ivory','jewel',
  'joint','judge','juice','juicy','jumpy','karma','knife','knock','known','label','large','laser',
  'later','laugh','layer','learn','legal','level','light','limit','liver','local','logic','lonely',
  'loose','lover','lower','loyal','lucky','lunar','lyric','magic','major','maker','manor','march',
  'match','mayor','media','mercy','metal','meter','might','minor','minus','model','money','month',
  'moral','mount','mouse','mouth','movie','music','naive','nerve','never','night','ninja','noise',
  'north','novel','nurse','nylon','offer','often','olive','omega','onset','opera','orbit','order',
  'other','ought','outer','owner','oxide','ozone','paint','panel','panic','paper','party','peace',
  'pearl','penny','phase','phone','photo','piano','piece','pilot','pixel','pizza','place','plain',
  'plane','plant','plate','plaza','plead','pluck','plumb','plume','plunge','point','poker','polar',
  'power','press','price','pride','prime','print','prior','prize','probe','proof','prose','proud',
  'prove','prowl','punch','pupil','queen','query','queue','quest','quick','quiet','quota','quote',
  'radio','raise','rally','range','rapid','ratio','reach','ready','realm','rebel','refer','reign',
  'relax','renew','repay','repel','reply','reset','reuse','right','rigid','risky','rival','river',
  'robot','rocky','rouge','rough','round','route','rugby','ruler','rural','saint','salad','sauce',
  'scale','scare','scene','scent','scope','score','scout','sense','serve','setup','seven','shade',
  'shake','shall','shame','shape','share','sharp','sheep','sheer','shelf','shell','shift','shine',
  'shirt','shock','shore','short','shout','sight','since','sixth','sixty','skill','slave','sleep',
  'slide','slope','smart','smell','smile','smoke','snake','solar','solid','solve','sorry','south',
  'space','spare','spark','speak','speed','spend','spice','spike','spine','spite','split','spoke',
  'spoon','sport','spray','squad','stack','staff','stage','stain','stake','stale','stand','stark',
  'start','state','stave','steal','steam','steel','steep','steer','still','stock','stone','store',
  'storm','story','stove','strap','straw','stray','strip','strum','stuck','study','style','sugar',
  'suite','super','surge','swamp','swear','sweep','sweet','swept','swift','swing','sword','swore',
  'table','taken','taste','teach','tempt','tense','theme','there','thick','thing','think','third',
  'those','three','throw','thumb','tiger','tight','timer','tired','title','today','token','topic',
  'total','touch','tough','towel','tower','toxic','trace','track','trade','trail','train','trait',
  'trawl','trend','trial','tribe','trick','tried','troop','truck','truly','trump','trust','truth',
  'tumor','tuned','ultra','uncle','under','unify','union','until','upper','urban','usage','usual',
  'valid','value','valve','video','viral','virus','visit','vital','vivid','vocal','voice','waste',
  'watch','water','weary','weave','wedge','weird','where','which','while','white','whole','whose',
  'wield','witch','woman','women','world','worry','worse','worst','worth','would','wound','wrath',
  'write','wrote','young','youth',
]);

// Active games per channel
const activeGames = new Map();

function getRandomCombo() {
  return COMBOS[Math.floor(Math.random() * COMBOS.length)];
}

function isValidWord(word, combo) {
  const w = word.toLowerCase().trim();
  return w.length >= combo.length + 1 && w.includes(combo) && WORD_LIST.has(w);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacktea')
    .setDescription('🍵 Start a BlackTea word game — type words containing the given letters or lose a life!')
    .addIntegerOption(o => o.setName('lives').setDescription('Starting lives per player (default 3)').setRequired(false).setMinValue(1).setMaxValue(10))
    .addIntegerOption(o => o.setName('seconds').setDescription('Seconds to answer per round (default 12)').setRequired(false).setMinValue(5).setMaxValue(30))
    .addIntegerOption(o => o.setName('wager').setDescription('Entry wager — winner takes all ($)').setRequired(false).setMinValue(100)),

  async execute(interaction) {
    const channelId = interaction.channelId;

    if (activeGames.has(channelId)) {
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription('A BlackTea game is already running in this channel!')
      ], ephemeral:true });
    }

    const maxLives  = interaction.options.getInteger('lives')   || 3;
    const timeLimit = interaction.options.getInteger('seconds') || 12;
    const wager     = interaction.options.getInteger('wager')   || 0;

    // If there's a wager, check the host can afford it
    if (wager > 0) {
      const host = getOrCreateUser(interaction.user.id);
      if (host.wallet < wager) return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.ERROR)
        .setDescription(`You need **$${wager.toLocaleString()}** in your wallet to set this wager.`)
      ], ephemeral:true });
    }

    // ── JOIN PHASE ────────────────────────────────────────────
    const players = new Map(); // userId -> { lives, usedWords }
    players.set(interaction.user.id, { lives: maxLives, usedWords: new Set(), name: interaction.user.username });

    const joinEmbed = () => new EmbedBuilder()
      .setColor(0x2c3e50)
      .setTitle('🍵 BlackTea — Joining Phase')
      .setDescription(`**${interaction.user.username}** started a game!\n\nClick **Join** to enter. Game starts in **30 seconds**.\n\nEach round you'll get a 3-letter combo — type a word containing it within **${timeLimit} seconds** or lose a life.\n\n${wager ? `💵 **Entry wager: $${wager.toLocaleString()}** — winner takes all!\n\n` : ''}❤️ Lives per player: **${maxLives}**`)
      .addFields({ name:'👥 Players', value:[...players.values()].map(p=>`• ${p.name}`).join('\n') || '—' })
      .setFooter({ text:'30 second join window' });

    const joinRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bt_join').setLabel('🍵 Join Game').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('bt_start').setLabel('▶ Start Now').setStyle(ButtonStyle.Success),
    );

    const msg = await interaction.reply({ embeds:[joinEmbed()], components:[joinRow], fetchReply:true });

    // Collect join clicks
    const joinCollector = msg.createMessageComponentCollector({ time: 30_000 });

    joinCollector.on('collect', async btn => {
      if (btn.customId === 'bt_join') {
        if (players.has(btn.user.id)) {
          return btn.reply({ content:'You already joined!', ephemeral:true });
        }
        // Wager check
        if (wager > 0) {
          const p = getOrCreateUser(btn.user.id);
          if (p.wallet < wager) return btn.reply({ content:`You need $${wager.toLocaleString()} to join.`, ephemeral:true });
        }
        players.set(btn.user.id, { lives: maxLives, usedWords: new Set(), name: btn.user.username });
        await btn.update({ embeds:[joinEmbed()], components:[joinRow] });
      }
      if (btn.customId === 'bt_start') {
        if (btn.user.id !== interaction.user.id) return btn.reply({ content:'Only the host can start early.', ephemeral:true });
        joinCollector.stop('early');
      }
    });

    joinCollector.on('end', async () => {
      if (players.size < 2) {
        activeGames.delete(channelId);
        return msg.edit({ embeds:[new EmbedBuilder().setColor(0x888888)
          .setTitle('🍵 Not Enough Players')
          .setDescription('Need at least 2 players to start BlackTea.')
        ], components:[] });
      }

      // Deduct wagers
      if (wager > 0) {
        for (const [uid] of players) {
          const u = getOrCreateUser(uid);
          u.wallet -= wager;
          saveUser(uid, u);
        }
      }

      await runGame(interaction, msg, players, maxLives, timeLimit, wager, channelId);
    });

    activeGames.set(channelId, true);
  },
};

async function runGame(interaction, msg, players, maxLives, timeLimit, wager, channelId) {
  const playerOrder = [...players.keys()];
  let turnIndex     = 0;
  let roundNum      = 0;
  const usedWords   = new Set();

  async function nextTurn() {
    // Filter to alive players
    const alive = playerOrder.filter(id => players.get(id).lives > 0);
    if (alive.length <= 1) return endGame(alive[0]);

    const currentId = alive[turnIndex % alive.length];
    turnIndex++;
    roundNum++;

    const combo   = getRandomCombo();
    const pData   = players.get(currentId);
    const livesStr= '❤️'.repeat(pData.lives) + '🖤'.repeat(maxLives - pData.lives);

    // Build alive scoreboard
    const board = alive.map(id => {
      const p = players.get(id);
      return `${id===currentId?'**→**':''} <@${id}> ${'❤️'.repeat(p.lives)}${'🖤'.repeat(maxLives-p.lives)}`;
    }).join('\n');

    await msg.edit({ embeds:[new EmbedBuilder()
      .setColor(0x00d2ff)
      .setTitle(`🍵 BlackTea — Round ${roundNum}`)
      .setDescription(`<@${currentId}>'s turn!\n\n## \`${combo.toUpperCase()}\`\n\nType a word containing **${combo}** within **${timeLimit} seconds**!\n\n${board}`)
      .setFooter({ text:`Used words are banned. Word must be in the dictionary.` })
    ], components:[] });

    const filter = m => m.author.id === currentId && m.channelId === channelId;
    let collected;
    try {
      collected = await interaction.channel.awaitMessages({ filter, max:1, time:timeLimit*1000, errors:['time'] });
    } catch {
      // Timed out — lose a life
      pData.lives--;
      const alive2 = playerOrder.filter(id => players.get(id).lives > 0);
      if (alive2.length <= 1) return endGame(alive2[0]);

      await interaction.channel.send({ embeds:[new EmbedBuilder()
        .setColor(0xff3b3b)
        .setDescription(`⏰ <@${currentId}> ran out of time! Lost a life. ${pData.lives > 0 ? `${pData.lives} left.` : '**ELIMINATED!**'}`)
      ]});
      return nextTurn();
    }

    const answer = collected.first().content.trim().toLowerCase();
    collected.first().react('🤔').catch(()=>{});

    // Validate
    if (!isValidWord(answer, combo)) {
      pData.lives--;
      const alive2 = playerOrder.filter(id => players.get(id).lives > 0);
      if (alive2.length <= 1) return endGame(alive2[0]);

      const reason = !answer.includes(combo) ? `doesn't contain **${combo}**` : usedWords.has(answer) ? 'already used!' : 'not a valid word';
      collected.first().react('❌').catch(()=>{});
      await interaction.channel.send({ embeds:[new EmbedBuilder()
        .setColor(0xff3b3b)
        .setDescription(`❌ **${answer}** — ${reason}! <@${currentId}> loses a life. ${pData.lives > 0 ? `${pData.lives} left.` : '**ELIMINATED!**'}`)
      ]});
    } else {
      usedWords.add(answer);
      collected.first().react('✅').catch(()=>{});
    }

    setTimeout(nextTurn, 1500);
  }

  async function endGame(winnerId) {
    activeGames.delete(channelId);

    const winner = winnerId ? players.get(winnerId) : null;
    const pot    = wager * players.size;

    if (wager > 0 && winnerId) {
      const u = getOrCreateUser(winnerId);
      u.wallet += pot;
      saveUser(winnerId, u);
    }

    const board = [...players.entries()].map(([id, p]) =>
      `${id===winnerId?'🏆':p.lives>0?'✅':'💀'} <@${id}> — ${p.lives > 0 ? `${p.lives} lives left` : 'eliminated'}`
    ).join('\n');

    await msg.edit({ embeds:[new EmbedBuilder()
      .setColor(winnerId ? 0xf5c518 : 0x888888)
      .setTitle(winnerId ? `🍵 BlackTea — ${winner.name} Wins!` : '🍵 BlackTea — Game Over')
      .setDescription(winnerId ? `👑 <@${winnerId}> is the last one standing!${wager ? `\n\n💵 **Won: $${pot.toLocaleString()}**` : ''}` : "Everyone was eliminated. It's a draw.")
      .addFields({ name:'Final Standings', value:board })
    ], components:[] });
  }

  await nextTurn();
}
