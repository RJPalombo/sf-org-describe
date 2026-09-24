/**
 * CLI authentication: device-flow login into a saved alias, and reconnecting
 * to a saved alias with its refresh token (no browser needed).
 */
const jsforce = require('jsforce');
const salesforce = require('../src/salesforce');
const store = require('./store');

const PRODUCTION_URL = 'https://login.salesforce.com';
const SANDBOX_URL = 'https://test.salesforce.com';
const DEFAULT_CLIENT_ID = 'PlatformCLI';

/**
 * Accepts "acme.my.salesforce.com", "https://acme.my.salesforce.com/", or a full
 * Lightning URL and returns just the https origin (same rules as the desktop app)
 */
function normalizeDomain(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed);
    return 'https://' + url.hostname.replace(/\.lightning\.force\.com$/i, '.my.salesforce.com');
  } catch (e) {
    return null;
  }
}

/**
 * Work out the login URL from flags, falling back to what the alias used last time
 */
function resolveLoginUrl({ domain, sandbox } = {}, saved) {
  if (domain) {
    const url = normalizeDomain(domain);
    if (!url) throw new Error(`"${domain}" is not a valid domain. Use something like yourdomain.my.salesforce.com`);
    return url;
  }
  if (sandbox) return SANDBOX_URL;
  if (saved && saved.loginUrl) return saved.loginUrl;
  return PRODUCTION_URL;
}

/**
 * Client ID precedence: --client-id flag, the alias's saved value, SF_CLIENT_ID, then PlatformCLI
 */
function resolveClientId(flagValue, saved) {
  if (flagValue) return { clientId: flagValue, source: '--client-id flag' };
  if (saved && saved.clientId) return { clientId: saved.clientId, source: 'saved with this org alias' };
  if (process.env.SF_CLIENT_ID) return { clientId: process.env.SF_CLIENT_ID, source: 'SF_CLIENT_ID environment variable' };
  return { clientId: DEFAULT_CLIENT_ID, source: 'built-in default (PlatformCLI)' };
}

/**
 * Step 1 of the device flow: get a code for the user to enter in the browser.
 * The device code is saved so the login can be finished by a separate process (--resume).
 */
async function startLogin(alias, options = {}) {
  // Reuse settings from a finished login, or from an earlier attempt that was never approved
  const saved = store.getOrg(alias) || store.getPending(alias);
  const loginUrl = resolveLoginUrl(options, saved);
  const { clientId, source } = resolveClientId(options.clientId, saved);

  salesforce.setClientId(clientId, source);
  const flow = await salesforce.startDeviceFlow(loginUrl);
  // Salesforce doesn't always send expires_in; its device codes last about 10 minutes
  const expiresIn = Number(flow.expiresIn) > 0 ? Number(flow.expiresIn) : 600;

  store.savePending(alias, {
    deviceCode: flow.deviceCode,
    userCode: flow.userCode,
    verificationUri: flow.verificationUri,
    interval: flow.interval,
    expiresAt: Date.now() + expiresIn * 1000,
    loginUrl,
    clientId,
    clientIdSource: source,
    setDefault: !!options.setDefault
  });

  return {
    alias,
    userCode: flow.userCode,
    verificationUri: flow.verificationUri,
    expiresIn,
    loginUrl
  };
}

/**
 * Step 2 of the device flow: poll until the user approves, then save the alias
 */
async function finishLogin(alias, { onWaiting } = {}) {
  const pending = store.getPending(alias);
  if (!pending) {
    throw new Error(`No login in progress for "${alias}". Start one with: sfod login --alias ${alias}`);
  }

  salesforce.setClientId(pending.clientId, pending.clientIdSource);

  while (true) {
    if (Date.now() > pending.expiresAt) {
      store.clearPending(alias);
      throw new Error(`The login code for "${alias}" expired. Start again with: sfod login --alias ${alias}`);
    }
    try {
      const orgInfo = await salesforce.pollDeviceFlow(pending.deviceCode, pending.loginUrl);
      const conn = salesforce.getConnection();

      store.saveOrg(alias, {
        username: orgInfo.username,
        orgId: orgInfo.orgId,
        displayName: orgInfo.displayName,
        instanceUrl: orgInfo.instanceUrl,
        loginUrl: pending.loginUrl,
        clientId: pending.clientId,
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken,
        lastLogin: new Date().toISOString()
      }, { makeDefault: pending.setDefault });
      store.clearPending(alias);

      if (!conn.refreshToken) {
        orgInfo.warning = 'Salesforce did not return a refresh token, so this login will stop working when the session expires. Make sure the Connected App grants the refresh_token scope.';
      }
      return { alias, ...orgInfo };
    } catch (error) {
      if (error.message !== 'authorization_pending') {
        store.clearPending(alias);
        throw error;
      }
      if (onWaiting) onWaiting();
      await new Promise(resolve => setTimeout(resolve, pending.interval * 1000));
    }
  }
}

/**
 * Connect to a saved org. jsforce refreshes the access token automatically
 * when it expires, and the new token is written back to the store.
 */
async function connect(aliasOrUsername) {
  const target = aliasOrUsername || process.env.SFOD_TARGET_ORG || store.getDefaultOrg();
  if (!target) {
    throw new Error('No org specified and no default org set. Log in with: sfod login --alias <name>');
  }
  const org = store.findOrg(target);
  if (!org) {
    throw new Error(`No saved org named "${target}". Run "sfod org list" to see saved orgs, or log in with: sfod login --alias ${target}`);
  }

  salesforce.setClientId(org.clientId, 'saved with this org alias');
  const conn = new jsforce.Connection({
    instanceUrl: org.instanceUrl,
    accessToken: org.accessToken,
    refreshToken: org.refreshToken,
    oauth2: { clientId: org.clientId, loginUrl: org.loginUrl }
  });
  conn.on('refresh', (accessToken) => {
    store.saveOrg(org.alias, { accessToken });
  });

  const orgInfo = {
    orgId: org.orgId,
    username: org.username,
    displayName: org.displayName,
    instanceUrl: org.instanceUrl
  };
  salesforce.setConnection(conn, orgInfo);
  return { alias: org.alias, ...orgInfo };
}

module.exports = {
  normalizeDomain,
  resolveLoginUrl,
  resolveClientId,
  startLogin,
  finishLogin,
  connect
};
