// ============================================================
// utils/npcEmployees.js — NPC Employee System
// NPCs have stats that affect business performance
// ============================================================

const NPC_POOL = [
  // name, role, salary, stats (service, management, hustle), personality
  { id:'npc_maria',    name:'Maria',    role:'Manager',    salary:150, service:85, management:90, hustle:70, trait:'Organized',   emoji:'👩‍💼', bio:'Former corporate exec. Runs a tight ship.' },
  { id:'npc_dre',      name:'Dre',      role:'Cashier',    salary:80,  service:92, management:40, hustle:75, trait:'Charming',    emoji:'😎', bio:'Customers love him. Numbers? Not so much.' },
  { id:'npc_chen',     name:'Chen',     role:'Accountant', salary:120, service:50, management:85, hustle:60, trait:'Meticulous',  emoji:'🧮', bio:'Hasn\'t made a math error in 11 years.' },
  { id:'npc_keisha',   name:'Keisha',   role:'Marketing',  salary:110, service:78, management:65, hustle:95, trait:'Hustler',     emoji:'📣', bio:'Gets the word out. Very loud about it.' },
  { id:'npc_tony',     name:'Tony',     role:'Security',   salary:100, service:60, management:55, hustle:80, trait:'Intimidating',emoji:'💪', bio:'Nobody causes trouble twice.' },
  { id:'npc_rosa',     name:'Rosa',     role:'Supervisor', salary:130, service:80, management:88, hustle:72, trait:'Dependable',  emoji:'⭐', bio:'Always on time. Always gets it done.' },
  { id:'npc_jay',      name:'Jay',      role:'Driver',     salary:90,  service:70, management:45, hustle:85, trait:'Fast',        emoji:'🚗', bio:'Fastest delivery in the server. Period.' },
  { id:'npc_nina',     name:'Nina',     role:'Chef',       salary:115, service:88, management:60, hustle:78, trait:'Creative',    emoji:'👩‍🍳', bio:'Her specials bring people back every week.' },
  { id:'npc_marcus',   name:'Marcus',   role:'Tech',       salary:125, service:55, management:70, hustle:65, trait:'Brilliant',   emoji:'💻', bio:'Fixes problems before you know they exist.' },
  { id:'npc_lisa',     name:'Lisa',     role:'Trainer',    salary:105, service:82, management:78, hustle:68, trait:'Patient',     emoji:'📚', bio:'Turns new hires into top performers.' },
  { id:'npc_big_mike', name:'Big Mike', role:'Bouncer',    salary:95,  service:45, management:50, hustle:88, trait:'Fearless',   emoji:'🦁', bio:'450 lbs of pure deterrent.' },
  { id:'npc_ava',      name:'Ava',      role:'Designer',   salary:118, service:75, management:60, hustle:82, trait:'Visionary',  emoji:'🎨', bio:'Makes everything look like a million bucks.' },
];

function getAvailableNPCs(currentNPCs = []) {
  const hired = currentNPCs.map(e => e.npcId);
  return NPC_POOL.filter(n => !hired.includes(n.id));
}

function getNPC(npcId) {
  return NPC_POOL.find(n => n.id === npcId) || null;
}

// Calculate NPC performance score for customer algorithm
function calcNPCScore(npc) {
  return Math.round((npc.service * 0.4) + (npc.management * 0.35) + (npc.hustle * 0.25));
}

// Calculate total business appeal score (used by customer algorithm)
function calcBusinessAppeal(biz) {
  let score = 50; // base
  score += biz.level * 8;

  const npcEmployees = (biz.employees || []).filter(e => e.isNPC);
  for (const emp of npcEmployees) {
    const npc = getNPC(emp.npcId);
    if (npc) score += calcNPCScore(npc) * 0.3;
  }

  const humanEmployees = (biz.employees || []).filter(e => !e.isNPC);
  score += humanEmployees.length * 5;

  // Reputation modifier
  score += (biz.reputation || 0) * 0.5;

  return Math.min(200, Math.max(0, score));
}

module.exports = { NPC_POOL, getAvailableNPCs, getNPC, calcNPCScore, calcBusinessAppeal };
