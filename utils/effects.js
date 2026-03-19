// ============================================================
// utils/effects.js — Item Effect Engine
//
// This is the heart of the item system. When a player uses
// an item, this engine reads the item's `effect` config and
// executes the right logic.
//
// Effect types:
//   drain_wallet   — steal % or flat $ from target's wallet
//   drain_all      — steal from wallet + bank combined
//   silence        — lock target out of bot for X minutes
//   gamble         — random outcome from a configured outcome table
//   passive_income — register ongoing $ ticks on the USER (not target)
//   shield         — register protection on user against drain effects
//
// Each effect config lives on the item in store.json:
//   item.effect = {
//     type: 'drain_wallet',
//     // ... type-specific fields
//   }
//
// TEACHES: Strategy pattern, switch/case, stacking multipliers,
//          timed effect storage, shield blocking logic
// ============================================================

const db = require('./db');

// ============================================================
// ACTIVE EFFECTS — stored in data/activeEffects.json
// Tracks passive incomes, shields, drain-over-time, etc.
//
// Structure:
// {
//   "userId": {
//     passiveIncome: [{ itemId, amountPerTick, intervalMs, lastTick, stackCount }],
//     shield:        { blocksLeft, expiresAt } | null,
//     drainStack:    number   // multiplier from stacked drain hits
//   }
// }
// ============================================================

const fs   = require('fs');
const path = require('path');
const EFFECTS_FILE = path.join(__dirname, '../data/activeEffects.json');

function readEffects() {
  try {
    if (!fs.existsSync(EFFECTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(EFFECTS_FILE, 'utf8'));
  } catch { return {}; }
}

function writeEffects(data) {
  fs.writeFileSync(EFFECTS_FILE, JSON.stringify(data, null, 2));
}

function getUserEffects(userId) {
  const all = readEffects();
  return all[userId] || { passiveIncome: [], shield: null, drainStack: 1 };
}

function saveUserEffects(userId, effects) {
  const all = readEffects();
  all[userId] = effects;
  writeEffects(all);
}

// ============================================================
// EXECUTE EFFECT
// Called by /use command. Returns a result object describing
// what happened so the command can build a nice embed.
//
// @param {object} item        — the full item object from store
// @param {string} userId      — the person using the item
// @param {string|null} targetId — the target (null for self-use items)
// @param {GuildMember|null} targetMember — Discord GuildMember for role checks
// @returns {object} result    — { success, title, description, fields[] }
// ============================================================
async function executeEffect(item, userId, targetId, targetMember = null) {
  const effect = item.effect;
  if (!effect || !effect.type) {
    return { success: false, title: 'No Effect', description: 'This item has no effect configured.' };
  }

  switch (effect.type) {

    // ----------------------------------------------------------
    // DRAIN WALLET — steal a % or flat amount from target's wallet only
    // ----------------------------------------------------------
    case 'drain_wallet': {
      if (!targetId) return { success: false, title: 'Target Required', description: 'This item requires a target.' };

      // ---- PROTECTED ROLE CHECK ----
      const drainWalletConfig = db.getConfig();
      const drainWalletProtected = drainWalletConfig.protectedRoles || [];
      if (targetMember && drainWalletProtected.some(r => targetMember.roles.cache.has(r))) {
        return { success: false, title: '🛡️ Target Protected', description: `<@${targetId}> has a protected role and cannot be attacked.` };
      }

      const targetData = db.getUser(targetId);

      // ---- SHIELD CHECK ----
      const targetEffects = getUserEffects(targetId);
      if (targetEffects.shield) {
        const shield = targetEffects.shield;
        if (Date.now() < shield.expiresAt && shield.blocksLeft > 0) {
          shield.blocksLeft--;
          if (shield.blocksLeft <= 0) targetEffects.shield = null;
          saveUserEffects(targetId, targetEffects);
          return {
            success: false,
            title: '🛡️ Blocked!',
            description: `Your attack was blocked by **<@${targetId}>'s** shield!\n${shield.blocksLeft} block(s) remaining.`,
          };
        } else {
          // Shield expired
          targetEffects.shield = null;
          saveUserEffects(targetId, targetEffects);
        }
      }

      // ---- STACK MULTIPLIER ----
      // Each previous unresolved drain hit on target raises the multiplier
      const stack = targetEffects.drainStack || 1;

      let stolen = 0;
      if (effect.drainType === 'percent') {
        stolen = Math.floor(targetData.wallet * (effect.amount / 100) * stack);
      } else {
        // flat amount
        stolen = Math.floor(effect.amount * stack);
      }
      stolen = Math.min(stolen, targetData.wallet); // can't steal more than they have

      // Apply drain
      targetData.wallet -= stolen;
      db.saveUser(targetId, targetData);

      // Give to attacker
      const attackerData = db.getUser(userId);
      attackerData.wallet += stolen;
      db.saveUser(userId, attackerData);

      // Increment stack on target (stacks go up each time they're hit)
      targetEffects.drainStack = stack + 0.25; // each hit adds 25% more damage
      saveUserEffects(targetId, targetEffects);

      // Schedule stack decay after effect.duration (if set)
      if (effect.durationMs) {
        setTimeout(() => {
          const e = getUserEffects(targetId);
          e.drainStack = Math.max(1, (e.drainStack || 1) - 0.25);
          saveUserEffects(targetId, e);
        }, effect.durationMs);
      }

      return {
        success: true,
        title: `💸 ${item.name} — Wallet Drained`,
        description: `You drained **$${stolen.toLocaleString()}** from <@${targetId}>'s wallet.`,
        fields: [
          { name: 'Stack Multiplier', value: `${stack.toFixed(2)}×`, inline: true },
          { name: 'Target Wallet Now', value: `$${targetData.wallet.toLocaleString()}`, inline: true },
          { name: 'Your Wallet Now',   value: `$${attackerData.wallet.toLocaleString()}`, inline: true },
        ],
      };
    }

    // ----------------------------------------------------------
    // DRAIN ALL — steals from wallet AND bank combined
    // ----------------------------------------------------------
    case 'drain_all': {
      if (!targetId) return { success: false, title: 'Target Required', description: 'This item requires a target.' };

      // ---- PROTECTED ROLE CHECK ----
      const drainAllConfig = db.getConfig();
      const drainAllProtected = drainAllConfig.protectedRoles || [];
      if (targetMember && drainAllProtected.some(r => targetMember.roles.cache.has(r))) {
        return { success: false, title: '🛡️ Target Protected', description: `<@${targetId}> has a protected role and cannot be attacked.` };
      }

      const targetData = db.getUser(targetId);

      // Shield check (same as drain_wallet)
      const targetEffects = getUserEffects(targetId);
      if (targetEffects.shield) {
        const shield = targetEffects.shield;
        if (Date.now() < shield.expiresAt && shield.blocksLeft > 0) {
          shield.blocksLeft--;
          if (shield.blocksLeft <= 0) targetEffects.shield = null;
          saveUserEffects(targetId, targetEffects);
          return {
            success: false,
            title: '🛡️ Blocked!',
            description: `Your attack was deflected by <@${targetId}>'s shield!`,
          };
        } else {
          targetEffects.shield = null;
          saveUserEffects(targetId, targetEffects);
        }
      }

      const stack  = targetEffects.drainStack || 1;
      const total  = targetData.wallet + targetData.bank;
      let stolen;
      if (effect.drainType === 'percent') {
        stolen = Math.floor(total * (effect.amount / 100) * stack);
      } else {
        stolen = Math.floor(effect.amount * stack);
      }

      // Drain bank first, then wallet
      const fromBank   = Math.min(stolen, targetData.bank);
      const fromWallet = Math.min(stolen - fromBank, targetData.wallet);
      targetData.bank   -= fromBank;
      targetData.wallet -= fromWallet;
      const actualStolen = fromBank + fromWallet;

      db.saveUser(targetId, targetData);

      const attackerData = db.getUser(userId);
      attackerData.wallet += actualStolen;
      db.saveUser(userId, attackerData);

      targetEffects.drainStack = stack + 0.25;
      saveUserEffects(targetId, targetEffects);

      return {
        success: true,
        title: `💻 ${item.name} — Full Drain`,
        description: `You drained **$${actualStolen.toLocaleString()}** from <@${targetId}>'s wallet AND bank.`,
        fields: [
          { name: 'From Bank',    value: `$${fromBank.toLocaleString()}`,    inline: true },
          { name: 'From Wallet',  value: `$${fromWallet.toLocaleString()}`,  inline: true },
          { name: 'Stack Multi',  value: `${stack.toFixed(2)}×`,             inline: true },
        ],
      };
    }

    // ----------------------------------------------------------
    // SILENCE — lock target out of bot for configurable duration
    // ----------------------------------------------------------
    case 'silence': {
      if (!targetId) return { success: false, title: 'Target Required', description: 'This item requires a target.' };

      const targetData   = db.getUser(targetId);
      const targetEffects = getUserEffects(targetId);

      // Shield blocks silence too
      if (targetEffects.shield) {
        const shield = targetEffects.shield;
        if (Date.now() < shield.expiresAt && shield.blocksLeft > 0) {
          shield.blocksLeft--;
          if (shield.blocksLeft <= 0) targetEffects.shield = null;
          saveUserEffects(targetId, targetEffects);
          return {
            success: false,
            title: '🛡️ Blocked!',
            description: `<@${targetId}>'s shield absorbed the silence!`,
          };
        } else {
          targetEffects.shield = null;
          saveUserEffects(targetId, targetEffects);
        }
      }

      const durationMs  = effect.durationMs || 60 * 60 * 1000; // default 1 hour
      const durationMin = Math.ceil(durationMs / 60000);

      // Stack: additional silences extend the ban time
      const existingBan = targetData.bannedUntil && targetData.bannedUntil > Date.now()
        ? targetData.bannedUntil
        : Date.now();
      targetData.bannedUntil = existingBan + durationMs; // stacks on top of existing ban

      db.saveUser(targetId, targetData);

      const totalRemaining = Math.ceil((targetData.bannedUntil - Date.now()) / 60000);

      return {
        success: true,
        title: `🔇 ${item.name} — Silenced`,
        description: `<@${targetId}> has been silenced for **${durationMin} minutes**.`,
        fields: [
          { name: 'Total Ban Time Remaining', value: `${totalRemaining} min`, inline: true },
        ],
      };
    }

    // ----------------------------------------------------------
    // GAMBLE — random outcome from a configured table
    // Each outcome has: { label, chance, moneyDelta, targetMoneyDelta, silenceDuration }
    // chance values should sum to 1.0 across all outcomes
    // ----------------------------------------------------------
    case 'gamble': {
      const outcomes = effect.outcomes;
      if (!outcomes || !outcomes.length) {
        return { success: false, title: 'Misconfigured', description: 'No outcomes defined for this gamble item.' };
      }

      // Weighted random selection
      // Roll a number 0–1, walk through outcomes subtracting each chance
      let roll = Math.random();
      let chosen = outcomes[outcomes.length - 1]; // fallback to last
      for (const outcome of outcomes) {
        roll -= outcome.chance;
        if (roll <= 0) { chosen = outcome; break; }
      }

      const userData = db.getUser(userId);
      const results  = [];

      // Apply money delta to user
      if (chosen.moneyDelta) {
        userData.wallet = Math.max(0, userData.wallet + chosen.moneyDelta);
        results.push(chosen.moneyDelta > 0
          ? `You gained **$${chosen.moneyDelta.toLocaleString()}**`
          : `You lost **$${Math.abs(chosen.moneyDelta).toLocaleString()}**`);
      }
      db.saveUser(userId, userData);

      // Apply money delta to target (if any)
      if (targetId && chosen.targetMoneyDelta) {
        const tData = db.getUser(targetId);
        tData.wallet = Math.max(0, tData.wallet + chosen.targetMoneyDelta);
        db.saveUser(targetId, tData);
        results.push(chosen.targetMoneyDelta < 0
          ? `<@${targetId}> lost **$${Math.abs(chosen.targetMoneyDelta).toLocaleString()}**`
          : `<@${targetId}> gained **$${chosen.targetMoneyDelta.toLocaleString()}**`);
      }

      // Apply silence to target
      if (targetId && chosen.silenceDuration) {
        const tData = db.getUser(targetId);
        tData.bannedUntil = Date.now() + chosen.silenceDuration;
        db.saveUser(targetId, tData);
        results.push(`<@${targetId}> was silenced for **${Math.ceil(chosen.silenceDuration/60000)} minutes**`);
      }

      return {
        success: true,
        title: `🎲 ${item.name} — ${chosen.label}`,
        description: results.join('\n') || chosen.label,
        fields: [
          { name: 'Your Wallet', value: `$${userData.wallet.toLocaleString()}`, inline: true },
        ],
      };
    }

    // ----------------------------------------------------------
    // PASSIVE INCOME — register an ongoing income tick on the user
    // Every intervalMs milliseconds, they earn amountPerTick
    // Stacks: multiple uses multiply the rate
    // ----------------------------------------------------------
    case 'passive_income': {
      const userEffects = getUserEffects(userId);
      if (!userEffects.passiveIncome) userEffects.passiveIncome = [];

      // Check if this item's passive is already active
      const existing = userEffects.passiveIncome.find(p => p.itemId === item.id);

      if (existing) {
        // Stack — increment the multiplier
        existing.stackCount = (existing.stackCount || 1) + 1;
        existing.amountPerTick = effect.amountPerTick * existing.stackCount;
      } else {
        userEffects.passiveIncome.push({
          itemId:        item.id,
          itemName:      item.name,
          amountPerTick: effect.amountPerTick,
          intervalMs:    effect.intervalMs || 5 * 60 * 1000, // default 5 min
          lastTick:      Date.now(),
          expiresAt:     effect.durationMs ? Date.now() + effect.durationMs : null,
          stackCount:    1,
        });
      }

      saveUserEffects(userId, userEffects);

      const minuteRate = Math.floor(effect.amountPerTick / (effect.intervalMs / 60000));
      const stackInfo  = existing ? ` (now stacked ×${existing.stackCount})` : '';

      return {
        success: true,
        title: `💰 ${item.name} — Passive Income Active`,
        description: `You're now earning **$${effect.amountPerTick.toLocaleString()}** every **${Math.ceil(effect.intervalMs/60000)} minute(s)**${stackInfo}.`,
        fields: [
          { name: 'Rate',     value: `~$${minuteRate}/min`, inline: true },
          { name: 'Expires',  value: effect.durationMs ? `In ${Math.ceil(effect.durationMs/3600000)}h` : 'Never', inline: true },
        ],
      };
    }

    // ----------------------------------------------------------
    // SHIELD — protect the user from drain/silence attacks
    // ----------------------------------------------------------
    case 'shield': {
      const userEffects = getUserEffects(userId);

      const blocksLeft  = effect.blocksLeft  || 3;
      const durationMs  = effect.durationMs  || 24 * 60 * 60 * 1000;

      // If already shielded, add more blocks
      if (userEffects.shield && userEffects.shield.expiresAt > Date.now()) {
        userEffects.shield.blocksLeft += blocksLeft;
        userEffects.shield.expiresAt   = Date.now() + durationMs; // reset timer
      } else {
        userEffects.shield = {
          blocksLeft,
          expiresAt: Date.now() + durationMs,
        };
      }

      saveUserEffects(userId, userEffects);

      return {
        success: true,
        title: `🛡️ ${item.name} — Shield Active`,
        description: `You're protected from the next **${userEffects.shield.blocksLeft} attack(s)** for **${Math.ceil(durationMs/3600000)}h**.`,
        fields: [
          { name: 'Blocks Left', value: `${userEffects.shield.blocksLeft}`,                    inline: true },
          { name: 'Expires',     value: new Date(userEffects.shield.expiresAt).toLocaleTimeString(), inline: true },
        ],
      };
    }

    // ----------------------------------------------------------
    // HITMAN — 50/50 dice roll: rob 50% total OR silence 24h
    // On fail: sender loses 50% of their total → given to target as karma
    // Configured via effect.action: 'rob' | 'silence'
    // ----------------------------------------------------------
    case 'hitman': {
      if (!targetId) return { success: false, title: 'Target Required', description: 'You must target a user with this item.' };

      // ---- PROTECTED ROLE CHECK ----
      const hitmanConfig    = db.getConfig();
      const hitmanProtected = hitmanConfig.protectedRoles || [];
      if (targetMember && hitmanProtected.some(r => targetMember.roles.cache.has(r))) {
        return { success: false, title: '🛡️ Target Protected', description: `<@${targetId}> has a protected role. The hitman stood down.` };
      }

      const action  = effect.action || 'rob';
      const success = Math.random() < 0.5;

      if (success) {
        const targetData = db.getUser(targetId);

        if (action === 'rob') {
          const totalTarget = targetData.wallet + targetData.bank;
          const stolen      = Math.floor(totalTarget * 0.5);
          const fromBank    = Math.min(stolen, targetData.bank);
          const fromWallet  = Math.min(stolen - fromBank, targetData.wallet);
          targetData.bank   -= fromBank;
          targetData.wallet  = Math.max(0, targetData.wallet - fromWallet);
          const senderData   = db.getUser(userId);
          senderData.wallet += stolen;
          db.saveUser(targetId, targetData);
          db.saveUser(userId, senderData);
          return {
            success: true,
            title: '🔫 Hitman — Mission Complete (Rob)',
            description: `Your hitman delivered.\nYou stole **$${stolen.toLocaleString()}** from <@${targetId}>.`,
            fields: [
              { name: 'From Bank',    value: `$${fromBank.toLocaleString()}`,    inline: true },
              { name: 'From Wallet',  value: `$${fromWallet.toLocaleString()}`,  inline: true },
              { name: 'Your Wallet',  value: `$${senderData.wallet.toLocaleString()}`, inline: true },
            ],
          };
        }

        if (action === 'silence') {
          const SILENCE_MS = 24 * 60 * 60 * 1000;
          const existing   = targetData.bannedUntil && targetData.bannedUntil > Date.now() ? targetData.bannedUntil : Date.now();
          targetData.bannedUntil = existing + SILENCE_MS;
          db.saveUser(targetId, targetData);
          return {
            success: true,
            title: '🔫 Hitman — Mission Complete (Silence)',
            description: `Your hitman delivered.\n<@${targetId}> is locked out of the bot for **24 hours**.`,
          };
        }
      }

      // ---- FAIL — KARMA ----
      const senderData  = db.getUser(userId);
      const senderTotal = senderData.wallet + senderData.bank;
      const karma       = Math.floor(senderTotal * 0.5);
      const fromWallet  = Math.min(karma, senderData.wallet);
      const fromBank    = Math.min(karma - fromWallet, senderData.bank);
      senderData.wallet -= fromWallet;
      senderData.bank    = Math.max(0, senderData.bank - fromBank);
      const targetData2  = db.getUser(targetId);
      targetData2.wallet += karma;
      db.saveUser(userId, senderData);
      db.saveUser(targetId, targetData2);
      return {
        success: false,
        title: '🎲 Hitman — Mission Failed (Karma)',
        description: `The dice didn't go your way.\n**$${karma.toLocaleString()}** (50% of your balance) was seized and given to <@${targetId}> as karma.`,
        fields: [
          { name: 'Your Wallet', value: `$${senderData.wallet.toLocaleString()}`, inline: true },
          { name: 'Your Bank',   value: `$${senderData.bank.toLocaleString()}`,   inline: true },
        ],
      };
    }

    // ----------------------------------------------------------
    // MINIGAME DRAIN — target's bank (and optionally wallet) drained
    // only if the attacker solves a scrambled word in time.
    // Returns { needsMinigame: true, ... } — use.js handles the rest.
    // ----------------------------------------------------------
    case 'minigame_drain': {
      if (!targetId) return { success: false, title: 'Target Required', description: 'This item requires a target.' };

      // Protected role check
      const mgConfig    = db.getConfig();
      const mgProtected = mgConfig.protectedRoles || [];
      if (targetMember && mgProtected.some(r => targetMember.roles.cache.has(r))) {
        return { success: false, title: '🛡️ Target Protected', description: `<@${targetId}> has a protected role and cannot be attacked.` };
      }

      // Shield check
      const targetEffects = getUserEffects(targetId);
      if (targetEffects.shield) {
        const shield = targetEffects.shield;
        if (Date.now() < shield.expiresAt && shield.blocksLeft > 0) {
          shield.blocksLeft--;
          if (shield.blocksLeft <= 0) targetEffects.shield = null;
          saveUserEffects(targetId, targetEffects);
          return { success: false, title: '🛡️ Blocked!', description: `<@${targetId}>'s shield absorbed the attack!` };
        } else {
          targetEffects.shield = null;
          saveUserEffects(targetId, targetEffects);
        }
      }

      // Signal use.js to run the minigame — pass all needed data
      return {
        success: true,
        needsMinigame: true,
        effect,
        targetId,
      };
    }

    // ----------------------------------------------------------
    // EDIT BALANCE — give or take money from the user (or target)
    // effect.target: 'self' | 'target'
    // effect.action: 'give' | 'take'
    // effect.amount: number (flat)
    // effect.destination: 'wallet' | 'bank'
    // ----------------------------------------------------------
    case 'edit_balance': {
      const recipientId = effect.target === 'target' ? targetId : userId;
      if (!recipientId) return { success: false, title: 'Target Required', description: 'This item requires a target.' };
      const recipient = db.getOrCreateUser(recipientId);
      const dest      = effect.destination || 'wallet';
      const amount    = effect.amount || 0;
      if (effect.action === 'give') {
        dest === 'bank' ? recipient.bank += amount : recipient.wallet += amount;
        db.saveUser(recipientId, recipient);
        return {
          success: true,
          title: `💰 Balance Updated`,
          description: `**$${amount.toLocaleString()}** was added to ${recipientId === userId ? 'your' : `<@${recipientId}>'s`} ${dest}.`,
          fields: [{ name: dest === 'bank' ? '🏦 Bank' : '💵 Wallet', value: `$${(dest === 'bank' ? recipient.bank : recipient.wallet).toLocaleString()}`, inline: true }],
        };
      } else {
        const current = dest === 'bank' ? recipient.bank : recipient.wallet;
        const taken   = Math.min(amount, current);
        dest === 'bank' ? recipient.bank -= taken : recipient.wallet -= taken;
        recipient.bank   = Math.max(0, recipient.bank);
        recipient.wallet = Math.max(0, recipient.wallet);
        db.saveUser(recipientId, recipient);
        return {
          success: true,
          title: `💸 Balance Updated`,
          description: `**$${taken.toLocaleString()}** was removed from ${recipientId === userId ? 'your' : `<@${recipientId}>'s`} ${dest}.`,
          fields: [{ name: dest === 'bank' ? '🏦 Bank' : '💵 Wallet', value: `$${(dest === 'bank' ? recipient.bank : recipient.wallet).toLocaleString()}`, inline: true }],
        };
      }
    }

    // ----------------------------------------------------------
    // EDIT ITEMS — give or take a specific item from user/target
    // effect.action: 'give' | 'take'
    // effect.itemId: string — item ID to give/take
    // effect.target: 'self' | 'target'
    // ----------------------------------------------------------
    case 'edit_items': {
      const recipientId2 = effect.target === 'target' ? targetId : userId;
      if (!recipientId2) return { success: false, title: 'Target Required', description: 'This item requires a target.' };
      const store2 = db.getStore();
      const item2  = (store2.items||[]).find(i => i.id === effect.itemId);
      if (!item2) return { success: false, title: 'Item Not Found', description: `Item \`${effect.itemId}\` doesn't exist in the store.` };
      if (effect.action === 'give') {
        db.giveItem(recipientId2, effect.itemId);
        return {
          success: true,
          title: `🎒 Item Given`,
          description: `**${item2.name}** was added to ${recipientId2 === userId ? 'your' : `<@${recipientId2}>'s`} inventory.`,
        };
      } else {
        const recipient2 = db.getUser(recipientId2);
        if (!recipient2) return { success: false, title: 'User Not Found', description: 'Target has no account.' };
        const inv2 = recipient2.inventory || [];
        const idx2 = inv2.indexOf(effect.itemId);
        if (idx2 === -1) return { success: false, title: 'Item Not in Inventory', description: `${recipientId2 === userId ? 'You don\'t' : `<@${recipientId2}> doesn't`} have **${item2.name}**.` };
        inv2.splice(idx2, 1);
        recipient2.inventory = inv2;
        db.saveUser(recipientId2, recipient2);
        return {
          success: true,
          title: `🗑️ Item Removed`,
          description: `**${item2.name}** was removed from ${recipientId2 === userId ? 'your' : `<@${recipientId2}>'s`} inventory.`,
        };
      }
    }

    // ----------------------------------------------------------
    // EDIT ROLES — add or remove a Discord role from user/target
    // effect.action: 'add' | 'remove'
    // effect.roleId: string — Discord role ID
    // effect.target: 'self' | 'target'
    // Requires guildMember to be passed in via use.js
    // ----------------------------------------------------------
    case 'edit_roles': {
      const memberToEdit = effect.target === 'target' ? targetMember : null;
      // For self, we need to pass the user's own member — handled in use.js
      return {
        success: true,
        needsRoleEdit: true,
        roleId:  effect.roleId,
        action:  effect.action || 'add',
        target:  effect.target || 'self',
        targetId: effect.target === 'target' ? targetId : userId,
      };
    }

    // ----------------------------------------------------------
    // AI — Spawns an AI entity with a personality and autonomy
    // effect.archetype: 'robot' | 'phone' | 'companion' | 'drone' | 'assistant'
    // effect.entityName: string — what the AI is called
    // effect.startMood: 'loyal' | 'passive' | 'aggressive'
    // effect.startLoyalty: 0-100
    // effect.forceRogue: bool — starts rogue immediately
    // ----------------------------------------------------------
    case 'ai': {
      const { AI_ARCHETYPES, saveEntity } = require('./aiEntities');
      const archetype = effect.archetype || 'robot';
      const arch      = AI_ARCHETYPES[archetype];
      if (!arch) return { success: false, title: 'Unknown AI Type', description: `Archetype "${archetype}" not found.` };

      const entityId   = `${userId}_${archetype}_${Date.now()}`;
      const entityName = effect.entityName || arch.name;
      const startMood  = effect.forceRogue ? 'rogue' : (effect.startMood || arch.basePersonality === 'aggressive' ? 'passive' : 'loyal');

      const entity = {
        id:           entityId,
        ownerId:      userId,
        name:         entityName,
        archetype,
        mood:         startMood,
        loyalty:      effect.forceRogue ? 0 : (effect.startLoyalty ?? 75),
        interactions: 0,
        createdAt:    Date.now(),
        lastTalked:   null,
        abilities:    arch.abilities || [],
      };
      saveEntity(entityId, entity);

      const rogueNote = effect.forceRogue
        ? '\n\n⚠️ **WARNING:** This entity started in ROGUE mode. It does not answer to you.'
        : '\n\nUse `/talk` to interact with it. Keep it happy or it might turn on you.';

      return {
        success: true,
        title:   `${arch.emoji} ${entityName} Activated!`,
        description: `You now own a **${arch.name}**.\n*"${arch.responses.loyal[0]}"*${rogueNote}`,
        fields:  [
          { name: '🧠 Mood',    value: startMood.charAt(0).toUpperCase() + startMood.slice(1), inline: true },
          { name: '❤️ Loyalty', value: `${entity.loyalty}/100`,                               inline: true },
          { name: '🎯 Abilities', value: arch.abilities.join(', '),                            inline: false },
        ],
      };
    }

    // ----------------------------------------------------------
    // BLACK MAGIC — hex a target, drain their wallet/bank/both
    // and transfer the stolen funds directly to the hexer.
    //
    // effect.drainTarget:  'wallet' | 'bank' | 'both'
    // effect.drainType:    'percent' | 'flat'
    // effect.amount:       number (% or flat $)
    // effect.successChance: 0.0–1.0 (default 0.75)
    // effect.backfireChance: 0.0–1.0 (if hex fails, % chance it hits hexer)
    // effect.backfirePercent: number — how much of hexer's own wallet they lose on backfire (default 25%)
    // effect.hexName:      string — custom hex name shown in embed
    // ----------------------------------------------------------
    case 'black_magic': {
      if (!targetId) return { success: false, title: '🖤 Hex Failed', description: 'Black magic requires a target to hex.' };

      // Protected role check
      const bmConfig    = db.getConfig();
      const bmProtected = bmConfig.protectedRoles || [];
      if (targetMember && bmProtected.some(r => targetMember.roles.cache.has(r))) {
        return { success: false, title: '🛡️ Hex Deflected', description: `<@${targetId}> is protected — your hex bounced off.` };
      }

      const hexName  = effect.hexName || 'Hex';
      const hexEmoji = '🖤';

      // Shield check on target
      const targetEffects = getUserEffects(targetId);
      if (targetEffects.shield && Date.now() < targetEffects.shield.expiresAt && targetEffects.shield.blocksLeft > 0) {
        targetEffects.shield.blocksLeft--;
        if (targetEffects.shield.blocksLeft <= 0) targetEffects.shield = null;
        saveUserEffects(targetId, targetEffects);
        return { success: false, title: `${hexEmoji} ${hexName} — Blocked!`, description: `<@${targetId}>'s shield absorbed the hex! Their shield has ${targetEffects.shield?.blocksLeft ?? 0} block(s) left.` };
      }

      // Success roll
      const successChance = effect.successChance !== undefined ? effect.successChance : 0.75;
      const succeeds      = Math.random() < successChance;

      if (!succeeds) {
        // Backfire logic
        const backfireChance = effect.backfireChance !== undefined ? effect.backfireChance : 0.4;
        const backfires      = Math.random() < backfireChance;

        if (backfires) {
          const hexerData    = db.getOrCreateUser(userId);
          const backfirePct  = effect.backfirePercent !== undefined ? effect.backfirePercent : 25;
          const pool         = effect.drainTarget === 'both' ? hexerData.wallet + hexerData.bank : hexerData.wallet;
          let   backfireHit  = Math.floor(pool * (backfirePct / 100));
          const fromWallet   = Math.min(backfireHit, hexerData.wallet);
          const fromBank     = Math.min(backfireHit - fromWallet, hexerData.bank);
          hexerData.wallet   = Math.max(0, hexerData.wallet - fromWallet);
          hexerData.bank     = Math.max(0, hexerData.bank   - fromBank);
          const actualLost   = fromWallet + fromBank;
          db.saveUser(userId, hexerData);

          return {
            success: false,
            title:   `${hexEmoji} ${hexName} — Backfired!`,
            description: `Your hex misfired and came back at you!\n**-$${actualLost.toLocaleString()}** (${backfirePct}% of your balance) lost.`,
            fields: [
              { name: '💵 Your Wallet', value: `$${hexerData.wallet.toLocaleString()}`, inline: true },
              { name: '🏦 Your Bank',   value: `$${hexerData.bank.toLocaleString()}`,   inline: true },
            ],
          };
        }

        return {
          success: false,
          title:   `${hexEmoji} ${hexName} — Fizzled`,
          description: `The hex had no effect on <@${targetId}>. The spirits weren't with you today.`,
        };
      }

      // ---- HEX SUCCEEDS — drain target and transfer to hexer ----
      const targetData = db.getUser(targetId);
      if (!targetData) return { success: false, title: `${hexEmoji} ${hexName} — No Target`, description: `<@${targetId}> doesn't have an account.` };

      const drainTarget = effect.drainTarget || 'wallet';
      const drainType   = effect.drainType   || 'percent';
      const amount      = effect.amount       || 25;

      let stolen     = 0;
      let fromWallet = 0;
      let fromBank   = 0;

      if (drainTarget === 'wallet') {
        stolen     = drainType === 'percent' ? Math.floor(targetData.wallet * (amount / 100)) : Math.min(amount, targetData.wallet);
        fromWallet = stolen;
        targetData.wallet = Math.max(0, targetData.wallet - stolen);
      } else if (drainTarget === 'bank') {
        stolen   = drainType === 'percent' ? Math.floor(targetData.bank * (amount / 100)) : Math.min(amount, targetData.bank);
        fromBank = stolen;
        targetData.bank = Math.max(0, targetData.bank - stolen);
      } else {
        // both — drain wallet first, then bank
        const totalPool = targetData.wallet + targetData.bank;
        stolen          = drainType === 'percent' ? Math.floor(totalPool * (amount / 100)) : Math.min(amount, totalPool);
        fromWallet      = Math.min(stolen, targetData.wallet);
        fromBank        = Math.min(stolen - fromWallet, targetData.bank);
        targetData.wallet = Math.max(0, targetData.wallet - fromWallet);
        targetData.bank   = Math.max(0, targetData.bank   - fromBank);
        stolen            = fromWallet + fromBank;
      }

      db.saveUser(targetId, targetData);

      // Transfer to hexer
      const hexerData    = db.getOrCreateUser(userId);
      hexerData.wallet  += stolen;
      db.saveUser(userId, hexerData);

      const drainLabel = drainTarget === 'both' ? 'wallet + bank' : drainTarget;
      const amountLabel = drainType === 'percent' ? `${amount}% of ${drainLabel}` : `$${amount.toLocaleString()} flat from ${drainLabel}`;

      return {
        success: true,
        title:   `${hexEmoji} ${hexName} — Hex Landed!`,
        description: `You hexed <@${targetId}> and drained **$${stolen.toLocaleString()}** directly into your wallet.\n*The spirits favor the bold.*`,
        fields: [
          { name: '🎯 Drained From',   value: drainLabel,                          inline: true },
          { name: '💸 Amount',          value: amountLabel,                         inline: true },
          { name: '💰 You Received',    value: `$${stolen.toLocaleString()}`,        inline: true },
          { name: '💵 Your Wallet Now', value: `$${hexerData.wallet.toLocaleString()}`, inline: true },
          { name: "🎭 Target's Wallet", value: `$${targetData.wallet.toLocaleString()}`, inline: true },
          { name: "🏦 Target's Bank",   value: `$${targetData.bank.toLocaleString()}`,   inline: true },
        ],
      };
    }

    // ----------------------------------------------------------
    // MAGIC — applies a configurable combo of effects with a
    // visual flourish. Can buff the user, debuff the target,
    // or both at once. Configured entirely from the dashboard.
    //
    // effect.spell:        string  — display name (e.g. "Cursed Touch")
    // effect.spellEmoji:   string  — emoji for flavor (e.g. "🔮")
    //
    // effect.selfEffect:   object  — optional buff applied to user
    //   .type: 'wallet'|'bank'|'shield'|'passive_income'
    //   .amount: number
    //   .durationMs: number (for passive/shield)
    //   .blocksLeft: number (for shield)
    //
    // effect.targetEffect: object  — optional debuff applied to target
    //   .type: 'drain_wallet'|'drain_all'|'silence'|'heat'
    //   .amount: number
    //   .drainType: 'flat'|'percent'
    //   .durationMs: number (for silence)
    //
    // effect.successChance: 0.0–1.0  — chance the spell works (default 1.0)
    // effect.backfireChance: 0.0–1.0 — if it fails, chance it hits the caster
    // ----------------------------------------------------------
    case 'magic': {
      const spell      = effect.spell      || 'Magic Spell';
      const spellEmoji = effect.spellEmoji || '🔮';

      // Success roll
      const successChance = effect.successChance !== undefined ? effect.successChance : 1.0;
      const succeeds      = Math.random() < successChance;

      if (!succeeds) {
        // Backfire check
        const backfireChance = effect.backfireChance !== undefined ? effect.backfireChance : 0;
        const backfires      = Math.random() < backfireChance;

        if (backfires && effect.targetEffect) {
          // Spell bounces back onto caster
          const selfData = db.getOrCreateUser(userId);
          const te       = effect.targetEffect;
          let backfireDesc = '';
          if (te.type === 'drain_wallet' || te.type === 'drain_all') {
            const pool   = te.type === 'drain_all' ? selfData.wallet + selfData.bank : selfData.wallet;
            let hit      = te.drainType === 'percent' ? Math.floor(pool * (te.amount / 100)) : te.amount;
            hit          = Math.min(hit, selfData.wallet);
            selfData.wallet = Math.max(0, selfData.wallet - hit);
            db.saveUser(userId, selfData);
            backfireDesc = `The spell backfired! **-$${hit.toLocaleString()}** drained from your own wallet.`;
          } else if (te.type === 'silence') {
            selfData.bannedUntil = Date.now() + (te.durationMs || 3600000);
            db.saveUser(userId, selfData);
            backfireDesc = `The spell backfired! You silenced yourself for **${Math.ceil((te.durationMs||3600000)/60000)} minutes**.`;
          }
          return { success: false, title: `${spellEmoji} ${spell} — Backfired!`, description: backfireDesc || 'The spell bounced back at you!' };
        }

        return { success: false, title: `${spellEmoji} ${spell} — Fizzled`, description: `The magic fizzled out. Nothing happened.` };
      }

      const results  = [];
      const fields   = [];

      // ---- SELF BUFF ----
      if (effect.selfEffect) {
        const se       = effect.selfEffect;
        const selfData = db.getOrCreateUser(userId);

        if (se.type === 'wallet') {
          selfData.wallet += se.amount || 0;
          db.saveUser(userId, selfData);
          results.push(`✨ You gained **$${(se.amount||0).toLocaleString()}** in your wallet.`);
          fields.push({ name: '💵 Your Wallet', value: `$${selfData.wallet.toLocaleString()}`, inline: true });
        } else if (se.type === 'bank') {
          selfData.bank += se.amount || 0;
          db.saveUser(userId, selfData);
          results.push(`✨ You gained **$${(se.amount||0).toLocaleString()}** in your bank.`);
          fields.push({ name: '🏦 Your Bank', value: `$${selfData.bank.toLocaleString()}`, inline: true });
        } else if (se.type === 'shield') {
          const userEffects     = getUserEffects(userId);
          const blocks          = se.blocksLeft || 3;
          const duration        = se.durationMs  || 24 * 60 * 60 * 1000;
          if (userEffects.shield && userEffects.shield.expiresAt > Date.now()) {
            userEffects.shield.blocksLeft += blocks;
            userEffects.shield.expiresAt   = Date.now() + duration;
          } else {
            userEffects.shield = { blocksLeft: blocks, expiresAt: Date.now() + duration };
          }
          saveUserEffects(userId, userEffects);
          results.push(`🛡️ A magical shield now protects you (**${userEffects.shield.blocksLeft} block(s)**).`);
          fields.push({ name: '🛡️ Shield', value: `${userEffects.shield.blocksLeft} blocks`, inline: true });
        } else if (se.type === 'passive_income') {
          const userEffects = getUserEffects(userId);
          if (!userEffects.passiveIncome) userEffects.passiveIncome = [];
          userEffects.passiveIncome.push({
            itemId:        item.id,
            itemName:      item.name,
            amountPerTick: se.amount || 50,
            intervalMs:    se.intervalMs || 5 * 60 * 1000,
            lastTick:      Date.now(),
            expiresAt:     se.durationMs ? Date.now() + se.durationMs : null,
            stackCount:    1,
          });
          saveUserEffects(userId, userEffects);
          results.push(`💰 Magic income: **$${se.amount||50}** every **${Math.ceil((se.intervalMs||300000)/60000)} min**.`);
        }
      }

      // ---- TARGET DEBUFF ----
      if (effect.targetEffect && targetId) {
        const te = effect.targetEffect;

        // Protected role check
        const cfg          = db.getConfig();
        const protectedRoles = cfg.protectedRoles || [];
        if (targetMember && protectedRoles.some(r => targetMember.roles.cache.has(r))) {
          results.push(`🛡️ <@${targetId}> is protected — the curse was deflected!`);
        } else {
          // Shield check
          const targetEffects = getUserEffects(targetId);
          if (targetEffects.shield && Date.now() < targetEffects.shield.expiresAt && targetEffects.shield.blocksLeft > 0) {
            targetEffects.shield.blocksLeft--;
            if (targetEffects.shield.blocksLeft <= 0) targetEffects.shield = null;
            saveUserEffects(targetId, targetEffects);
            results.push(`🛡️ <@${targetId}>'s shield absorbed the curse!`);
          } else {
            const targetData = db.getUser(targetId);
            if (targetData) {
              if (te.type === 'drain_wallet' || te.type === 'drain_all') {
                const pool = te.type === 'drain_all' ? targetData.wallet + targetData.bank : targetData.wallet;
                let stolen = te.drainType === 'percent' ? Math.floor(pool * (te.amount / 100)) : (te.amount || 0);
                stolen     = Math.min(stolen, targetData.wallet);
                targetData.wallet = Math.max(0, targetData.wallet - stolen);
                db.saveUser(targetId, targetData);
                const attackerData = db.getOrCreateUser(userId);
                attackerData.wallet += stolen;
                db.saveUser(userId, attackerData);
                results.push(`🌑 Cursed <@${targetId}> and stole **$${stolen.toLocaleString()}**.`);
                fields.push({ name: 'Stolen', value: `$${stolen.toLocaleString()}`, inline: true });
              } else if (te.type === 'silence') {
                const existing     = targetData.bannedUntil && targetData.bannedUntil > Date.now() ? targetData.bannedUntil : Date.now();
                targetData.bannedUntil = existing + (te.durationMs || 3600000);
                db.saveUser(targetId, targetData);
                results.push(`🔇 <@${targetId}> has been silenced for **${Math.ceil((te.durationMs||3600000)/60000)} minutes**.`);
              } else if (te.type === 'heat') {
                const { addHeat } = require('./police');
                addHeat(targetId, te.amount || 20, 'magic_curse');
                results.push(`🚨 Added **${te.amount||20} heat** to <@${targetId}>.`);
              }
            }
          }
        }
      } else if (effect.targetEffect && !targetId) {
        results.push('⚠️ This spell requires a target.');
      }

      return {
        success: true,
        title:   `${spellEmoji} ${spell} — Cast!`,
        description: results.join('\n') || 'The magic took effect.',
        fields,
      };
    }

    default:
      return { success: false, title: 'Unknown Effect', description: `Effect type "${effect.type}" is not recognized.` };
  }
}

// ============================================================
// PASSIVE INCOME TICK ENGINE
// Called on an interval from index.js — pays out passive income
// to all users who have active passive income effects
// ============================================================
function tickPassiveIncome() {
  const all  = readEffects();
  const now  = Date.now();
  let changed = false;

  for (const userId in all) {
    const effects = all[userId];
    if (!effects.passiveIncome || !effects.passiveIncome.length) continue;

    let userChanged = false;
    const userData  = db.getUser(userId);

    effects.passiveIncome = effects.passiveIncome.filter(p => {
      // Remove expired passives
      if (p.expiresAt && now > p.expiresAt) { changed = true; return false; }

      // Check if a tick is due
      if (now - p.lastTick >= p.intervalMs) {
        userData.wallet += p.amountPerTick;
        p.lastTick       = now;
        userChanged      = true;
        changed          = true;
        console.log(`💰 Passive tick: +$${p.amountPerTick} → user ${userId}`);
      }
      return true;
    });

    if (userChanged) db.saveUser(userId, userData);
  }

  if (changed) writeEffects(all);
}

// ============================================================
// HELPER: get a user's active effects summary (for /inventory or /profile)
// ============================================================
function getEffectsSummary(userId) {
  const effects = getUserEffects(userId);
  const now     = Date.now();
  const lines   = [];

  if (effects.shield && effects.shield.expiresAt > now) {
    lines.push(`🛡️ Shield: **${effects.shield.blocksLeft} block(s)** remaining`);
  }
  if (effects.passiveIncome && effects.passiveIncome.length) {
    for (const p of effects.passiveIncome) {
      if (!p.expiresAt || p.expiresAt > now) {
        lines.push(`💰 ${p.itemName}: **$${p.amountPerTick}** / ${Math.ceil(p.intervalMs/60000)}min`);
      }
    }
  }
  if (effects.drainStack && effects.drainStack > 1) {
    lines.push(`⚡ Drain Stack: **${effects.drainStack.toFixed(2)}×** (you're debuffed!)`);
  }
  return lines;
}

module.exports = {
  executeEffect,
  tickPassiveIncome,
  getEffectsSummary,
  getUserEffects,
  saveUserEffects,
};
