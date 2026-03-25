// utils/newsFeed.js — Daily news feed generator
// Pulls real server data and generates news article embeds every 24hrs
const { EmbedBuilder } = require('discord.js');

const NEWS_COLOR = 0x1a1a2e;
const PAPER_NAME = '📰 First Class Post';

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmtMoney(n) {
  const a = Math.abs(n);
  if (a >= 1e9)  return '$' + (a/1e9).toFixed(2) + 'B';
  if (a >= 1e6)  return '$' + (a/1e6).toFixed(2) + 'M';
  if (a >= 1e3)  return '$' + Math.round(a).toLocaleString();
  return '$' + Math.round(a);
}

const HEADLINES = {
  richest: [
    (name, amt) => `💰 **${name}** Tops Wealth Charts at ${amt} — Sources say the money never sleeps.`,
    (name, amt) => `🏆 **${name}** Named Server's Wealthiest With ${amt} In Holdings.`,
    (name, amt) => `📈 **${name}** Quietly Stacks ${amt} While Everyone Else Grinds.`,
  ],
  robbery: [
    (robber, victim, amt) => `🔫 BREAKING: **${robber}** Robbed **${victim}** For ${amt} In Broad Daylight.`,
    (robber, victim, amt) => `💸 **${robber}** Hits **${victim}** — ${amt} Vanishes From Wallet.`,
    (robber, victim, amt) => `🚨 Sources Confirm **${robber}** Jacked **${victim}** For ${amt}.`,
  ],
  arrest: [
    (name, mins) => `🚔 **${name}** Arrested And Booked — ${mins} Minutes In The System.`,
    (name) => `⚠️ LOCAL CRIMINAL **${name}** Caught With Too Much Heat On The Streets.`,
    (name) => `🔒 **${name}** Taken In By Authorities After Series Of Crimes.`,
  ],
  artist: [
    (name, tier, fans) => `🎵 **${name}** Reaches ${tier} Status With ${fans} Fans — Industry On Notice.`,
    (name, fans) => `🏆 **${name}** Hits ${fans} Fans — Officially Untouchable In The Streets.`,
    (name, tier) => `🎤 **${name}** Levels Up To **${tier}** — Label Deals On The Table.`,
  ],
  gangwar: [
    (g1, g2, winner) => `⚔️ GANG WAR: **${g1}** vs **${g2}** — **${winner}** Claims Victory.`,
    (g1, g2) => `🔫 Streets Run Hot As **${g1}** And **${g2}** Clash For Territory.`,
    (g1, g2, winner) => `💀 **${g1}** vs **${g2}** War Ends — **${winner}** Stands Alone.`,
  ],
  coin: [
    (name, pct, dir) => `📈 **${name}** ${dir === 'up' ? 'SURGES' : 'CRASHES'} ${pct}% — Investors ${dir === 'up' ? 'Celebrate' : 'Panic'}.`,
    (name, price) => `💎 **${name}** Hits ${price} — Analysts Divided On What Comes Next.`,
    (name, pct) => `🚀 **${name}** UP ${pct}% — Who's Been Buying?`,
  ],
  creator: [
    (name, followers) => `📱 **${name}** Goes Viral With ${followers} Followers — Brand Deals Incoming.`,
    (name, tier) => `⭐ **${name}** Achieves **${tier}** Status — The Algorithm Loves Them.`,
    (name) => `🔥 **${name}** Is The Most Talked About Name Online Right Now.`,
  ],
  illuminati: [
    () => `🔺 ANONYMOUS TIP: Shadow Organization Operating In Server — Officials Deny Everything.`,
    () => `👁️ CONSPIRACY: Multiple Users Report Unusual Coordinated Activity — Coincidence?`,
    () => `🕵️ EXPOSED? Sources Claim Secret Society Has Been Running Server For Months.`,
  ],
  heist: [
    (gang, type, amt) => `🎰 BREAKING: **${gang}** Crew Pulls Off ${type} — ${amt} Reportedly Taken.`,
    (gang, type) => `🚨 SECURITY BREACH: **${gang}** Hits ${type} — No Arrests Yet.`,
    (gang, amt) => `💸 **${gang}** Makes Off With ${amt} — Witnesses Too Scared To Talk.`,
  ],
};

async function generateNewsFeed(client, guildId, config) {
  try {
    const db       = require('./db');
    const allUsers = db.getAllUsers();
    const users    = Object.entries(allUsers).filter(([,u]) => u.wallet !== undefined);

    const stories = [];

    // ── Story 1: Richest user ──────────────────────────────
    const richest = users.sort(([,a],[,b]) => ((b.wallet||0)+(b.bank||0)) - ((a.wallet||0)+(a.bank||0)))[0];
    if (richest) {
      try {
        const u = await client.users.fetch(richest[0]).catch(()=>null);
        if (u) {
          const wealth = (richest[1].wallet||0) + (richest[1].bank||0);
          const fn = pickRandom(HEADLINES.richest);
          stories.push({ headline: fn(u.username, fmtMoney(wealth)), category:'FINANCE' });
        }
      } catch {}
    }

    // ── Story 2: Most famous creator ──────────────────────
    try {
      const { getAllPhones, getStatusTier } = require('./phoneDb');
      const phones = getAllPhones ? getAllPhones() : {};
      const phoneArr = Object.entries(phones).filter(([,p]) => p.followers > 1000);
      if (phoneArr.length) {
        const topCreator = phoneArr.sort(([,a],[,b]) => (b.followers||0)-(a.followers||0))[0];
        const cu = await client.users.fetch(topCreator[0]).catch(()=>null);
        if (cu) {
          const tier = getStatusTier(topCreator[1].status||0);
          const fn = pickRandom(HEADLINES.creator);
          const followers = topCreator[1].followers||0;
          const fmtF = followers >= 1e6 ? (followers/1e6).toFixed(1)+'M' : followers >= 1000 ? (followers/1000).toFixed(0)+'K' : followers;
          stories.push({ headline: fn(cu.username, fmtF, tier.label), category:'ENTERTAINMENT' });
        }
      }
    } catch {}

    // ── Story 3: Top artist ────────────────────────────────
    try {
      const { getAllPhones, getArtistTier } = require('./phoneDb');
      const phones = getAllPhones ? getAllPhones() : {};
      const artists = Object.entries(phones).filter(([,p]) => (p.artistCareer?.fame||0) > 500);
      if (artists.length) {
        const topArtist = artists.sort(([,a],[,b]) => (b.artistCareer?.fame||0)-(a.artistCareer?.fame||0))[0];
        const au = await client.users.fetch(topArtist[0]).catch(()=>null);
        if (au) {
          const tier = getArtistTier(topArtist[1].artistCareer?.fame||0);
          const followers = topArtist[1].followers||0;
          const fmtF = followers >= 1e6 ? (followers/1e6).toFixed(1)+'M' : followers >= 1000 ? (followers/1000).toFixed(0)+'K' : followers;
          const fn = pickRandom(HEADLINES.artist);
          stories.push({ headline: fn(au.username, tier.label, fmtF), category:'MUSIC' });
        }
      }
    } catch {}

    // ── Story 4: Hottest coin ──────────────────────────────
    try {
      const { getAllCoins } = require('./coinDb');
      const coins = getAllCoins ? Object.values(getAllCoins()).filter(c => c.price > 0) : [];
      if (coins.length) {
        const topCoin = coins.sort((a,b) => (b.hype||0)-(a.hype||0))[0];
        const pct = Math.floor(Math.random() * 40 + 5);
        const dir = Math.random() > 0.4 ? 'up' : 'down';
        const fn = pickRandom(HEADLINES.coin);
        stories.push({ headline: fn(topCoin.name || topCoin.ticker, pct, dir), category:'MARKETS' });
      }
    } catch {}

    // ── Story 5: Gang activity ─────────────────────────────
    try {
      const { getAllGangs } = require('./gangDb');
      const gangs = Object.values(getAllGangs ? getAllGangs() : {}).filter(g => (g.members||[]).length > 1);
      if (gangs.length >= 2) {
        const [g1, g2] = gangs.sort(()=>Math.random()-0.5).slice(0,2);
        const winner = Math.random() > 0.5 ? g1.name : g2.name;
        const fn = pickRandom(HEADLINES.gangwar);
        stories.push({ headline: fn(g1.name, g2.name, winner), category:'CRIME' });
      } else if (gangs.length === 1) {
        stories.push({ headline: `🏴 **${gangs[0].name}** Tightens Grip On Server Streets — No One Is Challenging Them.`, category:'CRIME' });
      }
    } catch {}

    // ── Story 6: Illuminati hint (random chance) ───────────
    try {
      const { getIlluminati } = require('./illuminatiDb');
      const org = getIlluminati(guildId);
      if (org && !org.exposed && Math.random() < 0.3) {
        const fn = pickRandom(HEADLINES.illuminati);
        stories.push({ headline: fn(), category:'MYSTERY' });
      } else if (org?.exposed) {
        stories.push({ headline: `🔺 AFTERMATH: Illuminati Exposure Rocks Server — Members Scramble For Answers.`, category:'BREAKING' });
      }
    } catch {}

    // ── Story 7: Random crime blotter ─────────────────────
    const crimeBlotters = [
      '🚨 Multiple residents report unusual activity near the vault district.',
      '💊 Drug market prices spike amid supply chain disruptions.',
      '🔫 Three separate shooting incidents reported overnight — no arrests.',
      '🏠 Home break-ins up 40% this week — police advise upgrading security.',
      '💸 Wire fraud scheme exposed — thousands in fake transactions detected.',
      '🚔 Police department announces crackdown on high-heat criminals.',
    ];
    stories.push({ headline: pickRandom(crimeBlotters), category:'BLOTTER' });

    if (!stories.length) return;

    // Build the news embed
    const date = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

    const embed = new EmbedBuilder()
      .setColor(NEWS_COLOR)
      .setTitle(`${PAPER_NAME}  ·  ${date}`)
      .setDescription('*Your daily briefing on everything happening in the server.*\n\u200b')
      .setFooter({ text:'First Class Post · Published every 24 hours · All stories based on server activity' })
      .setTimestamp();

    for (const s of stories.slice(0, 7)) {
      embed.addFields({ name:`[${s.category}]`, value:s.headline, inline:false });
    }

    return embed;
  } catch(e) {
    console.error('newsFeed error:', e.message);
    return null;
  }
}

module.exports = { generateNewsFeed };
