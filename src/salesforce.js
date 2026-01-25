const jsforce = require('jsforce');
const https = require('https');

// Connected App Client ID - loaded from environment variable
// Users can set SF_CLIENT_ID in a .env file or environment
const CLIENT_ID = process.env.SF_CLIENT_ID;

if (!CLIENT_ID) {
  console.error('SF_CLIENT_ID environment variable is not set. Please create a .env file with your Connected App Client ID.');
}

let connection = null;
let orgInfo = null;

/**
 * Start OAuth 2.0 Device Flow
 * This mimics how Salesforce Data Loader authenticates
 */
async function startDeviceFlow(loginUrl = 'https://login.salesforce.com') {
  return new Promise((resolve, reject) => {
    const postData = `response_type=device_code&client_id=${CLIENT_ID}&scope=api refresh_token`;

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
            reject(new Error(result.error_description || result.error));
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
    const postData = `grant_type=device&client_id=${CLIENT_ID}&code=${deviceCode}`;

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
            reject(new Error(result.error_description || result.error));
          } else {
            // Success! Create connection
            connection = new jsforce.Connection({
              instanceUrl: result.instance_url,
              accessToken: result.access_token,
              refreshToken: result.refresh_token,
              oauth2: {
                clientId: CLIENT_ID,
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
  startDeviceFlow,
  pollDeviceFlow,
  disconnect,
  getConnectionStatus,
  getAllObjects,
  describeObjects,
  describeObject,
  getConnection
};
