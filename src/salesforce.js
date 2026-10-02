const jsforce = require('jsforce');
const https = require('https');

// Salesforce CLI's public Connected App Client ID
// This is the same Client ID used by the official Salesforce CLI (sf/sfdx)
// It works across all Salesforce orgs without requiring users to create their own Connected App
const SFDX_CLIENT_ID = 'PlatformCLI';

// Default from environment, can be overridden at runtime
let customClientId = null;
let customClientIdSource = null;

/**
 * Resolve the Client ID along with where it came from, so auth failures can
 * say which credential was actually used (UI setting, .env, or the default).
 */
function getClientIdInfo() {
  if (customClientId) {
    return { clientId: customClientId, source: customClientIdSource || 'Advanced Settings in the app' };
  }
  if (process.env.SF_CLIENT_ID) {
    return { clientId: process.env.SF_CLIENT_ID, source: 'SF_CLIENT_ID in the .env file' };
  }
  return { clientId: SFDX_CLIENT_ID, source: 'built-in default (PlatformCLI)' };
}

function getClientId() {
  return getClientIdInfo().clientId;
}

/**
 * Show enough of a Client ID to identify it without logging the whole value
 */
function maskClientId(clientId) {
  if (!clientId) return '(empty)';
  if (clientId.length <= 16) return clientId;
  return `${clientId.slice(0, 8)}…${clientId.slice(-4)} (${clientId.length} chars)`;
}

/**
 * Turn a bare Salesforce OAuth error into something actionable.
 * Salesforce returns things like "client identifier invalid" with no clue
 * about which Client ID was sent or which endpoint rejected it.
 */
function buildAuthError(result, loginUrl) {
  const { clientId, source } = getClientIdInfo();
  const host = new URL(loginUrl).host;
  const code = result.error || 'unknown_error';
  const description = result.error_description || code;

  let hint;
  if (code === 'invalid_client_id') {
    hint = `${host} does not recognize this Consumer Key. Check that the Connected App exists and that you picked the right environment (Production uses login.salesforce.com, Sandbox uses test.salesforce.com). A newly created Connected App can take ~10 minutes to propagate.`;
  } else if (/device flow is not enabled/i.test(description)) {
    hint = `The Connected App exists but does not allow the device flow. In Setup → App Manager → your app → Edit → OAuth Settings, enable "Enable Device Flow", then save and wait ~10 minutes.`;
  } else if (code === 'invalid_client') {
    hint = `The Connected App rejected the request. If it requires a Consumer Secret, this app cannot use it. Turn off "Require secret for Web Server Flow" (browser login) or use an app configured for the device flow.`;
  } else if (/redirect_uri/i.test(code + description)) {
    hint = `Add ${BROWSER_CALLBACK_URL} as a Callback URL in the app's OAuth Settings, then wait a few minutes.`;
  } else if (/code challenge/i.test(description)) {
    hint = `The app requires PKCE, which the device flow can't send. Use "Log in with browser" (sfod login --browser) instead.`;
  }

  const lines = [
    `${description} (${code})`,
    ``,
    `Client ID: ${maskClientId(clientId)}`,
    `Source:    ${source}`,
    `Endpoint:  https://${host}/services/oauth2/token`
  ];
  if (hint) lines.push(``, hint);

  const error = new Error(lines.join('\n'));
  error.details = { code, description, clientIdSource: source, clientIdMasked: maskClientId(clientId), host };
  return error;
}

/**
 * Set a custom client ID (from UI settings, or from the CLI with its own source label)
 */
function setClientId(clientId, source) {
  customClientId = clientId || null;
  customClientIdSource = source || null;
}

let connection = null;
let orgInfo = null;

/**
 * Start OAuth 2.0 Device Flow
 * This mimics how Salesforce Data Loader authenticates
 */
async function startDeviceFlow(loginUrl = 'https://login.salesforce.com') {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      response_type: 'device_code',
      client_id: getClientId(),
      scope: 'api refresh_token'
    }).toString();

    const url = new URL(loginUrl);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: '/services/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            reject(buildAuthError(result, loginUrl));
          } else {
            resolve({
              deviceCode: result.device_code,
              userCode: result.user_code,
              verificationUri: result.verification_uri,
              expiresIn: result.expires_in,
              interval: Math.max(result.interval || 5, 8) // Minimum 8 seconds to avoid "polling too quickly"
            });
          }
        } catch (e) {
          reject(new Error('Failed to parse response: ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Poll for device flow completion
 */
async function pollDeviceFlow(deviceCode, loginUrl = 'https://login.salesforce.com') {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: 'device',
      client_id: getClientId(),
      code: deviceCode
    }).toString();

    const url = new URL(loginUrl);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: '/services/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error === 'authorization_pending') {
            reject(new Error('authorization_pending'));
          } else if (result.error) {
            reject(buildAuthError(result, loginUrl));
          } else {
            // Success! Create connection
            connection = new jsforce.Connection({
              instanceUrl: result.instance_url,
              accessToken: result.access_token,
              refreshToken: result.refresh_token,
              oauth2: {
                clientId: getClientId(),
                loginUrl: loginUrl
              }
            });

            // Get org info
            connection.identity().then((identity) => {
              orgInfo = {
                orgId: identity.organization_id,
                username: identity.username,
                displayName: identity.display_name,
                instanceUrl: result.instance_url
              };
              resolve(orgInfo);
            }).catch(reject);
          }
        } catch (e) {
          reject(new Error('Failed to parse response: ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Same callback the Salesforce CLI uses, so an app set up for sf works here too
const BROWSER_CALLBACK_PORT = 1717;
const BROWSER_CALLBACK_URL = `http://localhost:${BROWSER_CALLBACK_PORT}/OAuthRedirect`;
const BROWSER_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

// Only one browser login can hold the callback port at a time
let activeBrowserLogin = null;

function postToToken(loginUrl, params) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: new URL(loginUrl).hostname,
      port: 443,
      path: '/services/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse response: ' + data));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function callbackPage(title, message) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:-apple-system,Segoe UI,sans-serif;text-align:center;padding:60px">
<h2>${title}</h2><p>${message}</p></body>`;
}

/**
 * Log in with the OAuth web server flow plus PKCE: open the Salesforce login
 * page in a browser and catch the redirect on localhost. Works with External
 * Client Apps that require PKCE, which the device flow can't satisfy.
 * The app needs http://localhost:1717/OAuthRedirect as a callback URL.
 */
async function browserLogin(loginUrl, { openUrl }) {
  if (activeBrowserLogin) activeBrowserLogin.cancel();

  const http = require('http');
  const crypto = require('crypto');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  const clientId = getClientId();

  const authorizeUrl = new URL('/services/oauth2/authorize', loginUrl);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: BROWSER_CALLBACK_URL,
    scope: 'api refresh_token',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  }).toString();

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, BROWSER_CALLBACK_URL);
      res.setHeader('Connection', 'close');
      if (url.pathname !== '/OAuthRedirect') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        const description = url.searchParams.get('error_description') || '';
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(callbackPage('Login failed', 'Return to SF Org Describe for details.'));
        finish(buildAuthError({ error, error_description: description }, loginUrl));
      } else if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(callbackPage('Login failed', 'The response did not match this login. Try again.'));
        finish(new Error('Login response did not match the request (state mismatch). Try again.'));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(callbackPage('Logged in', 'You can close this tab and return to SF Org Describe.'));
        finish(null, url.searchParams.get('code'));
      }
    });

    const timer = setTimeout(() => finish(new Error('Timed out waiting for the browser login. Try again.')), BROWSER_LOGIN_TIMEOUT_MS);
    function finish(error, value) {
      clearTimeout(timer);
      // Drop keep-alive sockets too, or a retry's redirect can land on this finished server
      server.close();
      server.closeIdleConnections();
      activeBrowserLogin = null;
      error ? reject(error) : resolve(value);
    }
    activeBrowserLogin = { cancel: () => finish(new Error('Login cancelled')) };

    server.on('error', (e) => finish(e.code === 'EADDRINUSE'
      ? new Error(`Port ${BROWSER_CALLBACK_PORT} is in use (is another login, or the Salesforce CLI, waiting?). Close it and try again.`)
      : e));
    server.listen(BROWSER_CALLBACK_PORT, 'localhost', () => {
      Promise.resolve(openUrl(authorizeUrl.toString())).catch(() => {});
    });
  });

  const result = await postToToken(loginUrl, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: BROWSER_CALLBACK_URL,
    code_verifier: codeVerifier
  });
  if (result.error) throw buildAuthError(result, loginUrl);

  connection = new jsforce.Connection({
    instanceUrl: result.instance_url,
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    oauth2: { clientId, loginUrl }
  });
  const identity = await connection.identity();
  orgInfo = {
    orgId: identity.organization_id,
    username: identity.username,
    displayName: identity.display_name,
    instanceUrl: result.instance_url
  };
  return orgInfo;
}

/**
 * Disconnect from org
 */
function disconnect() {
  connection = null;
  orgInfo = null;
}

/**
 * Use an already-authenticated connection (the CLI restores saved logins this way)
 */
function setConnection(conn, info) {
  connection = conn;
  orgInfo = info;
}

/**
 * Get connection status
 */
function getConnectionStatus() {
  if (connection && orgInfo) {
    return {
      connected: true,
      orgInfo
    };
  }
  return { connected: false };
}

/**
 * Get all available SObjects
 */
async function getAllObjects() {
  if (!connection) {
    throw new Error('Not connected to Salesforce');
  }

  const result = await connection.describeGlobal();

  // Return sorted list with useful info
  return result.sobjects
    .map(obj => ({
      name: obj.name,
      label: obj.label,
      keyPrefix: obj.keyPrefix,
      custom: obj.custom,
      queryable: obj.queryable,
      createable: obj.createable,
      updateable: obj.updateable,
      deletable: obj.deletable
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Describe multiple SObjects
 */
async function describeObjects(objectNames) {
  if (!connection) {
    throw new Error('Not connected to Salesforce');
  }

  const descriptions = [];

  // Process in batches to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < objectNames.length; i += batchSize) {
    const batch = objectNames.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(name => connection.describe(name))
    );
    descriptions.push(...batchResults);
  }

  return descriptions;
}

/**
 * Describe a single object (used by ERD generator)
 */
async function describeObject(objectName) {
  if (!connection) {
    throw new Error('Not connected to Salesforce');
  }
  return await connection.describe(objectName);
}

/**
 * Get the jsforce connection (for advanced usage)
 */
function getConnection() {
  return connection;
}

module.exports = {
  getClientIdInfo,
  startDeviceFlow,
  pollDeviceFlow,
  browserLogin,
  BROWSER_CALLBACK_URL,
  disconnect,
  getConnectionStatus,
  getAllObjects,
  describeObjects,
  describeObject,
  getConnection,
  setConnection,
  setClientId
};
