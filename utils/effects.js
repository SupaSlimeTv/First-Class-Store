// ============================================================
// utils/effects.js — Multi-Server Edition
// Active effects (shields, passive income) = GLOBAL
// They follow the user across all servers
// ============================================================

const db = require('./db');
const { col } = require('./mongo');

async function getUserEffects(userId) {
  const c   = await col('activeEffects');
  const doc = await c.findOne({ _id: userId });
  return doc || { passiveIncome: [], shield: null, drainStack: 1 };
}

async function saveUserEffects(userId, effects) {
  const c = await col('activeEffects');
  const { _id, ...rest } = effects;
  await c.updateOne({ _id: userId }, { $set: rest }, { upsert: true });
}

// ── EXECUTE EFFECT ────────────────────────────────────────────
// guildId is passed through for protected role checks (per-server config)

async function executeEffect(item, userId, targetId, targetMember = null, guildId = null) {
  const effect = item.effect;
  if (!effect || !effect.type)
    return { success: false, title: 'No Effect', description: 'This item has no effect configured.' };

  switch (effect.type) {

    case 'drain_wallet': {
      if (!targetId) return { success:false, title:'Target Required', description:'This item requires a target.' };
      const config = await db.getConfig(guildId);
      if (targetMember && (config.protectedRoles||[]).some(r => targetMember.roles.cache.has(r)))
        return { success:false, title:'🛡️ Target Protected', description:`<@${targetId}> has a protected role.` };
      const targetData    = await db.getUser(targetId);
      const targetEffects = await getUserEffects(targetId);
      if (targetEffects.shield) {
        const s = targetEffects.shield;
        if (Date.now() < s.expiresAt && s.blocksLeft > 0) {
          s.blocksLeft--; if (!s.blocksLeft) targetEffects.shield = null;
          await saveUserEffects(targetId, targetEffects);
          return { success:false, title:'🛡️ Blocked!', description:`Your attack was blocked by <@${targetId}>'s shield! ${s.blocksLeft} block(s) remaining.` };
        } else { targetEffects.shield = null; await saveUserEffects(targetId, targetEffects); }
      }
      const stack  = targetEffects.drainStack || 1;
      let stolen   = effect.drainType==='percent' ? Math.floor(targetData.wallet*(effect.amount/100)*stack) : Math.floor(effect.amount*stack);
      stolen       = Math.min(stolen, targetData.wallet);
      targetData.wallet -= stolen; await db.saveUser(targetId, targetData);
      const atk = await db.getUser(userId); atk.wallet += stolen; await db.saveUser(userId, atk);
      targetEffects.drainStack = stack + 0.25; await saveUserEffects(targetId, targetEffects);
      if (effect.durationMs) setTimeout(async()=>{ const e=await getUserEffects(targetId); e.drainStack=Math.max(1,(e.drainStack||1)-0.25); await saveUserEffects(targetId,e); }, effect.durationMs);
      return { success:true, title:`💸 ${item.name} — Wallet Drained`, description:`You drained **$${stolen.toLocaleString()}** from <@${targetId}>'s wallet.`, fields:[{name:'Stack',value:`${stack.toFixed(2)}×`,inline:true},{name:'Target Wallet',value:`$${targetData.wallet.toLocaleString()}`,inline:true},{name:'Your Wallet',value:`$${atk.wallet.toLocaleString()}`,inline:true}] };
    }

    case 'drain_all': {
      if (!targetId) return { success:false, title:'Target Required', description:'This item requires a target.' };
      const config = await db.getConfig(guildId);
      if (targetMember && (config.protectedRoles||[]).some(r=>targetMember.roles.cache.has(r)))
        return { success:false, title:'🛡️ Target Protected', description:`<@${targetId}> has a protected role.` };
      const td = await db.getUser(targetId); const te = await getUserEffects(targetId);
      if (te.shield) { const s=te.shield; if(Date.now()<s.expiresAt&&s.blocksLeft>0){s.blocksLeft--;if(!s.blocksLeft)te.shield=null;await saveUserEffects(targetId,te);return{success:false,title:'🛡️ Blocked!',description:`<@${targetId}>'s shield deflected your attack!`};}else{te.shield=null;await saveUserEffects(targetId,te);} }
      const stack=te.drainStack||1; const total=td.wallet+td.bank;
      let stolen=effect.drainType==='percent'?Math.floor(total*(effect.amount/100)*stack):Math.floor(effect.amount*stack);
      const fb=Math.min(stolen,td.bank); const fw=Math.min(stolen-fb,td.wallet);
      td.bank-=fb; td.wallet-=fw; const actual=fb+fw;
      await db.saveUser(targetId,td); const atk=await db.getUser(userId); atk.wallet+=actual; await db.saveUser(userId,atk);
      te.drainStack=stack+0.25; await saveUserEffects(targetId,te);
      return { success:true, title:`💻 ${item.name} — Full Drain`, description:`You drained **$${actual.toLocaleString()}** from <@${targetId}>'s wallet AND bank.`, fields:[{name:'From Bank',value:`$${fb.toLocaleString()}`,inline:true},{name:'From Wallet',value:`$${fw.toLocaleString()}`,inline:true}] };
    }

    case 'silence': {
      if (!targetId) return { success:false, title:'Target Required', description:'This item requires a target.' };
      const td=await db.getUser(targetId); const te=await getUserEffects(targetId);
      if (te.shield){const s=te.shield;if(Date.now()<s.expiresAt&&s.blocksLeft>0){s.blocksLeft--;if(!s.blocksLeft)te.shield=null;await saveUserEffects(targetId,te);return{success:false,title:'🛡️ Blocked!',description:`<@${targetId}>'s shield absorbed the silence!`};}else{te.shield=null;await saveUserEffects(targetId,te);}}
      const dur=effect.durationMs||3600000;
      td.bannedUntil=(td.bannedUntil&&td.bannedUntil>Date.now()?td.bannedUntil:Date.now())+dur;
      await db.saveUser(targetId,td);
      return { success:true, title:`🔇 ${item.name} — Silenced`, description:`<@${targetId}> silenced for **${Math.ceil(dur/60000)} minutes**.`, fields:[{name:'Total Remaining',value:`${Math.ceil((td.bannedUntil-Date.now())/60000)} min`,inline:true}] };
    }

    case 'gamble': {
      if (!effect.outcomes?.length) return { success:false, title:'Misconfigured', description:'No outcomes defined.' };
      let roll=Math.random(); let chosen=effect.outcomes[effect.outcomes.length-1];
      for (const o of effect.outcomes){roll-=o.chance;if(roll<=0){chosen=o;break;}}
      const ud=await db.getUser(userId); const results=[];
      if (chosen.moneyDelta){ud.wallet=Math.max(0,ud.wallet+chosen.moneyDelta);results.push(chosen.moneyDelta>0?`You gained **$${chosen.moneyDelta.toLocaleString()}**`:`You lost **$${Math.abs(chosen.moneyDelta).toLocaleString()}**`);}
      await db.saveUser(userId,ud);
      if (targetId&&chosen.targetMoneyDelta){const t=await db.getUser(targetId);t.wallet=Math.max(0,t.wallet+chosen.targetMoneyDelta);await db.saveUser(targetId,t);results.push(`<@${targetId}> ${chosen.targetMoneyDelta<0?`lost **$${Math.abs(chosen.targetMoneyDelta).toLocaleString()}**`:`gained **$${chosen.targetMoneyDelta.toLocaleString()}**`}`);}
      if (targetId&&chosen.silenceDuration){const t=await db.getUser(targetId);t.bannedUntil=Date.now()+chosen.silenceDuration;await db.saveUser(targetId,t);results.push(`<@${targetId}> silenced for **${Math.ceil(chosen.silenceDuration/60000)} min**`);}
      return { success:true, title:`🎲 ${item.name} — ${chosen.label}`, description:results.join('\n')||chosen.label, fields:[{name:'Your Wallet',value:`$${ud.wallet.toLocaleString()}`,inline:true}] };
    }

    case 'passive_income': {
      const ue=await getUserEffects(userId); if(!ue.passiveIncome)ue.passiveIncome=[];
      const ex=ue.passiveIncome.find(p=>p.itemId===item.id);
      if(ex){ex.stackCount=(ex.stackCount||1)+1;ex.amountPerTick=effect.amountPerTick*ex.stackCount;}
      else{ue.passiveIncome.push({itemId:item.id,itemName:item.name,amountPerTick:effect.amountPerTick,intervalMs:effect.intervalMs||300000,lastTick:Date.now(),expiresAt:effect.durationMs?Date.now()+effect.durationMs:null,stackCount:1});}
      await saveUserEffects(userId,ue);
      return { success:true, title:`💰 ${item.name} — Passive Income Active`, description:`Earning **$${effect.amountPerTick.toLocaleString()}** every **${Math.ceil((effect.intervalMs||300000)/60000)} min**${ex?` (stacked ×${(ex.stackCount||1)+1})`:''}.`, fields:[{name:'Expires',value:effect.durationMs?`In ${Math.ceil(effect.durationMs/3600000)}h`:'Never',inline:true}] };
    }

    case 'shield': {
      const ue=await getUserEffects(userId); const blk=effect.blocksLeft||3; const dur=effect.durationMs||86400000;
      if(ue.shield&&ue.shield.expiresAt>Date.now()){ue.shield.blocksLeft+=blk;ue.shield.expiresAt=Date.now()+dur;}
      else{ue.shield={blocksLeft:blk,expiresAt:Date.now()+dur};}
      await saveUserEffects(userId,ue);
      return { success:true, title:`🛡️ ${item.name} — Shield Active`, description:`Protected from the next **${ue.shield.blocksLeft} attack(s)** for **${Math.ceil(dur/3600000)}h**.`, fields:[{name:'Blocks Left',value:`${ue.shield.blocksLeft}`,inline:true}] };
    }

    case 'hitman': {
      if (!targetId) return { success:false, title:'Target Required', description:'You must target a user.' };
      const config=await db.getConfig(guildId);
      if(targetMember&&(config.protectedRoles||[]).some(r=>targetMember.roles.cache.has(r)))
        return{success:false,title:'🛡️ Target Protected',description:`<@${targetId}> has a protected role. The hitman stood down.`};
      const action=effect.action||'rob'; const success=Math.random()<0.5;
      if(success){
        const td=await db.getUser(targetId);
        if(action==='rob'){const total=td.wallet+td.bank;const stolen=Math.floor(total*0.5);const fb=Math.min(stolen,td.bank);const fw=Math.min(stolen-fb,td.wallet);td.bank-=fb;td.wallet=Math.max(0,td.wallet-fw);const sd=await db.getUser(userId);sd.wallet+=stolen;await db.saveUser(targetId,td);await db.saveUser(userId,sd);return{success:true,title:'🔫 Hitman — Mission Complete (Rob)',description:`You stole **$${stolen.toLocaleString()}** from <@${targetId}>.`,fields:[{name:'Your Wallet',value:`$${sd.wallet.toLocaleString()}`,inline:true}]};}
        if(action==='silence'){td.bannedUntil=(td.bannedUntil&&td.bannedUntil>Date.now()?td.bannedUntil:Date.now())+86400000;await db.saveUser(targetId,td);return{success:true,title:'🔫 Hitman — Mission Complete (Silence)',description:`<@${targetId}> locked out for **24 hours**.`};}
      }
      const sd=await db.getUser(userId);const karma=Math.floor((sd.wallet+sd.bank)*0.5);const fw=Math.min(karma,sd.wallet);const fb=Math.min(karma-fw,sd.bank);sd.wallet-=fw;sd.bank=Math.max(0,sd.bank-fb);const td2=await db.getUser(targetId);td2.wallet+=karma;await db.saveUser(userId,sd);await db.saveUser(targetId,td2);
      return{success:false,title:'🎲 Hitman — Mission Failed (Karma)',description:`**$${karma.toLocaleString()}** (50% of your balance) seized and given to <@${targetId}>.`,fields:[{name:'Your Wallet',value:`$${sd.wallet.toLocaleString()}`,inline:true}]};
    }

    case 'minigame_drain': {
      if (!targetId) return { success:false, title:'Target Required', description:'This item requires a target.' };
      const config=await db.getConfig(guildId);
      if(targetMember&&(config.protectedRoles||[]).some(r=>targetMember.roles.cache.has(r)))
        return{success:false,title:'🛡️ Target Protected',description:`<@${targetId}> has a protected role.`};
      const te=await getUserEffects(targetId);
      if(te.shield){const s=te.shield;if(Date.now()<s.expiresAt&&s.blocksLeft>0){s.blocksLeft--;if(!s.blocksLeft)te.shield=null;await saveUserEffects(targetId,te);return{success:false,title:'🛡️ Blocked!',description:`<@${targetId}>'s shield absorbed the attack!`};}else{te.shield=null;await saveUserEffects(targetId,te);}}
      return { success:true, needsMinigame:true, effect, targetId };
    }

    case 'edit_balance': {
      const rid=effect.target==='target'?targetId:userId; if(!rid)return{success:false,title:'Target Required',description:'Requires a target.'};
      const r=await db.getOrCreateUser(rid); const dest=effect.destination||'wallet'; const amt=effect.amount||0;
      if(effect.action==='give'){dest==='bank'?r.bank+=amt:r.wallet+=amt;await db.saveUser(rid,r);return{success:true,title:'💰 Balance Updated',description:`**$${amt.toLocaleString()}** added to ${rid===userId?'your':`<@${rid}>'s`} ${dest}.`,fields:[{name:dest==='bank'?'🏦 Bank':'💵 Wallet',value:`$${(dest==='bank'?r.bank:r.wallet).toLocaleString()}`,inline:true}]};}
      else{const curr=dest==='bank'?r.bank:r.wallet;const taken=Math.min(amt,curr);dest==='bank'?r.bank-=taken:r.wallet-=taken;r.bank=Math.max(0,r.bank);r.wallet=Math.max(0,r.wallet);await db.saveUser(rid,r);return{success:true,title:'💸 Balance Updated',description:`**$${taken.toLocaleString()}** removed from ${rid===userId?'your':`<@${rid}>'s`} ${dest}.`,fields:[{name:dest==='bank'?'🏦 Bank':'💵 Wallet',value:`$${(dest==='bank'?r.bank:r.wallet).toLocaleString()}`,inline:true}]};}
    }

    case 'edit_items': {
      const rid=effect.target==='target'?targetId:userId; if(!rid)return{success:false,title:'Target Required',description:'Requires a target.'};
      const store=await db.getStore(); const item2=(store.items||[]).find(i=>i.id===effect.itemId);
      if(!item2)return{success:false,title:'Item Not Found',description:`Item \`${effect.itemId}\` doesn't exist.`};
      if(effect.action==='give'){await db.giveItem(rid,effect.itemId);return{success:true,title:'🎒 Item Given',description:`**${item2.name}** added to ${rid===userId?'your':`<@${rid}>'s`} inventory.`};}
      else{const r=await db.getUser(rid);if(!r)return{success:false,title:'User Not Found',description:'Target has no account.'};const idx=(r.inventory||[]).indexOf(effect.itemId);if(idx===-1)return{success:false,title:'Not Found',description:`${rid===userId?'You don\'t':`<@${rid}> doesn't`} have **${item2.name}**.`};r.inventory.splice(idx,1);await db.saveUser(rid,r);return{success:true,title:'🗑️ Item Removed',description:`**${item2.name}** removed from ${rid===userId?'your':`<@${rid}>'s`} inventory.`};}
    }

    case 'edit_roles':
      return { success:true, needsRoleEdit:true, roleId:effect.roleId, action:effect.action||'add', target:effect.target||'self', targetId:effect.target==='target'?targetId:userId };

    case 'ai': {
      const { AI_ARCHETYPES, saveEntity } = require('./aiEntities');
      const arch = AI_ARCHETYPES[effect.archetype||'robot'];
      if (!arch) return { success:false, title:'Unknown AI Type', description:`Archetype not found.` };
      const entityId  = `${userId}_${effect.archetype||'robot'}_${Date.now()}`;
      const startMood = effect.forceRogue?'rogue':(effect.startMood||(arch.basePersonality==='aggressive'?'passive':'loyal'));
      const entity    = { id:entityId, ownerId:userId, name:effect.entityName||arch.name, archetype:effect.archetype||'robot', mood:startMood, loyalty:effect.forceRogue?0:(effect.startLoyalty??75), interactions:0, createdAt:Date.now(), lastTalked:null, abilities:arch.abilities||[], conversationHistory:[] };
      await saveEntity(entityId, entity);
      return { success:true, title:`${arch.emoji} ${entity.name} Activated!`, description:`You now own a **${arch.name}**.\n*"${arch.responses.loyal[0]}"*\n\nUse \`/talk\` to interact.`, fields:[{name:'🧠 Mood',value:startMood,inline:true},{name:'❤️ Loyalty',value:`${entity.loyalty}/100`,inline:true}] };
    }

    case 'magic': {
      const spell=effect.spell||'Magic Spell'; const spellEmoji=effect.spellEmoji||'🔮';
      if (Math.random()>=(effect.successChance!==undefined?effect.successChance:1.0)){
        if(Math.random()<(effect.backfireChance||0)&&effect.targetEffect){
          const sd=await db.getOrCreateUser(userId); const te=effect.targetEffect;
          if(te.type==='drain_wallet'||te.type==='drain_all'){const hit=Math.min(te.drainType==='percent'?Math.floor(sd.wallet*(te.amount/100)):(te.amount||0),sd.wallet);sd.wallet=Math.max(0,sd.wallet-hit);await db.saveUser(userId,sd);return{success:false,title:`${spellEmoji} ${spell} — Backfired!`,description:`The spell backfired! **-$${hit.toLocaleString()}** drained from your wallet.`};}
          if(te.type==='silence'){sd.bannedUntil=Date.now()+(te.durationMs||3600000);await db.saveUser(userId,sd);return{success:false,title:`${spellEmoji} ${spell} — Backfired!`,description:`You silenced yourself for **${Math.ceil((te.durationMs||3600000)/60000)} minutes**.`};}
        }
        return{success:false,title:`${spellEmoji} ${spell} — Fizzled`,description:'The magic fizzled out.'};
      }
      const results=[]; const fields=[];
      if(effect.selfEffect){const se=effect.selfEffect;const sd=await db.getOrCreateUser(userId);
        if(se.type==='wallet'){sd.wallet+=se.amount||0;await db.saveUser(userId,sd);results.push(`✨ You gained **$${(se.amount||0).toLocaleString()}** in your wallet.`);fields.push({name:'💵 Wallet',value:`$${sd.wallet.toLocaleString()}`,inline:true});}
        else if(se.type==='bank'){sd.bank+=se.amount||0;await db.saveUser(userId,sd);results.push(`✨ You gained **$${(se.amount||0).toLocaleString()}** in your bank.`);}
        else if(se.type==='shield'){const ue=await getUserEffects(userId);const blk=se.blocksLeft||3;const dur=se.durationMs||86400000;if(ue.shield&&ue.shield.expiresAt>Date.now()){ue.shield.blocksLeft+=blk;ue.shield.expiresAt=Date.now()+dur;}else{ue.shield={blocksLeft:blk,expiresAt:Date.now()+dur};}await saveUserEffects(userId,ue);results.push(`🛡️ Magical shield active — **${ue.shield.blocksLeft} block(s)**.`);}
        else if(se.type==='passive_income'){const ue=await getUserEffects(userId);if(!ue.passiveIncome)ue.passiveIncome=[];ue.passiveIncome.push({itemId:item.id,itemName:item.name,amountPerTick:se.amount||50,intervalMs:se.intervalMs||300000,lastTick:Date.now(),expiresAt:se.durationMs?Date.now()+se.durationMs:null,stackCount:1});await saveUserEffects(userId,ue);results.push(`💰 Magic income: **$${se.amount||50}** every **${Math.ceil((se.intervalMs||300000)/60000)} min**.`);}
      }
      if(effect.targetEffect&&targetId){const te=effect.targetEffect;const cfg=await db.getConfig(guildId);
        if(targetMember&&(cfg.protectedRoles||[]).some(r=>targetMember.roles.cache.has(r))){results.push(`🛡️ <@${targetId}> is protected — curse deflected!`);}
        else{const tef=await getUserEffects(targetId);if(tef.shield&&Date.now()<tef.shield.expiresAt&&tef.shield.blocksLeft>0){tef.shield.blocksLeft--;if(!tef.shield.blocksLeft)tef.shield=null;await saveUserEffects(targetId,tef);results.push(`🛡️ <@${targetId}>'s shield absorbed the curse!`);}
          else{const td=await db.getUser(targetId);if(td){
            if(te.type==='drain_wallet'||te.type==='drain_all'){const pool=te.type==='drain_all'?td.wallet+td.bank:td.wallet;let stolen=te.drainType==='percent'?Math.floor(pool*(te.amount/100)):(te.amount||0);stolen=Math.min(stolen,td.wallet);td.wallet=Math.max(0,td.wallet-stolen);await db.saveUser(targetId,td);const atk=await db.getOrCreateUser(userId);atk.wallet+=stolen;await db.saveUser(userId,atk);results.push(`🌑 Cursed <@${targetId}> and stole **$${stolen.toLocaleString()}**.`);fields.push({name:'Stolen',value:`$${stolen.toLocaleString()}`,inline:true});}
            else if(te.type==='silence'){td.bannedUntil=(td.bannedUntil&&td.bannedUntil>Date.now()?td.bannedUntil:Date.now())+(te.durationMs||3600000);await db.saveUser(targetId,td);results.push(`🔇 <@${targetId}> silenced for **${Math.ceil((te.durationMs||3600000)/60000)} min**.`);}
            else if(te.type==='heat'){const{addHeat}=require('./police');await addHeat(targetId,te.amount||20,'magic_curse',guildId);results.push(`🚨 Added **${te.amount||20} heat** to <@${targetId}>.`);}
          }}}
      }
      return{success:true,title:`${spellEmoji} ${spell} — Cast!`,description:results.join('\n')||'The magic took effect.',fields};
    }

    default:
      return { success:false, title:'Unknown Effect', description:`Effect type "${effect.type}" is not recognized.` };
  }
}

// ── PASSIVE INCOME TICK ───────────────────────────────────────

async function tickPassiveIncome() {
  const c   = await col('activeEffects');
  const all = await c.find({ passiveIncome: { $exists: true, $not: { $size: 0 } } }).toArray();
  const now = Date.now();
  for (const effects of all) {
    const userId = effects._id;
    if (!effects.passiveIncome?.length) continue;
    let changed = false;
    const user  = await db.getUser(userId);
    if (!user) continue;
    effects.passiveIncome = effects.passiveIncome.filter(p => {
      if (p.expiresAt && now > p.expiresAt) { changed = true; return false; }
      if (now - p.lastTick >= p.intervalMs) { user.wallet += p.amountPerTick; p.lastTick = now; changed = true; }
      return true;
    });
    if (changed) { await db.saveUser(userId, user); await c.updateOne({ _id: userId }, { $set: { passiveIncome: effects.passiveIncome } }); }
  }
}

async function getEffectsSummary(userId) {
  const effects = await getUserEffects(userId);
  const now = Date.now(); const lines = [];
  if (effects.shield?.expiresAt > now) lines.push(`🛡️ Shield: **${effects.shield.blocksLeft} block(s)** remaining`);
  for (const p of effects.passiveIncome||[]) { if (!p.expiresAt || p.expiresAt > now) lines.push(`💰 ${p.itemName}: **$${p.amountPerTick}** / ${Math.ceil(p.intervalMs/60000)}min`); }
  if ((effects.drainStack||1) > 1) lines.push(`⚡ Drain Stack: **${effects.drainStack.toFixed(2)}×** (you're debuffed!)`);
  return lines;
}

module.exports = { executeEffect, tickPassiveIncome, getEffectsSummary, getUserEffects, saveUserEffects };
