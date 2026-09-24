/**
 * CLI command implementations. Each returns plain data; bin/sfod.js decides
 * whether to print it as text or JSON.
 */
const fs = require('fs');
const path = require('path');
const salesforce = require('../src/salesforce');
const excelExport = require('../src/excel-export');
const erdGenerator = require('../src/erd-generator');
const auth = require('../src/org-auth');
const store = require('../src/org-store');

const DESCRIBE_BATCH_SIZE = 25;

function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Turn "Account", "*__c" or "Contact*" into a case-insensitive matcher
 */
function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function splitList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(v => v.split(/[,\s]+/)).map(v => v.trim()).filter(Boolean);
}

/**
 * Read object names from a file: one per line (commas also work), # starts a comment
 */
function readObjectsFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return splitList(text.split('\n').map(line => line.replace(/#.*/, '')).join('\n'));
}

/**
 * Resolve the object selection flags against the org's object list.
 * Exact names that don't exist are an error, so a typo never silently drops an object.
 */
async function selectObjects({ objects, objectsFile, custom, all, exclude } = {}) {
  const patterns = [...splitList(objects), ...(objectsFile ? readObjectsFile(objectsFile) : [])];
  if (!patterns.length && !custom && !all) {
    throw usageError('Choose objects with --objects, --objects-file, --custom or --all');
  }

  const available = await salesforce.getAllObjects();
  const selected = new Map();

  if (all) available.forEach(obj => selected.set(obj.name, obj));
  if (custom) available.filter(obj => obj.custom).forEach(obj => selected.set(obj.name, obj));

  const missing = [];
  for (const pattern of patterns) {
    const regex = patternToRegex(pattern);
    const matches = available.filter(obj => regex.test(obj.name));
    if (!matches.length && !/[*?]/.test(pattern)) missing.push(pattern);
    matches.forEach(obj => selected.set(obj.name, obj));
  }
  if (missing.length) {
    throw new Error(`Object${missing.length > 1 ? 's' : ''} not found in this org: ${missing.join(', ')}`);
  }

  const excludes = splitList(exclude).map(patternToRegex);
  const names = Array.from(selected.keys())
    .filter(name => !excludes.some(regex => regex.test(name)))
    .sort((a, b) => a.localeCompare(b));

  if (!names.length) throw new Error('No objects matched the selection');
  return names;
}

async function describeWithProgress(names, onProgress) {
  const descriptions = [];
  for (let i = 0; i < names.length; i += DESCRIBE_BATCH_SIZE) {
    const batch = names.slice(i, i + DESCRIBE_BATCH_SIZE);
    descriptions.push(...await salesforce.describeObjects(batch));
    if (onProgress) onProgress(descriptions.length, names.length);
  }
  return descriptions;
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

// ---- Commands ----

async function listObjects(flags) {
  await auth.connect(flags.targetOrg);
  let objects = await salesforce.getAllObjects();
  if (flags.custom) objects = objects.filter(obj => obj.custom);
  if (flags.standard) objects = objects.filter(obj => !obj.custom);
  if (flags.match) {
    const regex = patternToRegex(flags.match);
    objects = objects.filter(obj => regex.test(obj.name));
  }
  return objects;
}

async function exportExcel(flags, { onProgress } = {}) {
  const org = await auth.connect(flags.targetOrg);
  const names = await selectObjects(flags);
  const outputFile = path.resolve(flags.outputFile || `Salesforce_Metadata_${org.alias}_${today()}.xlsx`);

  const descriptions = await describeWithProgress(names, onProgress);
  await excelExport.exportToExcel(descriptions, outputFile);
  return { alias: org.alias, username: org.username, outputFile, objectCount: names.length, objects: names };
}

async function exportJson(flags, { onProgress } = {}) {
  const org = await auth.connect(flags.targetOrg);
  const names = await selectObjects(flags);
  const descriptions = await describeWithProgress(names, onProgress);

  if (!flags.outputFile) {
    return { alias: org.alias, username: org.username, objectCount: names.length, objects: descriptions };
  }
  const outputFile = path.resolve(flags.outputFile);
  fs.writeFileSync(outputFile, JSON.stringify(descriptions, null, 2));
  return { alias: org.alias, username: org.username, outputFile, objectCount: names.length, objects: names };
}

async function generateErd(flags) {
  const org = await auth.connect(flags.targetOrg);
  const names = await selectObjects(flags);
  const depth = flags.depth === undefined ? 2 : Number(flags.depth);
  if (!Number.isInteger(depth) || depth < 1 || depth > 5) throw usageError('--depth must be a whole number from 1 to 5');

  const erd = await erdGenerator.generateERD(salesforce, names, depth, {
    compact: !!flags.compact,
    selectedOnly: !!flags.selectedOnly,
    maxObjects: flags.maxObjects ? Number(flags.maxObjects) : null,
    maxFieldsPerObject: flags.maxFields ? Number(flags.maxFields) : undefined
  });

  const result = {
    alias: org.alias,
    rootObjects: names,
    objectsIncluded: erd.objectsIncluded,
    relationshipCount: erd.relationshipCount,
    truncated: erd.truncated,
    mermaidCode: erd.mermaidCode
  };
  if (flags.outputFile) {
    const outputFile = path.resolve(flags.outputFile);
    // .mmd is raw Mermaid; anything else gets a fenced block so it renders in Markdown viewers
    const content = /\.mmd$/i.test(outputFile) ? erd.mermaidCode : '```mermaid\n' + erd.mermaidCode + '\n```\n';
    fs.writeFileSync(outputFile, content);
    result.outputFile = outputFile;
  }
  return result;
}

function listOrgs() {
  return store.listOrgs().map(({ alias, isDefault, username, orgId, instanceUrl, loginUrl, clientId, lastLogin }) => ({
    alias, isDefault, username, orgId, instanceUrl, loginUrl,
    clientId: clientId === 'PlatformCLI' ? 'PlatformCLI (default)' : clientId,
    lastLogin
  }));
}

async function displayOrg(flags) {
  const org = await auth.connect(flags.targetOrg);
  // A cheap call that proves the saved login still works (and refreshes the token if needed)
  const conn = salesforce.getConnection();
  const limits = await conn.request('/services/data/v' + conn.version + '/limits');
  const saved = store.getOrg(org.alias);
  return {
    ...org,
    loginUrl: saved.loginUrl,
    clientId: saved.clientId,
    apiVersion: conn.version,
    connected: true,
    dailyApiRequests: { max: limits.DailyApiRequests.Max, remaining: limits.DailyApiRequests.Remaining }
  };
}

function logout(flags) {
  const alias = flags.targetOrg || store.getDefaultOrg();
  if (!alias) throw usageError('Specify the org to log out of with --target-org');
  const org = store.findOrg(alias);
  if (!org || !store.removeOrg(org.alias)) throw new Error(`No saved org named "${alias}"`);
  return { alias: org.alias, removed: true };
}

// Friendly names for the shared settings keys
const CONFIG_KEYS = { 'client-id': 'clientId', domain: 'customDomain' };

function config(action = 'list', key, value) {
  if (action !== 'list') {
    if (!CONFIG_KEYS[key]) throw usageError(`Unknown setting "${key || ''}". Settings: ${Object.keys(CONFIG_KEYS).join(', ')}`);
    if (action === 'set') {
      if (!value) throw usageError(`Usage: sfod config set ${key} <value>`);
      if (key === 'domain' && !auth.normalizeDomain(value)) throw usageError(`"${value}" is not a valid domain`);
      store.saveSettings({ [CONFIG_KEYS[key]]: value });
    } else if (action === 'unset') {
      store.saveSettings({ [CONFIG_KEYS[key]]: null });
    } else {
      throw usageError('Usage: sfod config list | set <key> <value> | unset <key>');
    }
  }
  const settings = store.getSettings();
  return { 'client-id': settings.clientId || null, domain: settings.customDomain || null };
}

function setDefault(alias) {
  if (!alias) throw usageError('Usage: sfod org set-default <alias>');
  store.setDefaultOrg(alias);
  return { defaultOrg: alias };
}

module.exports = {
  selectObjects,
  usageError,
  listObjects,
  exportExcel,
  exportJson,
  generateErd,
  listOrgs,
  displayOrg,
  logout,
  setDefault,
  config
};
