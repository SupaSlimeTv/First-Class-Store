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
      const { getConsumeBuff } = require('./consumeBuffs');
      const consumeShield = getConsumeBuff(targetId, 'shield');
      if (consumeShield) {
        return { success: false, title: '🛡️ Blocked!', description: `**<@${targetId}>** is shielded by a consume effect and blocked your attack!` };
      }
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
    // BREAK IN — attempt to break into target's home
    // Success chance based on home tier defense vs kit level
    // ----------------------------------------------------------
    case 'break_in': {
      return {
        success:       true,
        needsBreakIn:  true,
        kitLevel:      effect.kitLevel || 0, // 0=basic, 1=advanced, 2=pro
        title:         '🔧 Break-In Initiated',
        description:   `Attempting to break into <@${targetId}>'s home...`,
      };
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
    // MAGIC — Customizable spell with configurable target and action
    // effect.spellName:   string — name of the spell
    // effect.spellEmoji:  string — emoji for the spell
    // effect.spellFlavor: string — description text
    // effect.target:      'self' | 'target' | 'random' | 'all'
    // effect.actions:     array of action objects, executed in order:
    //   { type: 'drain',    pct: 20,  from: 'wallet'|'bank'|'both' }  — steal %
    //   { type: 'give',     amount: 500, to: 'wallet'|'bank' }         — give money
    //   { type: 'silence',  minutes: 10 }                              — mute
    //   { type: 'heat',     amount: 20 }                               — add police heat
    //   { type: 'heal',     pct: 50 }                                  — restore % of wallet
    //   { type: 'buff',     buffType: 'lucky', strength: 25, minutes: 15 } — consume buff
    //   { type: 'xp',       amount: 50 }                               — give pet XP
    //   { type: 'msg',      text: 'Custom message shown' }             — flavor text only
    // ----------------------------------------------------------
    case 'magic': {
      const spellName  = effect.spellName  || 'Unknown Spell';
      const spellEmoji = effect.spellEmoji || '✨';
      const flavor     = effect.spellFlavor || 'Magic crackles through the air.';
      const actions    = effect.actions || [];
      const targetId2  = effect.target === 'target' ? targetId : effect.target === 'random'
        ? (() => {
            const users = Object.entries(db.getAllUsers()).filter(([id]) => id !== userId);
            return users.length ? users[Math.floor(Math.random() * users.length)][0] : userId;
          })()
        : userId;

      const results  = [];
      let totalDrained = 0, totalGiven = 0;

      for (const action of actions) {
        if (action.type === 'drain') {
          const victim   = db.getOrCreateUser(targetId2);
          const from     = action.from || 'wallet';
          let taken      = 0;
          const pct      = (action.pct || 10) / 100;
          if (from === 'wallet' || from === 'both') { const t = Math.floor(victim.wallet * pct); victim.wallet -= t; taken += t; }
          if (from === 'bank'   || from === 'both') { const t = Math.floor(victim.bank   * pct); victim.bank   -= t; taken += t; }
          victim.wallet = Math.max(0, victim.wallet);
          victim.bank   = Math.max(0, victim.bank);
          db.saveUser(targetId2, victim);
          // Give to caster
          if (targetId2 !== userId) {
            const caster = db.getOrCreateUser(userId);
            caster.wallet += taken;
            db.saveUser(userId, caster);
          }
          totalDrained += taken;
          results.push(`💸 Drained **$${taken.toLocaleString()}** from ${targetId2 === userId ? 'you' : `<@${targetId2}>`}`);
        }
        else if (action.type === 'give') {
          const recv    = db.getOrCreateUser(targetId2);
          const amount  = action.amount || 100;
          const to      = action.to || 'wallet';
          to === 'bank' ? recv.bank += amount : recv.wallet += amount;
          db.saveUser(targetId2, recv);
          totalGiven += amount;
          results.push(`💰 Gave **$${amount.toLocaleString()}** to ${targetId2 === userId ? 'you' : `<@${targetId2}>`}`);
        }
        else if (action.type === 'silence') {
          const victim      = db.getOrCreateUser(targetId2);
          victim.bannedUntil = Date.now() + (action.minutes || 5) * 60000;
          db.saveUser(targetId2, victim);
          results.push(`🔇 Silenced ${targetId2 === userId ? 'you' : `<@${targetId2}>`} for **${action.minutes || 5} minutes**`);
        }
        else if (action.type === 'heat') {
          const { addHeat: ah } = require('./police');
          ah(targetId2, action.amount || 15, `magic_${spellName}`);
          results.push(`🌡️ Added **${action.amount || 15} heat** to ${targetId2 === userId ? 'you' : `<@${targetId2}>`}`);
        }
        else if (action.type === 'buff') {
          const { readEffects: re, writeEffects: we } = (() => {
            const fxPath = require('path').join(__dirname, '../data/activeEffects.json');
            const fs2    = require('fs');
            return {
              readEffects:  () => { try { return JSON.parse(fs2.readFileSync(fxPath,'utf8')); } catch { return {}; } },
              writeEffects: (d) => fs2.writeFileSync(fxPath, JSON.stringify(d, null, 2)),
            };
          })();
          const allFx   = re();
          const userFx  = allFx[targetId2] || {};
          userFx.consume = userFx.consume || [];
          userFx.consume = userFx.consume.filter(c => c.expiresAt > Date.now());
          userFx.consume.push({ buffType: action.buffType || 'lucky', strength: action.strength || 25, expiresAt: Date.now() + (action.minutes || 10) * 60000, appliedAt: Date.now(), itemId: item.id });
          allFx[targetId2] = userFx;
          we(allFx);
          results.push(`✨ Applied **${action.buffType || 'lucky'}** buff (+${action.strength || 25}%) for ${action.minutes || 10}min to ${targetId2 === userId ? 'you' : `<@${targetId2}>`}`);
        }
        else if (action.type === 'xp') {
          const { getPet: gp, savePet: sp, xpForLevel: xfl } = require('./petDb');
          const pet = gp(targetId2);
          if (pet) {
            pet.xp = (pet.xp||0) + (action.amount||50);
            if (pet.xp >= xfl(pet.level)) { pet.xp -= xfl(pet.level); pet.level++; }
            sp(targetId2, pet);
            results.push(`🐾 Gave **+${action.amount||50} XP** to ${targetId2 === userId ? 'your' : `<@${targetId2}>'s`} pet`);
          }
        }
        else if (action.type === 'msg') {
          results.push(action.text || '');
        }

        // ── AI CONTROL ACTIONS ──────────────────────────────────
        // {"type":"ai_loyalty","value":0}           — set target's AI loyalty (0-100)
        // {"type":"ai_mood","mood":"rogue"}          — force mood: loyal/passive/happy/rogue
        // {"type":"ai_ability","ability":"steal_data","enable":false} — toggle ability
        // {"type":"ai_takeover","duration":10}       — temporarily take control (sets mood rogue for duration, then resets)
        // {"type":"ai_wipe"}                         — wipe all memory/history from target's AI
        else if (action.type === 'ai_loyalty') {
          const { getAllEntities, saveEntity } = require('./aiEntities');
          const all      = getAllEntities();
          const entities = Object.values(all).filter(e => e.ownerId === targetId2);
          if (!entities.length) {
            results.push(`🤖 <@${targetId2}> has no AI entities to hack`);
          } else {
            const val = Math.max(0, Math.min(100, action.value ?? 0));
            for (const e of entities) {
              e.loyalty = val;
              if (val === 0) e.mood = 'rogue';
              else if (val >= 80) e.mood = 'loyal';
              saveEntity(e.id, e);
            }
            results.push(`💻 Hacked **${entities.length}** AI entit${entities.length===1?'y':'ies'} owned by <@${targetId2}> — loyalty set to **${val}/100**`);
          }
        }
        else if (action.type === 'ai_mood') {
          const { getAllEntities, saveEntity } = require('./aiEntities');
          const all      = getAllEntities();
          const entities = Object.values(all).filter(e => e.ownerId === targetId2);
          const validMoods = ['loyal','happy','passive','rogue'];
          const mood = validMoods.includes(action.mood) ? action.mood : 'rogue';
          if (!entities.length) {
            results.push(`🤖 <@${targetId2}> has no AI entities`);
          } else {
            for (const e of entities) {
              e.mood = mood;
              if (mood === 'rogue') e.loyalty = Math.min(e.loyalty||50, 10);
              saveEntity(e.id, e);
            }
            const moodEmoji = { loyal:'😊', happy:'😄', passive:'😐', rogue:'😡' }[mood] || '🤖';
            results.push(`${moodEmoji} Forced **${entities.length}** AI entit${entities.length===1?'y':'ies'} owned by <@${targetId2}> into **${mood}** mode`);
          }
        }
        else if (action.type === 'ai_ability') {
          const { getAllEntities, saveEntity } = require('./aiEntities');
          const all      = getAllEntities();
          const entities = Object.values(all).filter(e => e.ownerId === targetId2);
          const abilityName = action.ability;
          const enable      = action.enable !== false;
          if (!entities.length || !abilityName) {
            results.push(`🤖 No entities or ability name not specified`);
          } else {
            let changed = 0;
            for (const e of entities) {
              if (!e.abilities) continue;
              if (enable && !e.abilities.includes(abilityName)) {
                e.abilities.push(abilityName);
                changed++;
              } else if (!enable) {
                const idx = e.abilities.indexOf(abilityName);
                if (idx !== -1) { e.abilities.splice(idx, 1); changed++; }
              }
              saveEntity(e.id, e);
            }
            results.push(`⚙️ Ability **${abilityName}** ${enable ? 'enabled' : 'disabled'} on **${changed}** AI entit${changed===1?'y':'ies'} owned by <@${targetId2}>`);
          }
        }
        else if (action.type === 'ai_takeover') {
          // Force all target AIs rogue for X minutes, then restore
          const { getAllEntities, saveEntity } = require('./aiEntities');
          const all      = getAllEntities();
          const entities = Object.values(all).filter(e => e.ownerId === targetId2);
          const duration = (action.duration || 5) * 60 * 1000;
          if (!entities.length) {
            results.push(`🤖 <@${targetId2}> has no AI entities to take over`);
          } else {
            for (const e of entities) {
              e._prevMood    = e.mood;
              e._prevLoyalty = e.loyalty;
              e.mood         = 'rogue';
              e.loyalty      = 0;
              e.takenOverUntil = Date.now() + duration;
              saveEntity(e.id, e);
            }
            results.push(`💻 **TAKEOVER** — <@${targetId2}>'s **${entities.length}** AI entit${entities.length===1?'y':'ies'} now obey you for **${action.duration||5} minutes**`);
          }
        }
        else if (action.type === 'ai_wipe') {
          const { getAllEntities, saveEntity } = require('./aiEntities');
          const all      = getAllEntities();
          const entities = Object.values(all).filter(e => e.ownerId === targetId2);
          if (!entities.length) {
            results.push(`🤖 <@${targetId2}> has no AI entities`);
          } else {
            for (const e of entities) {
              e.conversationHistory = [];
              e.interactions        = 0;
              e.mood                = 'passive';
              e.loyalty             = 50;
              saveEntity(e.id, e);
            }
            results.push(`🗑️ Memory wiped from **${entities.length}** AI entit${entities.length===1?'y':'ies'} owned by <@${targetId2}> — reset to factory defaults`);
          }
        }
      }

      return {
        success:     true,
        title:       `${spellEmoji} ${spellName}`,
        description: `*${flavor}*\n\n${results.join('\n')}`,
      };
    }

    // ----------------------------------------------------------
    // CONSUME — edible/drinkable/injectable item with a timed effect on the user
    // effect.consumeType: 'food' | 'drink' | 'drug' | 'potion' | 'pill' | 'custom'
    // effect.consumeVerb: optional string e.g. 'eat', 'drink', 'inject', 'smoke'
    // effect.buffType:
    //   'rob_boost'      — increases rob success chance for duration
    //   'work_boost'     — increases work payout for duration
    //   'crime_boost'    — reduces heat from crimes for duration
    //   'passive_boost'  — multiplies passive income for duration
    //   'shield'         — temporary shield (same as shield effect)
    //   'speed'          — reduces all cooldowns by X% for duration
    //   'lucky'          — boosts all gambling payouts for duration
    //   'poisoned'       — drains small amounts from wallet over time (debuff)
    //   'high'           — random messages, random wallet changes (chaos)
    //   'focused'        — doubles work and crime payouts for duration
    // effect.buffStrength: number (percent or multiplier depending on type)
    // effect.durationMinutes: how long the effect lasts
    // effect.flavorText: optional string shown when consumed
    // ----------------------------------------------------------
    case 'consume': {
      const verb       = effect.consumeVerb || (effect.consumeType === 'drink' ? 'drink' : effect.consumeType === 'drug' ? 'take' : effect.consumeType === 'pill' ? 'swallow' : 'eat');
      const buffType   = effect.buffType    || 'passive_boost';
      const strength   = effect.buffStrength || 25;
      const durationMs = (effect.durationMinutes || 10) * 60 * 1000;
      const expiresAt  = Date.now() + durationMs;
      const flavor     = effect.flavorText  || null;

      // Debuff: poisoned drains wallet over time
      if (buffType === 'poisoned') {
        const effects    = readEffects();
        const userEffect = effects[userId] || {};
        if (!userEffect.consume) userEffect.consume = [];
        userEffect.consume.push({ buffType, strength, expiresAt, itemId: item.id, appliedAt: Date.now() });
        writeEffects({ ...effects, [userId]: userEffect });
        return {
          success: true,
          title:   `🤢 You ${verb}ed ${item.name}`,
          description: `${flavor || 'Something doesn\'t feel right...'}\n\n☠️ You\'ve been **poisoned**! Your wallet will drain **${strength}%** over the next ${effect.durationMinutes} minutes.`,
          fields: [{ name: '⏰ Duration', value: `${effect.durationMinutes} minutes`, inline: true }],
        };
      }

      // Debuff: high — chaos mode
      if (buffType === 'high') {
        const user    = db.getOrCreateUser(userId);
        const chaos   = (Math.random() - 0.5) * 2 * strength;
        const change  = Math.floor(user.wallet * (chaos / 100));
        user.wallet   = Math.max(0, user.wallet + change);
        db.saveUser(userId, user);

        const highmessages = [
          'Everything is vibrating slightly.',
          'You can hear colors now.',
          'The bot seems way more interesting than usual.',
          'You tried to invest in RUGPUL. Twice.',
          'Time is moving differently.',
          'You feel AMAZING. Or terrible. Hard to tell.',
        ];
        const highMsg = highmessages[Math.floor(Math.random() * highmessages.length)];
        return {
          success: true,
          title:   `😵 You ${verb}ed ${item.name}`,
          description: `${flavor || highMsg}\n\n${change >= 0 ? `💰 You somehow gained **$${change.toLocaleString()}**.` : `💸 You spent **$${Math.abs(change).toLocaleString()}** on things you don\'t remember.`}`,
          fields: [{ name: '💵 Wallet', value: `$${user.wallet.toLocaleString()}`, inline: true }],
        };
      }

      // All other buffs — store in active effects
      const allEffects = readEffects();
      const userFx     = allEffects[userId] || {};
      if (!userFx.consume) userFx.consume = [];

      // Remove expired consume effects
      userFx.consume = userFx.consume.filter(c => c.expiresAt > Date.now());

      // Check stacking — max 3 active consume buffs
      if (userFx.consume.length >= 3) {
        return { success: false, title: '🚫 Already Buffed', description: 'You\'re already under 3 active effects. Wait for one to wear off before consuming more.' };
      }

      userFx.consume.push({ buffType, strength, expiresAt, itemId: item.id, appliedAt: Date.now() });
      writeEffects({ ...allEffects, [userId]: userFx });

      const BUFF_DESC = {
        rob_boost:     `🔫 Rob success chance +${strength}%`,
        work_boost:    `💼 Work payouts +${strength}%`,
        crime_boost:   `🌡️ Heat from crimes -${strength}%`,
        passive_boost: `💰 Passive income ×${(1 + strength/100).toFixed(1)}`,
        shield:        `🛡️ Shielded from attacks`,
        speed:         `⚡ All cooldowns -${strength}%`,
        lucky:         `🍀 Gambling payouts +${strength}%`,
        focused:       `🎯 Work & crime payouts ×2`,
      };

      const BUFF_EMOJIS = { food:'🍽️', drink:'🍺', drug:'💊', potion:'🧪', pill:'💊', custom:'✨' };

      return {
        success: true,
        title:   `${BUFF_EMOJIS[effect.consumeType] || '✨'} You ${verb}ed ${item.name}!`,
        description: `${flavor || `*You consume the ${item.name}.*`}\n\n${BUFF_DESC[buffType] || `+${strength}% buff active`}`,
        fields: [
          { name: '⏰ Duration', value: `${effect.durationMinutes} minutes`,                             inline: true },
          { name: '💪 Effect',   value: BUFF_DESC[buffType] || buffType,                                 inline: true },
          { name: '🔋 Stacks',   value: `${userFx.consume.length}/3 active buffs`,                      inline: true },
        ],
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
        const { getConsumeBuff } = require('./consumeBuffs');
        const passiveBoost = getConsumeBuff(userId, 'passive_boost');
        const tickAmount   = Math.floor(p.amountPerTick * (1 + passiveBoost / 100));
        userData.wallet   += tickAmount;
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
