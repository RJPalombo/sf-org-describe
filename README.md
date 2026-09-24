# SF Org Describe

A cross-platform desktop application for documenting Salesforce orgs. Export comprehensive metadata to Excel and generate Entity Relationship Diagrams (ERDs) using Mermaid.

![SF Org Describe](https://img.shields.io/badge/Platform-Mac%20%7C%20Windows-blue) ![License](https://img.shields.io/badge/License-MIT-green)

## Features

### Excel Metadata Export
- Export full SObject metadata to Excel workbooks
- One worksheet per object with complete field details
- Includes:
  - Field API names, labels, and types
  - Field lengths, precision, and scale
  - Required, unique, and external ID flags
  - Picklist values (with defaults marked)
  - Formula definitions
  - Help text and descriptions
  - Relationship details (lookup/master-detail references)
  - Field-level security indicators
  - History tracking and encryption status

### ERD Generator
- Generate Entity Relationship Diagrams using Mermaid syntax
- Configurable relationship depth (traverse 1-5 levels of related objects)
- Live diagram preview
- Export as Markdown or copy Mermaid code directly
- Automatically filters out system objects (History, Feed, Share, etc.)

### Authentication
- OAuth 2.0 Device Flow - works with **any** Salesforce org
- No per-org Connected App setup required
- Supports Production, Sandbox, and Custom Domain (My Domain) logins
- Same authentication method used by Salesforce Data Loader

## Installation

### Prerequisites
- Node.js 18+ 
- npm

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/RJPalombo/sf-org-describe.git
   cd sf-org-describe
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your Connected App:
   - Copy `.env.example` to `.env`
   - Add your Salesforce Connected App Client ID (see [Creating a Connected App](#creating-a-connected-app))

4. Run the application:
   ```bash
   ./start.sh
   ```

## Creating a Connected App

To use this application, you need a Salesforce Connected App with Device Flow enabled. This only needs to be done once - the same Connected App can authenticate users from any Salesforce org.

1. In Salesforce Setup, go to **App Manager** → **New Connected App**
2. Fill in basic info (name, email)
3. Enable **OAuth Settings**
4. Set Callback URL to `https://localhost` (not used for device flow)
5. Select OAuth Scopes:
   - `api`
   - `refresh_token`
6. **Enable for Device Flow** ← Critical!
7. Save and wait a few minutes for it to propagate
8. Copy the **Consumer Key** to your `.env` file as `SF_CLIENT_ID`

### Using an External Client App

External Client Apps also work (enable **Device Flow** under OAuth Settings → Flow Enablement), with one difference: a local External Client App only works in the org it was created in, and Salesforce must approve it through that org's My Domain. On the Connect tab, choose **Custom Domain** and enter your My Domain (e.g. `yourdomain.my.salesforce.com`). Logging in through Production or Sandbox fails after login with `OAUTH_APPROVAL_ERROR_GENERIC`.

## Building Distributables

Build for your platform:

```bash
# Mac only
./build.sh --mac

# Windows only  
./build.sh --win

# Both platforms
./build.sh --all
```

Output files will be in the `dist/` folder:
- **Mac**: `.dmg` and `.zip`
- **Windows**: `.exe` installer and portable `.exe`

## Usage

1. Launch the application
2. Select **Production** or **Sandbox**
3. Click **Connect to Salesforce**
4. Enter the displayed code on the Salesforce login page
5. Once connected, select objects from the sidebar
6. Use the **Excel Export** tab to download metadata
7. Use the **ERD Generator** tab to create relationship diagrams

## Command Line (CLI)

The `sfod` command gives you the same exports from a terminal. Use it interactively, from scripts, or from AI agents. You log in to each org once under an alias, much like Salesforce CLI. The alias remembers the domain and Client ID, and later commands run without a browser.

```bash
npm link                                   # installs the `sfod` command

sfod login --alias prod --domain acme.my.salesforce.com --client-id 3MVG9...
sfod export excel -o prod --objects-file scope.txt -f metadata.xlsx
sfod erd -o prod --objects Opportunity --depth 2 -f opportunity-erd.md
sfod                                       # interactive shell
```

Every command supports `--json` output and returns meaningful exit codes. See the **[CLI guide](docs/CLI.md)** for all commands, the agent login flow, and a scheduled-export example.

## Tech Stack

- **Electron** - Cross-platform desktop framework
- **jsforce** - Salesforce API client
- **ExcelJS** - Excel file generation
- **Mermaid** - Diagram rendering

## License

MIT
