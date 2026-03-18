// ============================================================
// utils/permissions.js — Role-based permission checker
//
// TEACHES: Array methods, role checking in Discord.js,
//          bitwise permissions, how GuildMember roles work
// ============================================================

const { getConfig } = require('./db');

/**
 * Permission types that can be assigned to mod roles
 * These are the keys stored in config.modRoles[roleId]
 */
const PERMISSIONS = {
  PURGE: 'canPurge',    // start/end the purge event
  KICK: 'canKick',      // kick members
  BAN: 'canBan',        // ban members
  MUTE: 'canMute',      // timeout members
  WARN: 'canWarn',      // warn members (logged)
};

/**
 * Check if a GuildMember has a specific mod permission
 * Admins always pass — they have everything
 *
 * @param {GuildMember} member - Discord.js GuildMember object
 * @param {string} permission - one of the PERMISSIONS values above
 * @returns {boolean}
 */
function hasPermission(member, permission) {
  // Discord server administrators bypass all custom permission checks
  if (member.permissions.has('Administrator')) return true;

  const config = getConfig();

  // member.roles.cache is a Collection of all roles the member has
  // .some() returns true if AT LEAST ONE item passes the test
  return member.roles.cache.some((role) => {
    const modRole = config.modRoles[role.id];
    // modRole exists AND has this permission set to true
    return modRole && modRole[permission] === true;
  });
}

/**
 * Check if a member can use the purge command specifically
 */
function canStartPurge(member) {
  return hasPermission(member, PERMISSIONS.PURGE);
}

/**
 * Check if a member can use restricted commands (hitman, give money, etc.)
 * Admins always pass. If no restrictedRoleId is set, everyone can use them.
 */
function isRestricted(member) {
  const { getConfig } = require('./db');
  const config = getConfig();
  if (!config.restrictedRoleId) return false; // no restriction set — open to all
  if (member.permissions.has('Administrator')) return false; // admins always pass
  return !member.roles.cache.has(config.restrictedRoleId);
}

module.exports = { hasPermission, canStartPurge, isRestricted, PERMISSIONS };
