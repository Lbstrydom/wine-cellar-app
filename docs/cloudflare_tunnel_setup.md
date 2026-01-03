# Cloudflare Tunnel Setup for Wine Cellar PWA

## Objective

Access a wine cellar PWA app at `https://cellar.creathyst.com` with valid HTTPS (required for PWA installation in Chrome).

## Architecture

```
Browser → Cloudflare (proxy + SSL) → Cloudflare Tunnel → Synology DS223j → Wine app on port 3000
```

## Background

### What we tried first (failed)

1. **Tailscale Funnel** with Cloudflare proxy (orange cloud)
2. Funnel runs on Synology at `ds223j.tailf6bfbc.ts.net`
3. Created CNAME: `cellar.creathyst.com` → `ds223j.tailf6bfbc.ts.net`
4. **Result:** SSL 525 error, then `ERR_CONNECTION_CLOSED`
5. **Root cause:** Tailscale Funnel rejects proxied connections from Cloudflare. It only accepts direct connections and serves `*.ts.net` certificates.

### Why not use Tailscale URL directly?

The `https://ds223j.tailf6bfbc.ts.net` URL works, but the user specifically wants `cellar.creathyst.com` for the PWA.

## Solution: Cloudflare Tunnel

Cloudflare Tunnel (`cloudflared`) replaces Tailscale Funnel for this use case. It:

- Works natively with Cloudflare proxy
- Provides valid SSL for custom domains
- Requires no port forwarding
- Is free

## Current Environment

- **Domain:** `creathyst.com` (DNS managed by Cloudflare)
- **Synology NAS:** DS223j at `192.168.86.31`
- **Wine app:** Running on `http://127.0.0.1:3000` on Synology
- **Tailscale:** Installed on Synology (keep it; just disable Funnel)
- **Docker:** Available on Synology

## Completed Steps

1. ✅ Created Cloudflare Tunnel named `synology-cellar` in Zero Trust dashboard
2. ✅ Selected Docker as the connector environment
3. ✅ Deleted old CNAME record (`cellar` → `ds223j.tailf6bfbc.ts.net`) from Cloudflare DNS
4. ✅ Deleted duplicate record from Squarespace DNS (no longer authoritative)

## Remaining Steps

### Step 1: Copy the Docker command from Cloudflare

The Cloudflare dashboard shows a command like:

```bash
docker run -d cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJhIjoiXXX...
```

Copy the full command including your token.

### Step 2: SSH into Synology

```bash
ssh lstrydom@192.168.86.31
```

### Step 3: Create directory for cloudflared (optional, for organisation)

```bash
mkdir -p /volume1/docker/cloudflared
```

### Step 4: Run the Docker container

Paste the command from Cloudflare, but add `--name` and `--restart` flags:

```bash
sudo docker run -d \
  --name cloudflared \
  --restart unless-stopped \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run --token YOUR_TOKEN_HERE
```

### Step 5: Verify connector appears in Cloudflare

Back in the Cloudflare Zero Trust dashboard, under the tunnel configuration, you should see "1 connector" appear under "Connectors".

### Step 6: Configure public hostname

In the Cloudflare Tunnel setup wizard (or edit the tunnel afterwards):

1. Go to **Public Hostname** tab
2. Add a public hostname:
   - **Subdomain:** `cellar`
   - **Domain:** `creathyst.com`
   - **Service Type:** `HTTP`
   - **URL:** `192.168.86.31:3000` (Synology's local IP and app port)

Note: Use the Synology's local IP (`192.168.86.31`) rather than `localhost` or `127.0.0.1` because the Docker container has its own network namespace.

### Step 7: Disable Tailscale Funnel (cleanup)

```bash
sudo /var/packages/Tailscale/target/bin/tailscale funnel off
```

### Step 8: Test

Open `https://cellar.creathyst.com` in browser. Should load with valid SSL.

Then test PWA installation in Chrome.

## Troubleshooting

### Container not starting

Check logs:

```bash
sudo docker logs cloudflared
```

### Connector not appearing in dashboard

- Verify token is correct (no truncation when copying)
- Check Synology has internet access
- Check Docker is running: `sudo docker ps`

### Site loads but shows "Bad Gateway" or 502

- Verify wine app is running on port 3000
- Try using `host.docker.internal:3000` instead of IP in the public hostname config
- Or use `172.17.0.1:3000` (Docker's default gateway to host)

### DNS not resolving

Cloudflare Tunnel automatically creates a CNAME record. Check Cloudflare DNS for a record pointing `cellar` to the tunnel UUID.

## Reference

- Cloudflare Tunnel docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- Synology Docker: Access via DSM → Package Center → Docker
