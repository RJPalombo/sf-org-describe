# SF Org Describe CLI (`sfod`)

The `sfod` command gives you the desktop app's metadata export and ERD features from a terminal. You can use it three ways:

- **Interactive**: run `sfod` and follow the menus.
- **Scripted**: run single commands from shell scripts, cron jobs, or CI.
- **Agent-driven**: tools like Claude Code call `sfod` with `--json` and read structured results.

Like Salesforce CLI aliases, you log in to an org **once** and save it under an alias. The alias keeps the login domain, the Client ID (Consumer Key), and a refresh token, so later commands run without a browser.

The CLI and the desktop app **share the same saved orgs and settings**. An org you log in to in the app can be used right away with `sfod -o <alias>`, and an org saved with `sfod login` shows up on the app's Connect tab.

- [Install](#install)
- [Quick start](#quick-start)
- [Logging in and saved orgs](#logging-in-and-saved-orgs)
- [Choosing objects](#choosing-objects)
- [Commands](#commands)
- [Interactive shell](#interactive-shell)
- [Automation and agents](#automation-and-agents)
- [Example: keep an integration-mapping workbook current](#example-keep-an-integration-mapping-workbook-current)
- [Shared defaults (`sfod config`)](#shared-defaults-sfod-config)
- [Where credentials are stored](#where-credentials-are-stored)
- [Troubleshooting](#troubleshooting)

## Install

The CLI needs Node.js 18 or later. It ships in this repository alongside the desktop app.

```bash
git clone https://github.com/RJPalombo/sf-org-describe.git
cd sf-org-describe
npm install
npm link          # puts `sfod` on your PATH
```

If you'd rather not use `npm link`, run it through npm or node from the repo folder instead:

```bash
npm run cli -- objects --custom
node bin/sfod.js objects --custom
```

Check that it works:

```bash
sfod --version   # e.g. sfod 1.0.0 (node v26.3.0); add --json for machine-readable output
sfod --help
```

## Quick start

```bash
# 1. Log in once. A browser opens; enter the code shown in the terminal.
sfod login --alias prod --domain acme.my.salesforce.com --client-id 3MVG9...

# 2. Export metadata. No login prompt; the saved alias is used.
sfod export excel -o prod --custom -f ./acme-custom-objects.xlsx

# 3. Later, re-authenticate using the same domain and Client ID as before.
sfod login --alias prod
```

## Logging in and saved orgs

`sfod login` uses the same OAuth 2.0 Device Flow as the desktop app. The command prints a URL and a short code and opens your browser. Once you approve the login in Salesforce, the org is saved under the alias you chose.

```bash
sfod login --alias <name> [--domain <my-domain> | --sandbox] [--client-id <key>] [--set-default]
```

| Flag | Meaning |
| --- | --- |
| `-a, --alias` | Name to save the org under (required), e.g. `prod`, `uat`, `dev1` |
| `-d, --domain` | Your My Domain, e.g. `acme.my.salesforce.com`. Lightning URLs such as `acme.lightning.force.com` are converted automatically. **Required for External Client Apps.** |
| `--sandbox` | Log in through `test.salesforce.com` |
| `-c, --client-id` | Consumer Key of your Connected App or External Client App |
| `-s, --set-default` | Use this org when `--target-org` is not given |
| `--no-browser` | Print the URL but don't open a browser |
| `--no-wait` / `--resume` | Split the login into two steps (see [Automation and agents](#automation-and-agents)) |

### Saved settings are reused

Each alias keeps the **login domain** and the **Client ID** it was created with. Running `sfod login --alias prod` again without flags reuses both, so you don't retype a My Domain or a long Consumer Key. Passing a flag replaces the saved value for that alias.

To pick the Client ID for a login, `sfod` checks these sources in order:

1. `--client-id` flag
2. The value saved with the alias
3. The shared default Client ID, set with `sfod config set client-id` or in the app's **Advanced Settings** (see [Shared defaults](#shared-defaults-sfod-config))
4. `SF_CLIENT_ID` in the repository's `.env` file or your environment
5. The built-in default, `PlatformCLI`

Without `--domain` or `--sandbox`, a new alias logs in through `login.salesforce.com`.

### Managing saved orgs

```bash
sfod org list                  # all saved orgs; * marks the default
sfod org display -o prod       # checks the login still works and shows API usage
sfod org set-default prod      # use prod when -o is omitted
sfod org logout -o dev1        # remove a saved org and its tokens
```

### Choosing which org a command uses

Every metadata command takes `-o, --target-org <alias or username>`. When you leave it out, `sfod` uses:

1. The `SFOD_TARGET_ORG` environment variable, if it's set
2. The default org, which is the first org you logged in to or whichever you set with `sfod org set-default`

## Choosing objects

`export excel`, `export json`, and `erd` all use the same selection flags. You can combine them.

| Flag | Example | Selects |
| --- | --- | --- |
| `--objects` | `--objects Account,Contact,Opportunity` | Those objects |
| | `--objects "*__c"` | Wildcards: `*` matches any run of characters, `?` matches one |
| `--objects-file` | `--objects-file scope.txt` | Names or wildcards from a file, one per line, `#` for comments |
| `--custom` | `--custom` | Every custom object |
| `--all` | `--all` | Every object in the org (slow on large orgs) |
| `--exclude` | `--exclude "*__Share,*History,*__Feed"` | Removes matches from the selection |

Quote anything containing `*` or `?`, otherwise your shell expands the wildcard before `sfod` sees it. Names are case-insensitive. If an exact name (no wildcard) doesn't exist in the org, the command **fails** instead of skipping it. That way a typo can't quietly drop an object from a downstream document.

Example `scope.txt`:

```text
# Objects in scope for the ERP integration
Account
Contact
Opportunity
OpportunityLineItem
Product2
Invoice__c
Invoice_Line__c
```

## Commands

### `sfod objects`

Lists the objects in the org.

```bash
sfod objects -o prod                 # all objects
sfod objects -o prod --custom        # custom objects only
sfod objects -o prod --match "Invoice*"
sfod objects -o prod --json          # name, label, keyPrefix, custom, queryable, ...
```

### `sfod export excel`

Writes an Excel workbook with the same layout as the desktop app. Each object gets its own sheet with an object summary and a full field table: type, length, required, unique, external ID, picklist values, formulas, help text, relationships, and more.

```bash
sfod export excel -o prod --objects-file scope.txt -f ./mapping/salesforce-metadata.xlsx
```

Without `-f/--output-file`, the file is saved as `Salesforce_Metadata_<alias>_<YYYY-MM-DD>.xlsx` in the current folder. An existing file at that path is overwritten.

### `sfod export json`

Writes the raw Salesforce describe result for each object. Use it when a downstream script needs attributes the Excel layout doesn't include.

```bash
sfod export json -o prod --objects Account,Contact > describe.json   # to stdout
sfod export json -o prod --custom -f describe.json                   # to a file
```

### `sfod erd`

Generates a Mermaid entity relationship diagram.

```bash
sfod erd -o prod --objects Opportunity --depth 2 -f opportunity-erd.md
sfod erd -o prod --objects-file scope.txt --selected-only -f scope-erd.mmd
```

| Flag | Meaning |
| --- | --- |
| `--depth <1-5>` | How many relationship levels to follow from the chosen objects (default 2) |
| `--selected-only` | Only draw the chosen objects and the relationships between them |
| `--compact` | Object names only, no fields |
| `--max-objects <n>` | Stop after `n` objects |
| `--max-fields <n>` | Fields shown per object (default 8) |
| `-f, --output-file` | A `.md` file gets a fenced `mermaid` block, which renders on GitHub, in VS Code, and in other Markdown viewers. A `.mmd` file gets raw Mermaid. Without this flag, the Mermaid code prints to stdout. |

## Interactive shell

In a terminal, run `sfod` with no arguments, or run `sfod shell`:

```text
$ sfod
SF Org Describe - interactive shell (Ctrl+C to exit)

Which org?
  1) prod (default) - admin@acme.com
  2) Log in to a new org
Choose [1]: 1

[prod] What would you like to do?
  1) Export metadata to Excel
  2) Export metadata to JSON
  3) Generate an ERD (Mermaid)
  4) List objects
  5) Switch org / log in
  6) Quit
Choose [1]: 1

Objects: API names separated by commas; wildcards work (e.g. Account,Contact,*__c).
Or type "custom" for all custom objects, "all" for every object, "list" to see them.
Objects: Account,Contact,*__c
14 objects selected
Save to [Salesforce_Metadata_prod_2026-09-24.xlsx]:
Describing objects: 14/14
Exported 14 objects to /Users/me/Salesforce_Metadata_prod_2026-09-24.xlsx

To repeat this from a script:
  sfod export excel -o prod --objects "Account,Contact,*__c" -f Salesforce_Metadata_prod_2026-09-24.xlsx
```

After each action, the shell prints the matching `sfod` command. You can work out a selection interactively once, then paste that command into a script.

When you log in from the shell, it offers the domain and Client ID saved with that alias as defaults.

## Automation and agents

These behaviors are consistent across commands, so scripts and AI agents can rely on them:

- **`--json`** prints a single JSON document to stdout: `{"status": 0, "result": {...}}` on success, or `{"status": 1, "name": "...", "message": "..."}` on failure.
- **Exit codes**: `0` for success, `1` for an error (auth, API, object not found), `2` for bad usage (unknown flag, missing required flag).
- **stdout vs stderr**: progress messages and prompts go to stderr. stdout carries only the result, so piping is safe.
- **No prompts**: a command with arguments never asks a question. If it's missing something it needs, it fails with an explanation. Only `sfod`/`sfod shell` is interactive.
- **Overwrites**: exports replace the output file, so downstream tools always read the latest metadata.

### The one-time human step

Salesforce requires a person to approve the first login in a browser. After that, the saved refresh token keeps the alias working without a browser until the token is revoked or expires under your org's session policy.

A command like `sfod login` normally waits until the login is approved. Many agent tools only show a command's output after it exits, so the person would never see the code. Split the login into two steps instead:

```bash
# Step 1: returns immediately with the code
sfod login --alias prod --domain acme.my.salesforce.com --client-id 3MVG9... --no-wait --json
```

```json
{
  "status": 0,
  "result": {
    "alias": "prod",
    "userCode": "WXYZ1234",
    "verificationUri": "https://acme.my.salesforce.com/setup/connect",
    "expiresIn": 600,
    "loginUrl": "https://acme.my.salesforce.com"
  }
}
```

The agent shows the person `verificationUri` and `userCode`. The person opens the URL, enters the code, and approves access. Then:

```bash
# Step 2: waits for approval, then saves the alias
sfod login --alias prod --resume --json
```

### Suggested instructions for an agent

Add something like this to your agent's instructions, for example a `CLAUDE.md` or a skill:

```markdown
## Salesforce metadata
Use the `sfod` CLI (docs/CLI.md in sf-org-describe). Always pass --json and -o <alias>.
- Check the login first: `sfod org display -o prod --json`. A non-zero status means re-login is needed.
- To log in: run `sfod login --alias prod --no-wait --json`, show me `verificationUri` and `userCode`,
  wait for me to confirm, then run `sfod login --alias prod --resume --json`.
- Never pass --all on production unless asked; use --objects-file scope.txt.
```

## Example: keep an integration-mapping workbook current

This example refreshes the Salesforce side of a system-integration mapping on a schedule. A downstream process or agent then reads the new workbook.

`refresh-metadata.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="$HOME/integration-mapping/salesforce"
mkdir -p "$OUT_DIR"

# Fail fast (and loudly) if the saved login has expired
sfod org display -o prod --json > /dev/null || {
  echo "Salesforce login for 'prod' has expired. Run: sfod login --alias prod" >&2
  exit 1
}

# Human-readable workbook for mapping sessions
sfod export excel -o prod --objects-file "$OUT_DIR/scope.txt" \
  -f "$OUT_DIR/salesforce-metadata-latest.xlsx" --json > "$OUT_DIR/last-run.json"

# Raw metadata for scripts that diff or transform field lists
sfod export json -o prod --objects-file "$OUT_DIR/scope.txt" \
  -f "$OUT_DIR/salesforce-describe-latest.json"

# Relationship diagram for the mapping document
sfod erd -o prod --objects-file "$OUT_DIR/scope.txt" --selected-only \
  -f "$OUT_DIR/salesforce-erd-latest.md"
```

To run it every weekday at 6am with cron (`crontab -e`):

```cron
0 6 * * 1-5 /path/to/refresh-metadata.sh >> ~/integration-mapping/refresh.log 2>&1
```

When cron can't find `sfod`, use the full path from `which sfod`, or run `node /path/to/sf-org-describe/bin/sfod.js`.

An agent can do the same thing on request. For example, you can ask it to *"pull the latest Salesforce metadata for the ERP integration objects and update the mapping sheet."* It runs the export with `--json`, reads `result.outputFile` from the output, and continues with the next steps.

## Shared defaults (`sfod config`)

Two defaults apply to **new** logins in both the CLI and the desktop app:

| Key | Used for | Same as in the desktop app |
| --- | --- | --- |
| `client-id` | The Consumer Key, when the alias has none saved and `--client-id` isn't given | **Advanced Settings → Client ID** |
| `domain` | The suggested My Domain in the interactive shell and the app's Custom Domain field | The **Custom Domain** field (the app remembers the last one you used) |

```bash
sfod config list
sfod config set client-id 3MVG9...
sfod config set domain acme.my.salesforce.com
sfod config unset client-id
```

Scripted `sfod login` doesn't pick up the `domain` default on its own. Pass `--domain` so a script never logs in to an org you didn't intend.

## Where credentials are stored

Saved orgs and shared defaults are kept in `~/.sf-org-describe/orgs.json`, which the CLI and the desktop app both read and write. Set `SFOD_HOME` to use a different folder, for example a separate folder per CI job. The desktop app follows `SFOD_HOME` too when it's started from a shell where the variable is set.

- The file is created with permissions `600`, so only your user can read it. It contains each org's **access and refresh tokens**, so treat it like a password file. Don't commit it or copy it to shared locations.
- `sfod org logout -o <alias>` deletes an org's tokens from the file. To also revoke access on the Salesforce side, go to **Setup → Connected Apps OAuth Usage** or the user's **OAuth Connected Apps** list.
- The desktop app lists the same saved orgs on its Connect tab. Removing an org there (**×**) also removes it for the CLI, and the reverse.
- Earlier versions of the desktop app kept the Client ID and Custom Domain in the app's own storage. Version 1.2.0 moves them to this file the first time it opens.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `client identifier invalid (invalid_client_id)` | Salesforce at that domain doesn't recognize the Client ID. Check that you chose the right `--domain` or `--sandbox`. External Client Apps only work through the My Domain of the org where they were created. |
| `device flow is not enabled for the app` | In the app's OAuth settings, enable **Device Flow**, then wait about 10 minutes. |
| `OAUTH_APPROVAL_ERROR_GENERIC` in the browser | You're using an External Client App through `login.salesforce.com` or `test.salesforce.com`. Log in with `--domain yourdomain.my.salesforce.com` instead. |
| `The saved login is no longer valid` | The refresh token was revoked or expired. Run `sfod login --alias <alias>` again; the saved domain and Client ID are reused. |
| `Salesforce did not return a refresh token` | Add the `refresh_token` (or `refresh_token, offline_access`) OAuth scope to the Connected App. |
| `Object not found in this org: X` | Check the API name with `sfod objects -o <alias> --match "X*"`. |
| `The login code ... expired` | You have about 10 minutes to approve a code. Start again with `sfod login --alias <alias>`. |
