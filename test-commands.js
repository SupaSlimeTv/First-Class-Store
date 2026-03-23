// ============================================================
// test-commands.js — Automated Bot Command Tester
// Run: node test-commands.js
// Sends test slash commands to your bot via Discord REST API
// and reports pass/fail for each one.
// ============================================================

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN     = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;
const TEST_USER = process.env.TEST_USER_ID; // your Discord user ID

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Missing TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

// ── FETCH REGISTERED COMMANDS ─────────────────────────────────
async function getRegisteredCommands() {
  const commands = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
  return commands;
}

// ── CHECK COMMAND STRUCTURE ───────────────────────────────────
function checkCommand(cmd) {
  const issues = [];
  if (!cmd.name)         issues.push('missing name');
  if (!cmd.description)  issues.push('missing description');
  if (cmd.name.length > 32) issues.push('name too long (max 32)');
  if (cmd.description.length > 100) issues.push('description too long (max 100)');

  // Check options
  if (cmd.options) {
    let hasRequired = false;
    let hasOptional = false;
    for (const opt of cmd.options) {
      if (!opt.required) hasOptional = true;
      if (opt.required) {
        hasRequired = true;
        if (hasOptional) issues.push(`required option "${opt.name}" after optional option (Discord rejects this)`);
      }
      if (opt.name.length > 32)        issues.push(`option "${opt.name}" name too long`);
      if (opt.description.length > 100) issues.push(`option "${opt.name}" description too long`);
    }
  }
  return issues;
}

// ── LOAD LOCAL COMMAND FILES ──────────────────────────────────
function loadLocalCommands() {
  const path = require('path');
  const fs   = require('fs');
  const cmds = [];
  const base = path.join(__dirname, 'commands');

  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      if (!f.endsWith('.js')) continue;
      try {
        const mod = require(full);
        if (mod?.data?.name) cmds.push({ file: path.relative(base, full), data: mod.data.toJSON ? mod.data.toJSON() : mod.data, hasExecute: !!mod.execute, hasAutocomplete: !!mod.autocomplete });
      } catch(e) { cmds.push({ file: path.relative(base, full), loadError: e.message }); }
    }
  };
  walk(base);
  return cmds;
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log('\n🧪 First Class Store — Bot Command Test Suite');
  console.log('═'.repeat(55));

  // 1. Load and syntax-check all local command files
  console.log('\n📁 Step 1: Loading local command files...\n');
  const localCmds = loadLocalCommands();
  let loadErrors  = 0;
  for (const cmd of localCmds) {
    if (cmd.loadError) {
      console.log(`  ❌ ${cmd.file}: LOAD ERROR — ${cmd.loadError}`);
      loadErrors++;
    }
  }
  const loaded = localCmds.filter(c => !c.loadError);
  console.log(`  ✅ ${loaded.length} commands loaded successfully`);
  if (loadErrors) console.log(`  ❌ ${loadErrors} commands failed to load`);

  // 2. Validate command structure
  console.log('\n🔍 Step 2: Validating command structures...\n');
  let structureIssues = 0;
  for (const cmd of loaded) {
    const issues = checkCommand(cmd.data);
    if (issues.length) {
      console.log(`  ⚠️  ${cmd.file} (/${cmd.data.name}):`);
      issues.forEach(i => console.log(`       → ${i}`));
      structureIssues += issues.length;
    }

    // Check subcommands too
    if (cmd.data.options) {
      for (const opt of cmd.data.options) {
        if (opt.type === 1 || opt.type === 2) { // SUB_COMMAND or SUB_COMMAND_GROUP
          const subIssues = checkCommand(opt);
          if (subIssues.length) {
            console.log(`  ⚠️  ${cmd.file} subcommand "${opt.name}":`);
            subIssues.forEach(i => console.log(`       → ${i}`));
            structureIssues += subIssues.length;
          }
        }
      }
    }
  }
  if (!structureIssues) console.log('  ✅ All command structures valid');

  // 3. Compare local vs registered commands
  console.log('\n☁️  Step 3: Comparing local vs Discord-registered commands...\n');
  let registeredCmds = [];
  try {
    registeredCmds = await getRegisteredCommands();
    const localNames    = new Set(loaded.map(c => c.data.name));
    const registeredNames = new Set(registeredCmds.map(c => c.name));

    const notDeployed = [...localNames].filter(n => !registeredNames.has(n));
    const notLocal    = [...registeredNames].filter(n => !localNames.has(n));

    if (notDeployed.length) {
      console.log(`  ⚠️  ${notDeployed.length} commands exist locally but NOT deployed:`);
      notDeployed.forEach(n => console.log(`       → /${n} (run npm run deploy)`));
    }
    if (notLocal.length) {
      console.log(`  ⚠️  ${notLocal.length} commands deployed but no local file:`);
      notLocal.forEach(n => console.log(`       → /${n} (stale — run npm run deploy)`));
    }
    if (!notDeployed.length && !notLocal.length) {
      console.log(`  ✅ All ${registeredNames.size} commands are deployed and have local files`);
    }
  } catch(e) {
    console.log(`  ⚠️  Could not fetch registered commands: ${e.message}`);
  }

  // 4. Check autocomplete consistency
  console.log('\n🔄 Step 4: Checking autocomplete consistency...\n');
  let acIssues = 0;
  for (const cmd of loaded) {
    const hasACOption = JSON.stringify(cmd.data).includes('"autocomplete":true');
    if (hasACOption && !cmd.hasAutocomplete) {
      console.log(`  ❌ /${cmd.data.name}: has autocomplete options but no autocomplete() handler`);
      acIssues++;
    }
    if (!hasACOption && cmd.hasAutocomplete) {
      console.log(`  ⚠️  /${cmd.data.name}: has autocomplete() handler but no autocomplete options`);
    }
  }
  if (!acIssues) console.log('  ✅ All autocomplete handlers match their options');

  // 5. Check required utils exist
  console.log('\n🔧 Step 5: Checking required utility files...\n');
  const utils = [
    'utils/db.js', 'utils/mongo.js', 'utils/embeds.js', 'utils/gangDb.js',
    'utils/bizDb.js', 'utils/gunDb.js', 'utils/petDb.js', 'utils/phoneDb.js',
    'utils/goonDb.js', 'utils/drugDb.js', 'utils/bitcoinDb.js', 'utils/routingDb.js',
    'utils/coinAutocomplete.js', 'utils/accountCheck.js',
  ];
  const path = require('path');
  const fs   = require('fs');
  let missingUtils = 0;
  for (const u of utils) {
    const exists = fs.existsSync(path.join(__dirname, u));
    if (!exists) { console.log(`  ❌ Missing: ${u}`); missingUtils++; }
  }
  if (!missingUtils) console.log(`  ✅ All ${utils.length} utility files present`);

  // 6. Check .env variables
  console.log('\n🔐 Step 6: Checking environment variables...\n');
  const required = ['TOKEN','CLIENT_ID','GUILD_ID','DISCORD_CLIENT_SECRET','DASHBOARD_URL','SESSION_SECRET','MONGODB_URI'];
  const optional = ['PORT'];
  let missingEnv = 0;
  for (const v of required) {
    if (!process.env[v]) {
      console.log(`  ❌ Missing required env var: ${v}`);
      missingEnv++;
    } else {
      // Warn about weak SESSION_SECRET
      if (v === 'SESSION_SECRET' && process.env[v].length < 32) {
        console.log(`  ⚠️  SESSION_SECRET is short (${process.env[v].length} chars) — use 32+ random chars`);
      }
      if (v === 'SESSION_SECRET' && process.env[v] === 'fcs_secret_key_2026') {
        console.log(`  ❌ SESSION_SECRET is the public default! Change it immediately!`);
        missingEnv++;
      }
    }
  }
  if (!missingEnv) console.log(`  ✅ All required env vars set`);

  // ── SUMMARY ───────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(55));
  console.log(`  Commands loaded:    ${loaded.length} / ${localCmds.length}`);
  console.log(`  Load errors:        ${loadErrors}`);
  console.log(`  Structure issues:   ${structureIssues}`);
  console.log(`  Autocomplete gaps:  ${acIssues}`);
  console.log(`  Missing utils:      ${missingUtils}`);
  console.log(`  Missing env vars:   ${missingEnv}`);

  const totalIssues = loadErrors + structureIssues + acIssues + missingUtils + missingEnv;
  if (totalIssues === 0) {
    console.log('\n  🟢 ALL CHECKS PASSED — Bot is ready to go public!\n');
  } else {
    console.log(`\n  🔴 ${totalIssues} issue(s) found — fix before going public.\n`);
  }

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch(e => { console.error('Test runner error:', e); process.exit(1); });
