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
- Supports both Production and Sandbox environments
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

## Tech Stack

- **Electron** - Cross-platform desktop framework
- **jsforce** - Salesforce API client
- **ExcelJS** - Excel file generation
- **Mermaid** - Diagram rendering

## License

MIT
