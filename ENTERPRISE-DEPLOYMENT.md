# Enterprise Deployment Guide

## Outlook Email Evaluator — Chrome / Edge Extension

This document outlines the available methods for deploying the Outlook Email Evaluator extension to end users across an organization using enterprise management tools.

---

## Prerequisites

Before deploying, ensure the following are in place:

- The Supabase Edge Function is deployed and accessible
- The `EXTENSION_TOKEN` shared secret is set in both the Supabase Edge Function environment and the extension's configuration
- The `.crx` file has been built (see [Packaging](#packaging) below)
- You have the **Extension ID** (generated after the first load or store submission)

---

## Option 1: Microsoft Intune (Recommended for Microsoft 365 Organizations)

Best suited for organizations already managing devices through Microsoft Endpoint Manager / Intune.

### For Microsoft Edge (Chromium)

1. **Publish the extension** to the [Microsoft Edge Add-ons Store](https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview) (can be unlisted for internal-only use)
2. Open the **Microsoft Intune Admin Center** at https://intune.microsoft.com
3. Navigate to **Devices > Configuration profiles > Create profile**
   - Platform: **Windows 10 and later**
   - Profile type: **Settings Catalog**
4. Search for: **"Control which extensions are installed silently"** under **Microsoft Edge > Extensions**
5. Add the extension ID and update URL in the format:
   ```
   <extension-id>;<update-url>
   ```
   For Edge Add-ons Store extensions, the update URL is:
   ```
   https://edge.microsoft.com/extensionwebstorebase/v1/crx
   ```
6. Assign the profile to the appropriate **user groups** or **device groups**
7. Extensions install silently on next Intune sync — users cannot remove or disable them

### For Google Chrome

1. **Publish the extension** to the [Chrome Web Store](https://chrome.google.com/webstore/devconsole) (can be unlisted)
2. In the Intune Settings Catalog, search for:
   **"Extension/App IDs and update URLs to be silently installed"** under **Google Chrome > Extensions**
3. Add the extension ID and update URL:
   ```
   <extension-id>;https://clients2.google.com/service/update2/crx
   ```
4. Assign to the target groups

> **Note:** Chrome ADMX policy templates must be ingested into Intune for Chrome-specific settings to appear.

---

## Option 2: Google Admin Console (Google Workspace Organizations)

Best suited for organizations using Google Workspace to manage Chrome browsers and Chromebooks.

1. **Publish the extension** to the Chrome Web Store (unlisted is fine)
2. Sign in to the **Google Admin Console** at https://admin.google.com
3. Navigate to **Devices > Chrome > Apps & Extensions > Users & browsers**
4. Select the target **Organizational Unit (OU)**
5. Click the **+** icon and choose **Add from Chrome Web Store**
6. Search for or paste your extension ID
7. Set the installation policy to **Force install**
8. Click **Save**

Users in the selected OU will receive the extension automatically on the next browser sync.

### Additional Controls

- **Pin to toolbar**: Force the extension icon to be visible
- **Allow / block list**: Restrict which other extensions users can install
- **Private Chrome Web Store**: Curate a set of approved extensions for your organization

---

## Option 3: Group Policy (On-Premises Active Directory)

Best suited for organizations using traditional Active Directory without cloud-based MDM.

### Setup

1. Download the browser policy templates:
   - **Chrome**: [Chrome Enterprise ADMX templates](https://chromeenterprise.google/browser/download/)
   - **Edge**: Included with Windows or available from [Microsoft Edge Enterprise](https://www.microsoft.com/en-us/edge/business/download)
2. Copy the ADMX/ADML files into your **Central Store** (`\\domain\SYSVOL\domain\Policies\PolicyDefinitions`)

### Configuration

1. Open **Group Policy Management Console (GPMC)**
2. Create or edit a GPO linked to the target OU
3. Navigate to:
   - **Chrome**: `Computer Configuration > Administrative Templates > Google Chrome > Extensions > Configure the list of force-installed extensions`
   - **Edge**: `Computer Configuration > Administrative Templates > Microsoft Edge > Extensions > Control which extensions are installed silently`
4. Enable the policy and add:
   ```
   <extension-id>;<update-url>
   ```
5. Link the GPO and run `gpupdate /force` or wait for the next policy refresh cycle

---

## Option 4: Self-Hosted Distribution (No App Store Required)

Best suited for organizations that prohibit store-based extension installation or need full control over the distribution pipeline.

### Step 1: Host the Extension Files

Place two files on an internal web server, SharePoint document library, Azure Blob Storage, or Supabase Storage:

- The `.crx` extension package
- An update manifest XML file

### Step 2: Create the Update Manifest

Create a file called `updates.xml`:

```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='YOUR_EXTENSION_ID'>
    <updatecheck codebase='https://your-server.com/extensions/outlook-evaluator.crx'
                 version='1.0.0' />
  </app>
</gupdate>
```

Replace `YOUR_EXTENSION_ID`, the `codebase` URL, and `version` with actual values.

### Step 3: Add update_url to manifest.json

Add the following to the extension's `manifest.json`:

```json
"update_url": "https://your-server.com/extensions/updates.xml"
```

### Step 4: Deploy via Policy

Use Intune (Option 1) or GPO (Option 3) to force-install, but point the update URL to your self-hosted `updates.xml` instead of a store URL.

### Automatic Updates

When you release a new version:

1. Build a new `.crx` with an incremented version number
2. Upload the new `.crx` to the same hosting location
3. Update `updates.xml` with the new version number
4. Chrome/Edge will check the update manifest periodically and update the extension automatically

---

## Packaging

To build the `.crx` file for distribution:

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge
2. Enable **Developer mode**
3. Click **Pack extension**
4. Set the **Extension root directory** to the project folder
5. (First time) Leave the private key field blank — Chrome will generate a `.pem` key file
6. (Subsequent builds) Provide the same `.pem` key to keep the same extension ID
7. The `.crx` file will be created in the parent directory

> **Important:** Store the `.pem` private key securely. Losing it means you cannot update the extension under the same ID.

---

## Comparison Matrix

| Criteria | Intune | Google Admin | GPO | Self-Hosted |
|---|---|---|---|---|
| Best for | Microsoft 365 orgs | Google Workspace orgs | On-prem AD | No-store requirement |
| Store listing required | Yes (can be unlisted) | Yes (can be unlisted) | No | No |
| Silent install | Yes | Yes | Yes | Yes |
| Auto-update | Via store | Via store | Via update URL | Via update XML |
| User can uninstall | No (force-installed) | No (force-installed) | No (force-installed) | No (force-installed) |
| Cloud MDM required | Yes | Yes | No | No |
| Supports Edge | Yes | No | Yes | Yes |
| Supports Chrome | Yes | Yes | Yes | Yes |

---

## Recommended Approach

For organizations using **Microsoft 365 and Intune** (the typical environment for Outlook Web users):

1. **Publish** to the Microsoft Edge Add-ons Store as an unlisted extension
2. **Create** an Intune Settings Catalog profile to force-install on target devices
3. **Configure** the extension's default settings (Proxy URL, Extension Token) via the extension popup on first run, or pre-configure via an additional Intune policy if the extension supports managed storage

This provides silent deployment, automatic updates, and central management with no end-user action required.
