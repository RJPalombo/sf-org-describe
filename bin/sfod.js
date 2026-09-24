#!/usr/bin/env node
/**
 * sfod - SF Org Describe command line interface
 *
 * Scriptable access to the same metadata export and ERD features as the
 * desktop app. Run with no arguments in a terminal for an interactive shell.
 */
const path = require('path');
const { parseArgs } = require('util');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const auth = require('../cli/auth');
const commands = require('../cli/commands');
const store = require('../cli/store');

const HELP = `sfod - SF Org Describe CLI

Usage: sfod <command> [flags]

Orgs
  login                 Log in to an org with the device flow and save it as an alias
  org list              List saved orgs
  org display           Check a saved login and show its details
  org set-default <a>   Make an alias the default org
  org logout            Remove a saved org

Metadata
  objects               List objects in the org
  export excel          Export object metadata to an Excel workbook (one sheet per object)
  export json           Export raw describe metadata as JSON
  erd                   Generate a Mermaid ERD

  shell                 Start the interactive shell (also the default in a terminal)

Common flags
  -o, --target-org <alias>   Org alias or username (default: the default org, or SFOD_TARGET_ORG)
      --json                 Print machine-readable JSON to stdout
  -h, --help                 Show help for a command
  -v, --version              Show the sfod version

Run "sfod <command> --help" for command flags. Full guide: docs/CLI.md`;

const COMMAND_HELP = {
  login: `sfod login --alias <name> [flags]

Log in with the OAuth device flow. The domain and Client ID are saved with the
alias, so "sfod login --alias <name>" later reuses them.

  -a, --alias <name>       Name to save the org under (required)
  -d, --domain <domain>    My Domain, e.g. acme.my.salesforce.com (required for External Client Apps)
      --sandbox            Log in via test.salesforce.com
  -c, --client-id <id>     Connected App / External Client App Consumer Key
  -s, --set-default        Make this the default org
      --no-browser         Don't open the browser automatically
      --no-wait            Print the code and exit; finish later with --resume (for agents)
      --resume             Wait for a login started with --no-wait to be approved
      --json               JSON output`,
  objects: `sfod objects [flags]

  -o, --target-org <alias>   Org to use
      --custom               Only custom objects
      --standard             Only standard objects
      --match <pattern>      Filter by API name, wildcards allowed (e.g. "*__c", "Account*")
      --json                 JSON output`,
  export: `sfod export excel|json [flags]

  -o, --target-org <alias>   Org to use
      --objects <list>       Comma-separated API names; wildcards allowed ("Account,Contact,*__c")
      --objects-file <path>  File with one object per line (# comments allowed)
      --custom               All custom objects
      --all                  Every object in the org
      --exclude <list>       Names or wildcards to leave out ("*__Share,*History")
  -f, --output-file <path>   Where to write (excel default: Salesforce_Metadata_<alias>_<date>.xlsx;
                             json default: stdout)
      --json                 JSON summary output`,
  erd: `sfod erd [flags]

  -o, --target-org <alias>   Org to use
      --objects, --objects-file, --custom, --exclude   Root objects (same as export)
      --depth <1-5>          Relationship levels to follow (default 2)
      --selected-only        Only show the chosen objects, no traversal
      --compact              Object names only, no fields
      --max-objects <n>      Stop after n objects
      --max-fields <n>       Fields shown per object (default 8)
  -f, --output-file <path>   .md (fenced) or .mmd (raw). Default: print Mermaid to stdout
      --json                 JSON output`,
  org: `sfod org list | display | set-default <alias> | logout

  -o, --target-org <alias>   Org for display / logout (default: the default org)
      --json                 JSON output`
};

const OPTIONS = {
  'target-org': { type: 'string', short: 'o' },
  alias: { type: 'string', short: 'a' },
  domain: { type: 'string', short: 'd' },
  'instance-url': { type: 'string' },
  sandbox: { type: 'boolean' },
  'client-id': { type: 'string', short: 'c' },
  'set-default': { type: 'boolean', short: 's' },
  'no-browser': { type: 'boolean' },
  'no-wait': { type: 'boolean' },
  resume: { type: 'boolean' },
  objects: { type: 'string', multiple: true },
  'objects-file': { type: 'string' },
  custom: { type: 'boolean' },
  standard: { type: 'boolean' },
  all: { type: 'boolean' },
  exclude: { type: 'string', multiple: true },
  match: { type: 'string' },
  'output-file': { type: 'string', short: 'f' },
  depth: { type: 'string' },
  'selected-only': { type: 'boolean' },
  compact: { type: 'boolean' },
  'max-objects': { type: 'string' },
  'max-fields': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' }
};

function toCamel(flags) {
  return Object.fromEntries(Object.entries(flags).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
}

// Progress and prompts go to stderr so stdout stays clean for pipes and --json
function info(message) {
  process.stderr.write(message + '\n');
}

function progress(done, total) {
  if (process.stderr.isTTY) {
    process.stderr.write(`\rDescribing objects: ${done}/${total}${done === total ? '\n' : ''}`);
  }
}

function printTable(rows, columns) {
  if (!rows.length) return;
  const widths = columns.map(col => Math.max(col.label.length, ...rows.map(r => String(r[col.key] ?? '').length)));
  const line = (cells) => cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(columns.map(c => c.label)));
  console.log(line(widths.map(w => '─'.repeat(w))));
  rows.forEach(row => console.log(line(columns.map(c => row[c.key]))));
}

async function openBrowser(url) {
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch (e) {
    // Not fatal: the URL is printed anyway
  }
}

async function runLogin(flags) {
  if (!flags.alias) throw commands.usageError('--alias is required, e.g. sfod login --alias prod');
  const alias = flags.alias;

  if (!flags.resume) {
    const started = await auth.startLogin(alias, {
      domain: flags.domain || flags.instanceUrl,
      sandbox: flags.sandbox,
      clientId: flags.clientId,
      setDefault: flags.setDefault
    });

    if (flags.noWait) {
      if (flags.json) return started;
      info(`Open ${started.verificationUri} and enter code ${started.userCode}`);
      info(`Then run: sfod login --alias ${alias} --resume`);
      return null;
    }

    const message = `Log in to ${started.loginUrl.replace('https://', '')}:\n  1. Open ${started.verificationUri}\n  2. Enter code: ${started.userCode}\n\nWaiting for approval...`;
    info(message);
    if (!flags.noBrowser) await openBrowser(started.verificationUri);
  }

  const result = await auth.finishLogin(alias);
  if (flags.json) return result;
  info(`\nLogged in as ${result.username} (${result.instanceUrl}), saved as "${alias}"${store.getDefaultOrg() === alias ? ' [default]' : ''}`);
  if (result.warning) info(`Warning: ${result.warning}`);
  return null;
}

async function run(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  const flags = toCamel(values);
  const [command, subcommand, arg] = positionals;

  if (flags.version || command === 'version') {
    const { version } = require('../package.json');
    if (flags.json) return console.log(JSON.stringify({ status: 0, result: { version, node: process.version } }, null, 2));
    return console.log(`sfod ${version} (node ${process.version})`);
  }

  if (!command || command === 'shell') {
    if (flags.help) return console.log(HELP);
    if (!command && !process.stdin.isTTY) return console.log(HELP);
    return require('../cli/interactive').start();
  }
  if (command === 'help') return console.log(COMMAND_HELP[subcommand] || HELP);
  if (flags.help) return console.log(COMMAND_HELP[command] || HELP);

  const output = (result, printHuman) => {
    if (flags.json) {
      console.log(JSON.stringify({ status: 0, result }, null, 2));
    } else if (result !== null && result !== undefined) {
      printHuman(result);
    }
  };

  switch (command) {
    case 'login':
      return output(await runLogin(flags), () => {});

    case 'org':
      switch (subcommand) {
        case 'list':
          return output(commands.listOrgs(), (orgs) => {
            if (!orgs.length) return info('No saved orgs. Log in with: sfod login --alias <name>');
            printTable(orgs.map(o => ({ ...o, alias: (o.isDefault ? '* ' : '  ') + o.alias })), [
              { key: 'alias', label: '  ALIAS' },
              { key: 'username', label: 'USERNAME' },
              { key: 'loginUrl', label: 'LOGIN URL' },
              { key: 'clientId', label: 'CLIENT ID' }
            ]);
          });
        case 'display':
          return output(await commands.displayOrg(flags), (org) => {
            Object.entries(org).forEach(([k, v]) => console.log(`${k.padEnd(18)}${typeof v === 'object' ? JSON.stringify(v) : v}`));
          });
        case 'set-default':
          return output(commands.setDefault(arg), (r) => info(`Default org is now "${r.defaultOrg}"`));
        case 'logout':
          return output(commands.logout(flags), (r) => info(`Removed saved org "${r.alias}"`));
        default:
          throw commands.usageError(COMMAND_HELP.org);
      }

    case 'objects':
      return output(await commands.listObjects(flags), (objects) => {
        printTable(objects.map(o => ({ ...o, custom: o.custom ? 'yes' : '' })), [
          { key: 'name', label: 'API NAME' },
          { key: 'label', label: 'LABEL' },
          { key: 'custom', label: 'CUSTOM' }
        ]);
        info(`\n${objects.length} objects`);
      });

    case 'export':
      if (subcommand === 'excel') {
        return output(await commands.exportExcel(flags, { onProgress: progress }), (r) => {
          info(`Exported ${r.objectCount} objects to ${r.outputFile}`);
        });
      }
      if (subcommand === 'json') {
        const result = await commands.exportJson(flags, { onProgress: progress });
        if (!flags.outputFile && !flags.json) return console.log(JSON.stringify(result.objects, null, 2));
        return output(result, (r) => info(`Exported ${r.objectCount} objects to ${r.outputFile}`));
      }
      throw commands.usageError(COMMAND_HELP.export);

    case 'erd':
      return output(await commands.generateErd(flags), (r) => {
        if (r.outputFile) {
          info(`Wrote ERD with ${r.objectsIncluded.length} objects and ${r.relationshipCount} relationships to ${r.outputFile}`);
        } else {
          console.log(r.mermaidCode);
        }
        if (r.truncated) info('Note: stopped at --max-objects; some related objects were left out.');
      });

    default:
      throw commands.usageError(`Unknown command "${command}"\n\n${HELP}`);
  }
}

run(process.argv.slice(2)).catch((error) => {
  const exitCode = error.exitCode || (error.code && String(error.code).startsWith('ERR_PARSE_ARGS') ? 2 : 1);
  let message = error.message;
  if (process.argv[2] !== 'login' && /expired access\/refresh token|INVALID_SESSION_ID/i.test(message)) {
    message += '\n\nThe saved login is no longer valid. Log in again with: sfod login --alias <alias>';
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ status: exitCode, name: error.details?.code || error.name, message }, null, 2));
  } else {
    info(`Error: ${message}`);
  }
  process.exit(exitCode);
});
