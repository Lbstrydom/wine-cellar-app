# Fly.io Deployment Guide

This guide covers deploying the Wine Cellar App to Fly.io.

## Prerequisites

1. **Fly.io account**: Sign up at https://fly.io
2. **flyctl CLI**: Install the Fly CLI

### Install flyctl

**Windows (PowerShell)**:
```powershell
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

**macOS/Linux**:
```bash
curl -L https://fly.io/install.sh | sh
```

## One-Time Setup

### 1. Login to Fly.io

```bash
flyctl auth login
```

This opens a browser for authentication.

### 2. Create the App

```bash
cd /path/to/wine-cellar-app
flyctl launch --no-deploy
```

When prompted:
- **App name**: `wine-cellar` (or choose your own)
- **Region**: `lhr` (London) or closest to you
- **PostgreSQL**: No (we use SQLite)
- **Redis**: No

### 3. Create Persistent Volume

The database needs persistent storage:

```bash
flyctl volumes create wine_cellar_data --region lhr --size 1
```

### 4. Set Secrets (Environment Variables)

```bash
# Required
flyctl secrets set ANTHROPIC_API_KEY=your_anthropic_key

# Optional (for rating scraping)
flyctl secrets set BRIGHTDATA_API_KEY=your_brightdata_key
flyctl secrets set BRIGHTDATA_SERP_ZONE=your_serp_zone
flyctl secrets set BRIGHTDATA_WEB_ZONE=your_web_zone
flyctl secrets set GOOGLE_SEARCH_API_KEY=your_google_key
flyctl secrets set GOOGLE_SEARCH_ENGINE_ID=your_engine_id
```

### 5. Deploy

```bash
flyctl deploy
```

First deploy takes 2-3 minutes. Subsequent deploys are faster.

### 6. Set Up Custom Domain

```bash
# Add your domain
flyctl certs add cellar.creathyst.com

# Get the IP addresses for DNS
flyctl ips list
```

Then add DNS records at your registrar:
- **A record**: `cellar` → Fly.io IPv4 address
- **AAAA record**: `cellar` → Fly.io IPv6 address

## Daily Operations

### Deploy Updates

After pushing to GitHub, deploy automatically triggers via GitHub Actions.

Or manually:
```bash
flyctl deploy
```

### View Logs

```bash
flyctl logs
```

### SSH into Container

```bash
flyctl ssh console
```

### Check Status

```bash
flyctl status
```

### Restart App

```bash
flyctl apps restart
```

## Database Management

### Backup Database

```bash
# SSH into the container
flyctl ssh console

# Inside container, copy database
cp /data/cellar.db /data/cellar-backup-$(date +%Y%m%d).db
```

### Download Database Locally

```bash
flyctl ssh sftp get /data/cellar.db ./cellar-backup.db
```

### Upload Database

```bash
flyctl ssh sftp shell
> put ./local-cellar.db /data/cellar.db
> exit
```

Then restart the app:
```bash
flyctl apps restart
```

## Migrating from Synology

### 1. Download Current Database

From your local machine with SSH access to Synology:
```bash
scp lstrydom@192.168.86.31:~/Apps/wine-cellar-app/data/cellar.db ./cellar.db
scp lstrydom@192.168.86.31:~/Apps/wine-cellar-app/data/awards.db ./awards.db
```

### 2. Upload to Fly.io

```bash
flyctl ssh sftp shell
> put ./cellar.db /data/cellar.db
> put ./awards.db /data/awards.db
> exit
```

### 3. Restart

```bash
flyctl apps restart
```

### 4. Verify

Visit https://cellar.creathyst.com (or your domain) and check your wines are there.

## Troubleshooting

### App Not Starting

Check logs:
```bash
flyctl logs
```

Common issues:
- Missing secrets (ANTHROPIC_API_KEY)
- Volume not created
- Port mismatch (should be 3000)

### Database Errors

SSH in and check:
```bash
flyctl ssh console
ls -la /data/
```

If empty, the volume might not be mounted. Check `fly.toml` mounts section.

### DNS Not Working

Check certificate status:
```bash
flyctl certs show cellar.creathyst.com
```

May take up to 24 hours for DNS propagation.

## Cost Estimate

| Resource | Free Tier | Paid |
|----------|-----------|------|
| Shared CPU VM | 3 VMs | $1.94/mo per VM |
| Memory (256MB) | Included | - |
| Persistent Storage | 3GB | $0.15/GB/mo |
| Bandwidth | Generous | $0.02/GB after |
| **Typical monthly cost** | **$0** | **$2-5** |

For personal use, you'll likely stay within the free tier.

## GitHub Actions Auto-Deploy

The repository includes `.github/workflows/fly-deploy.yml` for automatic deploys.

### Setup

1. Get a Fly.io API token:
   ```bash
   flyctl tokens create deploy -x 999999h
   ```

2. Add to GitHub repository secrets:
   - Go to: Settings → Secrets → Actions
   - Add: `FLY_API_TOKEN` with the token value

Now every push to `main` automatically deploys to Fly.io.

## Architecture

```
┌─────────────────────────────────────────┐
│              Fly.io Edge                │
│         (Global CDN + SSL)              │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│           Fly.io Machine                │
│      (Node.js + Express App)            │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │      /data (Persistent Volume)  │    │
│  │  ┌─────────┐  ┌─────────────┐   │    │
│  │  │cellar.db│  │  awards.db  │   │    │
│  │  └─────────┘  └─────────────┘   │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

## Comparison: Synology vs Fly.io

| Aspect | Synology | Fly.io |
|--------|----------|--------|
| **Cost** | Hardware + electricity | $0-5/month |
| **Uptime** | Depends on home network | 99.9%+ SLA |
| **Deploy** | SSH + Docker | `fly deploy` |
| **Access** | Cloudflare Tunnel | Native HTTPS |
| **Maintenance** | Manual updates | Managed |
| **Backup** | Manual | Volume snapshots |
| **Speed** | Home upload speed | Global edge |

---

*Last updated: 5 January 2026*
