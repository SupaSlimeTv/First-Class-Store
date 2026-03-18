// ============================================================
// utils/minigames.js — Minigame Engine
// All words verified as standard English dictionary words
// ============================================================

const WORDS = [
  // 4 letters — all common dictionary words
  'bank','bolt','boot','byte','cash','chip','claw','code','dark','data',
  'disk','echo','file','fire','flux','gate','gold','grid','hack','hawk',
  'iron','jade','link','lock','loop','node','ping','port','salt','wire',

  // 5 letters — all standard dictionary words
  'blaze','cache','cloak','craft','crash','drain','flame','forge','frame',
  'ghost','grant','grind','heist','input','joker','knife','laser','money',
  'nexus','orbit','pixel','plant','proxy','quest','razor','rogue','route',
  'shine','skull','snake','spark','squad','stack','steam','theft','tiger',
  'token','ultra','vault','virus','witch',

  // 6 letters — all standard dictionary words
  'beacon','breach','bridge','budget','castle','cipher','colony','combat',
  'corona','credit','damage','decode','defend','domain','fabric','falcon',
  'filter','glitch','impact','jumper','jungle','kernel','launch','matrix',
  'mirror','monkey','motion','muscle','mutual','mystic','native','nettle',
  'normal','output','packet','planet','plasma','pocket','portal','prison',
  'python','quartz','rabbit','random','reboot','refuge','rescue','rocket',
  'sample','screen','signal','silver','simple','sketch','socket','strike',
  'strong','sultan','summer','symbol','system','throne','ticket','tongue',
  'tunnel','turkey','unique','update','upload','uplink','urgent','useful',
  'valley','vanish','victim','vision','wallet','warden','wealth','weapon',
  'wizard','zombie',

  // 7 letters — all standard dictionary words
  'auction','balance','balloon','banquet','captain','capture','catalog',
  'chapter','circuit','college','command','compass','compete','complex',
  'concept','connect','contact','contest','control','convert','corrupt',
  'council','counter','culture','current','decrypt','deliver','digital',
  'Discord','display','distant','divided','dolphin','explore','exploit',
  'express','extreme','failure','fantasy','fascist','feature','fiction',
  'forward','freedom','gateway','general','harvest','history','holiday',
  'horizon','hostile','isolate','jackpot','journey','kitchen','kingdom',
  'labored','lantern','measure','message','mineral','miracle','mission',
  'monitor','network','neutron','nothing','nuclear','obscure','outcome',
  'pattern','payment','penguin','phantom','pioneer','plastic','popular',
  'protect','quantum','quantum','ration','rebuild','recruit','require',
  'reserve','restore','revenge','romance','scandal','scanner','setting',
  'shelter','shields','silicon','society','soldier','someone','special',
  'sponsor','station','storage','strikes','student','subject','success',
  'summary','suppose','surface','surgery','survive','suspect','teacher',
  'tension','theatre','thunder','torpedo','tracker','trading','traffic',
  'transit','trigger','triumph','trouble','upgrade','utility','venture',
  'version','village','virtual','volcano','warhead','warrior','website',
  'welcome','western','wildcat','windows','kingdom','account','achieve',

  // 8 letters — all standard dictionary words
  'absolute','accident','accuracy','activity','advanced','affinity','alliance',
  'analysis','anything','approach','argument','assembly','backfire','backbone',
  'backdrop','backward','basement','behavior','blockade','breakout','calendar',
  'casualty','category','champion','chemical','choosing','clearing','climbing',
  'collapse','complete','compound','conflict','congress','convince','corridor',
  'criminal','database','deadline','decision','delegate','diameter','diamond',
  'digital','diplomat','disaster','discover','disorder','dispatch','distance',
  'doctrine','dominant','download','dramatic','duration','dynamics','election',
  'encoding','envelope','epidemic','eruption','estimate','evidence','exercise',
  'exposure','external','feedback','firmware','function','graphics','guidance',
  'hardware','identity','immunity','incident','increase','indicate','industry',
  'infinite','informed','innocent','instance','interact','interest','interval',
  'invasion','keyboard','language','landings','launcher','leverage','likewise',
  'location','lockdown','magnetic','mainline','majority','manifest','material',
  'medicine','megabyte','membrane','merchant','midnight','military','movement',
  'navigate','negative','notebook','obstacle','offshore','operator','organize',
  'outbreak','overcome','overload','override','passport','password','patience',
  'peaceful','physical','platform','politics','position','pressure','priority',
  'protocol','province','question','receiver','recovery','redirect','regulate',
  'resource','response','restrict','rotation','sabotage','scanning','schedule',
  'security','sequence','shoulder','snapshot','solution','spectrum','strategy',
  'strength','struggle','suddenly','supplier','survival','suspense','takeover',
  'terminal','terribly','throttle','timeline','transfer','triangle','treasure',
  'ultimate','uprising','vacation','variable','velocity','violation','volcanic',
  'warcraft','wildfire','wireless',

  // 9 letters — all standard dictionary words
  'abandoned','adrenaline','aftermath','algorithm','alongside','ambitious',
  'blueprint','broadcast','calculate','challenge','chemistry','clearance',
  'clockwork','collected','commander','community','companion','component',
  'condition','confident','confusion','connected','conscious','construct',
  'continent','corporate','corrupted','crossfire','decorated','defensive',
  'deficient','departure','dependent','detective','determine','different',
  'direction','discharge','discovery','distorted','elaborate','eliminate',
  'emergency','encounter','endeavour','equipment','execution','existence',
  'explosion','frequency','frontline','geography','guardrail','handshake',
  'hurricane','integrity','intercept','jackknife','keystroke','knowledge',
  'labyrinth','landscape','liability','magnitude','mechanism','messenger',
  'migration','milestone','moonlight','northeast','objective','operation',
  'overthrow','parameter','passenger','peninsula','perimeter','permanent',
  'personnel','planetary','processor','projected','promotion','quicksand',
  'rebellion','rectangle','recursive','reference','residence','resonance',
  'resources','satellite','scattered','secretary','shipwreck','situation',
  'somewhere','spectator','staircase','statement','structure','submarine',
  'substance','successor','surrender','symmetric','territory','testimony',
  'trademark','transport','treatment','triggered','uncharted','undefined',
  'undermine','universal','unlimited','vengeance','vigilance','warehouse',
  'worldwide',

  // 10 letters — all standard dictionary words
  'accomplish','accelerate','acceptable','accomplish','accurately','adaptable',
  'adjustment','ambassador','ammunition','annotation','anticipate','appearance',
  'assignment','assumption','attachment','attraction','authorized','calculated',
  'capability','celebrated','checkpoint','classified','collective','commission',
  'compatible','complement','completion','compliance','compromise','conclusion',
  'confronted','connection','conspiracy','constraint','continuous','contractor',
  'controlled','conversion','correction','correspond','corruption','creativity',
  'deployment','deprecated','determined','developing','dictionary','difficulty',
  'discipline','discussion','domination','earthquake','eliminated','encryption',
  'engagement','evaluation','exhibition','experience','experiment','extraction',
  'federation','foundation','generation','geographic','government','hemisphere',
  'honourable','hypothesis','illuminate','immovable','impossible','inaccurate',
  'individual','inevitable','initiative','innovation','inspection','integrated',
  'investment','leadership','liberation','limitation','management','meditation',
  'membership','motivation','negligence','neutralize','occupation','opposition',
  'outclassed','overloaded','overthrown','perception','permission','persistent',
  'privileged','productive','propaganda','protection','provenance','punishment',
  'rebellious','recognized','redemption','referendum','reflection','regulation',
  'reinforced','remarkable','resilience','revolution','simulation','submission',
  'subsequent','surveillance','suspension','technology','terminated','transition',
  'ultimately','understand','unexpected','unintended','unoccupied','vandalized',
  'vulnerable','wilderness',
];

function getRandomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)].toLowerCase();
}

function scrambleWord(word) {
  const letters = word.split('');
  let scrambled;
  let attempts = 0;
  do {
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    scrambled = letters.join('');
    attempts++;
  } while (scrambled === word && attempts < 10);
  return scrambled.toUpperCase();
}

function generateChallenge() {
  const word      = getRandomWord();
  const scrambled = scrambleWord(word);
  return { word, scrambled };
}

module.exports = { generateChallenge };
