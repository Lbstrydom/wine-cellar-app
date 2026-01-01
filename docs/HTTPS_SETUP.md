# HTTPS Setup for Wine Cellar on Synology

The Wine Cellar app requires HTTPS for PWA installation (browser requirement). This guide explains how to configure HTTPS using Synology DSM's built-in reverse proxy.

## Prerequisites

- Synology NAS with DSM 7.x
- A domain name (free options available via DDNS)
- Port 80 and 443 accessible from the internet (for Let's Encrypt verification)

## Option 1: Synology DDNS + Let's Encrypt (Recommended)

### Step 1: Set up Synology DDNS

1. Open **Control Panel** → **External Access** → **DDNS**
2. Click **Add**
3. Select a service provider (Synology provides free `.synology.me` domains)
4. Choose a hostname (e.g., `your-name.synology.me`)
5. Click **Test Connection** then **OK**

### Step 2: Get Let's Encrypt Certificate

1. Open **Control Panel** → **Security** → **Certificate**
2. Click **Add** → **Add a new certificate**
3. Select **Get a certificate from Let's Encrypt**
4. Enter:
   - **Domain name**: `your-name.synology.me` (your DDNS hostname)
   - **Email**: Your email address
5. Click **Apply**

### Step 3: Configure Reverse Proxy

1. Open **Control Panel** → **Login Portal** → **Advanced** → **Reverse Proxy**
2. Click **Create**
3. Configure:
   - **Description**: Wine Cellar
   - **Source**:
     - Protocol: `HTTPS`
     - Hostname: `your-name.synology.me`
     - Port: `443`
   - **Destination**:
     - Protocol: `HTTP`
     - Hostname: `localhost`
     - Port: `3000`
4. Click **Save**

### Step 4: Assign Certificate to Reverse Proxy

1. Go back to **Control Panel** → **Security** → **Certificate**
2. Click **Settings**
3. Find the reverse proxy entry and assign your Let's Encrypt certificate
4. Click **OK**

### Step 5: Port Forwarding

On your router, forward:
- External port `443` → Synology IP, port `443`
- External port `80` → Synology IP, port `80` (needed for Let's Encrypt renewal)

### Step 6: Test

1. Navigate to `https://your-name.synology.me`
2. You should see the Wine Cellar app with a valid SSL certificate (padlock icon)
3. The PWA install option should now appear in Chrome's menu (⋮ → "Install Wine Cellar")

## Option 2: Local-only HTTPS (Self-signed Certificate)

For LAN-only access, you can use a self-signed certificate. Note: Browsers will show warnings, and PWA install may not work reliably.

1. Open **Control Panel** → **Security** → **Certificate**
2. Click **Add** → **Create self-signed certificate**
3. Fill in details and click **Apply**
4. Follow Steps 3-4 from Option 1 above
5. Access via `https://192.168.86.31` (accept the security warning)

## Troubleshooting

### "Not Secure" in Browser
- Certificate not properly assigned to reverse proxy
- Using HTTP instead of HTTPS
- Certificate expired (renew via Certificate panel)

### PWA Install Button Not Showing
- Must be using HTTPS with valid certificate
- Try Chrome's menu (⋮) → "Install Wine Cellar"
- Clear browser cache and reload
- Check `manifest.json` is being served (F12 → Application → Manifest)

### Let's Encrypt Certificate Fails
- Ensure ports 80 and 443 are forwarded correctly
- DDNS hostname must resolve to your external IP
- Wait a few minutes after setting up DDNS

### Service Worker Not Registering
- Must be HTTPS (or localhost for testing)
- Check browser console for errors (F12 → Console)
- Clear service worker: F12 → Application → Service Workers → Unregister

## PWA Install Process

Once HTTPS is configured:

1. Open `https://your-domain/` in Chrome
2. Wait for the page to fully load
3. Click the ⋮ menu (three dots) in Chrome
4. Select "Install Wine Cellar" (or "Install app")
5. On mobile: Look for "Add to Home Screen" banner

Alternatively, the install button appears in Settings → Install App section once the browser detects PWA eligibility.

## Updating the App

After updates, the app will:
1. Detect the new service worker
2. Show an "Update available" notification
3. Click "Refresh" to load the new version

For manual update: F12 → Application → Service Workers → "Update" or "Unregister" then reload.
