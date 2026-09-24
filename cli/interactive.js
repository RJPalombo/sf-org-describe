/**
 * Interactive shell: guided menus over the same commands the scripted CLI uses.
 * After each action it prints the equivalent sfod command so it can be scripted.
 */
const readline = require('readline/promises');
const auth = require('./auth');
const commands = require('./commands');
const store = require('./store');
const salesforce = require('../src/salesforce');

let rl;

async function ask(question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || '';
}

async function choose(question, options) {
  console.log(`\n${question}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt.label}`));
  while (true) {
    const answer = await ask('Choose', '1');
    const index = Number(answer) - 1;
    if (options[index]) return options[index].value;
    console.log(`Enter a number from 1 to ${options.length}`);
  }
}

// Wildcards are quoted too, otherwise zsh/bash expand them before sfod sees them
function quote(value) {
  return /^[\w.,\/:@-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

function showCommand(parts) {
  console.log(`\nTo repeat this from a script:\n  sfod ${parts.filter(Boolean).join(' ')}`);
}

async function login() {
  const alias = await ask('Alias for this org (e.g. prod, uat)');
  if (!alias) return null;
  const saved = store.getOrg(alias);

  const environment = await choose('Where do you log in?', [
    ...(saved ? [{ label: `Same as last time (${saved.loginUrl})`, value: 'saved' }] : []),
    { label: 'Production (login.salesforce.com)', value: 'production' },
    { label: 'Sandbox (test.salesforce.com)', value: 'sandbox' },
    { label: 'Custom Domain / My Domain (required for External Client Apps)', value: 'custom' }
  ]);

  const options = {};
  if (environment === 'sandbox') options.sandbox = true;
  if (environment === 'production') options.domain = 'login.salesforce.com';
  if (environment === 'custom') {
    options.domain = await ask('My Domain', saved && !/(login|test)\.salesforce\.com/.test(saved.loginUrl) ? saved.loginUrl.replace('https://', '') : undefined);
  }

  const current = auth.resolveClientId(null, saved);
  const clientId = await ask(`Client ID (Enter keeps ${current.clientId === 'PlatformCLI' ? 'the default PlatformCLI' : 'the saved one'})`);
  if (clientId) options.clientId = clientId;

  options.setDefault = !store.getDefaultOrg() || (await ask('Make this the default org? (y/n)', 'n')).toLowerCase().startsWith('y');

  const started = await auth.startLogin(alias, options);
  console.log(`\n  1. Open ${started.verificationUri}\n  2. Enter code: ${started.userCode}\n\nWaiting for approval...`);
  try {
    const { default: open } = await import('open');
    await open(started.verificationUri);
  } catch (e) {}

  const result = await auth.finishLogin(alias);
  console.log(`Logged in as ${result.username}, saved as "${alias}"`);
  if (result.warning) console.log(`Warning: ${result.warning}`);

  showCommand(['login', '--alias', quote(alias),
    options.sandbox && '--sandbox',
    options.domain && `--domain ${quote(options.domain)}`,
    options.clientId && `--client-id ${quote(options.clientId)}`,
    options.setDefault && '--set-default']);
  return alias;
}

async function pickOrg() {
  const orgs = store.listOrgs();
  const choice = await choose('Which org?', [
    ...orgs.map(o => ({ label: `${o.alias}${o.isDefault ? ' (default)' : ''} - ${o.username}`, value: o.alias })),
    { label: 'Log in to a new org', value: null }
  ]);
  return choice || login();
}

async function pickObjects() {
  console.log('\nObjects: API names separated by commas; wildcards work (e.g. Account,Contact,*__c).');
  console.log('Or type "custom" for all custom objects, "all" for every object, "list" to see them.');
  while (true) {
    const answer = await ask('Objects');
    if (!answer) continue;
    if (answer === 'list') {
      const objects = await salesforce.getAllObjects();
      console.log(objects.map(o => o.name).join(', '));
      continue;
    }
    const selection = answer === 'custom' ? { custom: true } : answer === 'all' ? { all: true } : { objects: answer };
    try {
      const names = await commands.selectObjects(selection);
      console.log(`${names.length} object${names.length === 1 ? '' : 's'} selected`);
      const flag = selection.custom ? '--custom' : selection.all ? '--all' : `--objects ${quote(answer.replace(/\s+/g, ''))}`;
      return { selection, flag };
    } catch (e) {
      console.log(e.message);
    }
  }
}

function progress(done, total) {
  process.stdout.write(`\rDescribing objects: ${done}/${total}${done === total ? '\n' : ''}`);
}

async function runAction(alias, action) {
  if (action === 'objects') {
    const objects = await commands.listObjects({ targetOrg: alias });
    objects.forEach(o => console.log(`${o.name.padEnd(45)}${o.label}${o.custom ? '  [custom]' : ''}`));
    console.log(`\n${objects.length} objects`);
    return showCommand(['objects', '-o', quote(alias)]);
  }

  const { selection, flag } = await pickObjects();

  if (action === 'excel' || action === 'json') {
    const ext = action === 'excel' ? 'xlsx' : 'json';
    const outputFile = await ask('Save to', `Salesforce_Metadata_${alias}_${new Date().toISOString().split('T')[0]}.${ext}`);
    const run = action === 'excel' ? commands.exportExcel : commands.exportJson;
    const result = await run({ targetOrg: alias, ...selection, outputFile }, { onProgress: progress });
    console.log(`Exported ${result.objectCount} objects to ${result.outputFile}`);
    return showCommand(['export', action, '-o', quote(alias), flag, '-f', quote(outputFile)]);
  }

  if (action === 'erd') {
    const depth = await ask('Relationship depth (1-5)', '2');
    const outputFile = await ask('Save to (.md or .mmd)', `ERD_${alias}_${new Date().toISOString().split('T')[0]}.md`);
    const result = await commands.generateErd({ targetOrg: alias, ...selection, depth, outputFile });
    console.log(`Wrote ERD with ${result.objectsIncluded.length} objects and ${result.relationshipCount} relationships to ${result.outputFile}`);
    return showCommand(['erd', '-o', quote(alias), flag, '--depth', depth, '-f', quote(outputFile)]);
  }
}

async function start() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => {
    rl.close();
    process.exit(130);
  });

  console.log('SF Org Describe - interactive shell (Ctrl+C to exit)');
  let alias = null;

  try {
    while (!alias) {
      try {
        alias = await pickOrg();
        if (alias) await auth.connect(alias);
      } catch (e) {
        console.log(`\nError: ${e.message}`);
        alias = null;
      }
    }

    while (true) {
      const action = await choose(`[${alias}] What would you like to do?`, [
        { label: 'Export metadata to Excel', value: 'excel' },
        { label: 'Export metadata to JSON', value: 'json' },
        { label: 'Generate an ERD (Mermaid)', value: 'erd' },
        { label: 'List objects', value: 'objects' },
        { label: 'Switch org / log in', value: 'switch' },
        { label: 'Quit', value: 'quit' }
      ]);
      if (action === 'quit') break;
      try {
        if (action === 'switch') {
          const next = await pickOrg();
          if (next) {
            await auth.connect(next);
            alias = next;
          }
        } else {
          await runAction(alias, action);
        }
      } catch (e) {
        console.log(`\nError: ${e.message}`);
      }
    }
  } finally {
    rl.close();
  }
}

module.exports = { start };
