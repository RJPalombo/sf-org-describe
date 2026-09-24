/**
 * Saved org aliases and settings, shared by the desktop app and the sfod CLI.
 *
 * Each alias remembers the login domain, the Client ID used to authenticate,
 * and the OAuth refresh token, so repeat logins don't need a browser.
 * "settings" holds the defaults both use for new logins (Client ID, My Domain).
 * Stored in ~/.sf-org-describe/orgs.json (override the folder with SFOD_HOME).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function homeDir() {
  return process.env.SFOD_HOME || path.join(os.homedir(), '.sf-org-describe');
}

function storePath() {
  return path.join(homeDir(), 'orgs.json');
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    return { defaultOrg: data.defaultOrg || null, orgs: data.orgs || {}, pending: data.pending || {}, settings: data.settings || {} };
  } catch (e) {
    if (e.code === 'ENOENT') return { defaultOrg: null, orgs: {}, pending: {}, settings: {} };
    throw new Error(`Could not read ${storePath()}: ${e.message}`);
  }
}

function save(data) {
  fs.mkdirSync(homeDir(), { recursive: true, mode: 0o700 });
  // Tokens live in this file, so keep it readable by the current user only
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(storePath(), 0o600);
}

function listOrgs() {
  const { defaultOrg, orgs } = load();
  return Object.entries(orgs).map(([alias, org]) => ({ alias, isDefault: alias === defaultOrg, ...org }));
}

function getOrg(alias) {
  return load().orgs[alias] || null;
}

/**
 * Find a saved org by alias or username
 */
function findOrg(aliasOrUsername) {
  const { orgs } = load();
  if (orgs[aliasOrUsername]) return { alias: aliasOrUsername, ...orgs[aliasOrUsername] };
  const match = Object.entries(orgs).find(([, org]) => org.username === aliasOrUsername);
  return match ? { alias: match[0], ...match[1] } : null;
}

function saveOrg(alias, org, { makeDefault = false } = {}) {
  const data = load();
  data.orgs[alias] = { ...data.orgs[alias], ...org };
  if (makeDefault || !data.defaultOrg) data.defaultOrg = alias;
  save(data);
}

function removeOrg(alias) {
  const data = load();
  if (!data.orgs[alias]) return false;
  delete data.orgs[alias];
  if (data.defaultOrg === alias) data.defaultOrg = Object.keys(data.orgs)[0] || null;
  save(data);
  return true;
}

function setDefaultOrg(alias) {
  const data = load();
  if (!data.orgs[alias]) throw new Error(`No saved org named "${alias}". Run "sfod org list" to see saved orgs.`);
  data.defaultOrg = alias;
  save(data);
}

function getDefaultOrg() {
  return load().defaultOrg;
}

/**
 * A device login started with --no-wait, finished later with --resume
 */
function savePending(alias, pending) {
  const data = load();
  data.pending[alias] = pending;
  save(data);
}

function getPending(alias) {
  return load().pending[alias] || null;
}

function clearPending(alias) {
  const data = load();
  if (!data.pending[alias]) return;
  delete data.pending[alias];
  save(data);
}

/**
 * Shared defaults for new logins: { clientId, customDomain }
 */
function getSettings() {
  return load().settings;
}

/**
 * Merge settings; a null or empty value removes that setting
 */
function saveSettings(changes) {
  const data = load();
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '') delete data.settings[key];
    else data.settings[key] = value;
  }
  save(data);
  return data.settings;
}

module.exports = {
  storePath,
  listOrgs,
  getOrg,
  findOrg,
  saveOrg,
  removeOrg,
  setDefaultOrg,
  getDefaultOrg,
  savePending,
  getPending,
  clearPending,
  getSettings,
  saveSettings
};
