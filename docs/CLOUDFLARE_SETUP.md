# Cloudflare Custom Domain Setup

## Current Status

- **Domain**: `creathyst.com` (managed via Cloudflare)
- **Nameservers**: Updated to Cloudflare (`aldo.ns.cloudflare.com`, `emma.ns.cloudflare.com`)
- **Tailscale Funnel**: Running on `ds223j.tailf6bfbc.ts.net`

## Add Wine Cellar Subdomain

Once Cloudflare shows the domain as "Active":

1. Go to: **https://dash.cloudflare.com** → Select `creathyst.com` → **DNS** → **Records**

2. Click **+ Add record**

3. Enter these values:

   | Field | Value |
   |-------|-------|
   | Type | `CNAME` |
   | Name | `cellar` |
   | Target | `ds223j.tailf6bfbc.ts.net` |
   | Proxy status | **Proxied** (orange cloud ON) |
   | TTL | Auto |

4. Click **Save**

## Result

Your wine cellar app will be accessible at:

**https://cellar.creathyst.com**

## Why Cloudflare Proxy is Required

Tailscale Funnel only provides SSL certificates for `*.ts.net` domains. The Cloudflare proxy (orange cloud) handles:

- SSL termination for your custom domain
- Certificate management (automatic)
- DDoS protection
- Caching (optional)

Without the proxy enabled, browsers would reject the connection due to SSL certificate mismatch.

## Troubleshooting

### Domain still showing "Pending"
- Nameserver changes can take up to 24 hours (usually 5-30 minutes)
- Verify nameservers in Squarespace are set to Cloudflare's

### Connection refused after adding CNAME
- Ensure Tailscale Funnel is running on Synology:
  ```bash
  ssh lstrydom@192.168.86.31
  sudo /var/packages/Tailscale/target/bin/tailscale funnel status
  ```
- If not running, start it:
  ```bash
  sudo /var/packages/Tailscale/target/bin/tailscale funnel --bg 3000
  ```

### SSL errors
- Make sure proxy status is **ON** (orange cloud, not grey)
- Wait a few minutes for Cloudflare to provision the certificate
