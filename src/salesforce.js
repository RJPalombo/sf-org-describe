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
    hint = `The Connected App rejected the request. If it requires a Consumer Secret, this device flow cannot use it — create an app configured for the device flow instead.`;
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
  disconnect,
  getConnectionStatus,
  getAllObjects,
  describeObjects,
  describeObject,
  getConnection,
  setConnection,
  setClientId
};
