# Deployment Guide

This guide covers deploying the wine-cellar-app to Synology NAS via Docker.

---

## Quick Reference

| Action | Command |
|--------|---------|
| **Full deploy** | `.\scripts\deploy.ps1` |
| **Deploy existing image** | `.\scripts\deploy.ps1 -SkipPush` |
| **Update config only** | `.\scripts\deploy.ps1 -UpdateConfig` |
| **Clean deploy** | `.\scripts\deploy.ps1 -SkipPush -Clean` |
| **Download production DB** | `.\scripts\sync-db.ps1 -Download` |
| **Upload local DB** | `.\scripts\sync-db.ps1 -Upload` |
| **Setup SSH key auth** | `.\scripts\setup-ssh-key.ps1` |
| **SSH to Synology** | `ssh lstrydom@192.168.86.31` |
| **View container logs** | `ssh lstrydom@192.168.86.31 "docker logs wine-cellar"` |

**Production URL**: http://192.168.86.31:3000

### Common Usage (Copy-Paste Ready)

```powershell
# Full deploy (push to GitHub, wait for build, deploy)
.\scripts\deploy.ps1

# Deploy existing image (skip git push)
.\scripts\deploy.ps1 -SkipPush

# Just update config files and restart
.\scripts\deploy.ps1 -UpdateConfig

# Full clean deploy (prune unused images)
.\scripts\deploy.ps1 -SkipPush -Clean

# Download production database to local
.\scripts\sync-db.ps1 -Download

# Upload local database to production (CAUTION!)
.\scripts\sync-db.ps1 -Upload
```

---

## Prerequisites

- Synology NAS with Docker/Container Manager installed
- SSH access enabled on Synology
- SFTP enabled (Control Panel → File Services → FTP → Enable SFTP)
- GitHub Container Registry image built (automatic via GitHub Actions on push to main)

---

## First-Time Setup

### 1. Create Local .env File

Create `.env` in the project root with all credentials:

```bash
# API Keys
ANTHROPIC_API_KEY=your-anthropic-key
GOOGLE_SEARCH_API_KEY=your-google-key
GOOGLE_SEARCH_ENGINE_ID=your-search-engine-id
BRIGHTDATA_API_KEY=your-brightdata-key
BRIGHTDATA_SERP_ZONE=wine_serp
BRIGHTDATA_WEB_ZONE=wine_unlocker

# Synology NAS credentials (for deployment scripts)
SYNOLOGY_USER=lstrydom
SYNOLOGY_IP=192.168.86.31
SYNOLOGY_PASSWORD=your-synology-password
```

### 2. Setup SSH Key Authentication (Recommended)

Run the setup script to configure passwordless SSH:

```powershell
.\scripts\setup-ssh-key.ps1
```

This will:
- Generate an SSH key if needed
- Copy the public key to Synology
- Fix home directory permissions
- Test the connection

### 3. Configure Docker Access on Synology

To run docker commands without sudo:

**Option A: Via DSM Web Interface**
1. Control Panel → User & Group → Select user → Permissions tab
2. Give Read/Write access to "docker" shared folder

**Option B: Change docker socket group**
```bash
# SSH into Synology and run:
sudo chgrp administrators /var/run/docker.sock
sudo chmod 660 /var/run/docker.sock
```

**Make it persistent after reboot:**
1. Control Panel → Task Scheduler → Create → Triggered Task → User-defined script
2. Task: "Docker socket permissions"
3. User: root
4. Event: Boot-up
5. Run command: `chgrp administrators /var/run/docker.sock && chmod 660 /var/run/docker.sock`

---

## Synology Paths

| Item | Path |
|------|------|
| App directory | `~/Apps/wine-cellar-app/` |
| Database | `~/Apps/wine-cellar-app/data/cellar.db` |
| Environment file | `~/Apps/wine-cellar-app/.env` |
| Docker Compose | `~/Apps/wine-cellar-app/docker-compose.yml` |

---

## Automated Deployment Scripts

### Deploy Script (scripts/deploy.ps1)

The deploy script handles everything: push to GitHub, wait for build, deploy to Synology.

```powershell
# Full deploy (push, wait for build, deploy)
.\scripts\deploy.ps1

# Deploy without pushing (use existing image)
.\scripts\deploy.ps1 -SkipPush

# Just update config files and restart (no new image)
.\scripts\deploy.ps1 -UpdateConfig

# Full clean deploy (prune all unused images)
.\scripts\deploy.ps1 -SkipPush -Clean
```

**What the deploy script does:**
1. Checks for uncommitted changes
2. Pushes to GitHub
3. Waits for GitHub Actions build to complete
4. Stops the container on Synology
5. Removes old Docker image
6. Uploads docker-compose.yml and .env
7. Pulls new image and starts container
8. Verifies deployment

### Database Sync Script (scripts/sync-db.ps1)

```powershell
# Download production DB to local
.\scripts\sync-db.ps1 -Download

# Upload local DB to production (CAUTION!)
.\scripts\sync-db.ps1 -Upload
```

### SSH Authentication

The scripts auto-detect and prefer SSH key auth, falling back to password auth if needed:

1. **Native SSH with key auth** (preferred) - No password prompts
   - Setup: `.\scripts\setup-ssh-key.ps1`

2. **PuTTY (plink/psftp)** - Uses password from .env file
   - Install: `winget install PuTTY.PuTTY`

---

## Manual Deployment

### From Windows PowerShell

```powershell
# SSH into Synology
ssh lstrydom@192.168.86.31
```

### From Synology SSH

```bash
# Navigate to app
cd ~/Apps/wine-cellar-app

# View container status
docker ps

# View logs
docker logs wine-cellar

# Restart container
docker compose restart

# Full redeploy (pull latest image)
docker compose down
docker rmi ghcr.io/lbstrydom/wine-cellar-app:latest
docker compose pull
docker compose up -d
```

---

## Docker Compose Configuration

The production `docker-compose.yml` on Synology:

```yaml
services:
  wine-cellar:
    image: ghcr.io/lbstrydom/wine-cellar-app:latest
    container_name: wine-cellar
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - GOOGLE_SEARCH_API_KEY=${GOOGLE_SEARCH_API_KEY}
      - GOOGLE_SEARCH_ENGINE_ID=${GOOGLE_SEARCH_ENGINE_ID}
      - BRIGHTDATA_API_KEY=${BRIGHTDATA_API_KEY}
      - BRIGHTDATA_SERP_ZONE=${BRIGHTDATA_SERP_ZONE}
      - BRIGHTDATA_WEB_ZONE=${BRIGHTDATA_WEB_ZONE}
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/stats"]
      interval: 30s
      timeout: 5s
      retries: 3
```

---

## Troubleshooting

### "No image to be pulled" on docker compose pull

Docker has cached the old image. Remove it first:
```bash
docker rmi ghcr.io/lbstrydom/wine-cellar-app:latest
docker compose pull
```

### Container not using GHCR image

Check `docker-compose.yml` has `image: ghcr.io/lbstrydom/wine-cellar-app:latest` (not `build: .`)

### SCP/SFTP path errors from Windows

Synology's SFTP server is chrooted to the user's shared folder, so paths differ between SSH and SFTP:

| Protocol | Path to home cellar.db |
|----------|------------------------|
| SSH      | `~/cellar.db` or `/var/services/homes/lstrydom/cellar.db` |
| SFTP     | `/home/cellar.db` |

**Recommended approach** - use the sync script:
```powershell
.\scripts\sync-db.ps1 -Download
```

### Environment variables not loading

Ensure `.env` file exists in `~/Apps/wine-cellar-app/` and restart the container.

### Container unhealthy

Check logs:
```bash
docker logs wine-cellar
```

### SSH post-quantum warnings

These warnings are harmless and can be ignored:
```
** WARNING: connection is not using a post-quantum key exchange algorithm.
```

The scripts automatically filter these out.

### Docker requires sudo

If you get permission denied for docker commands:
1. Check docker socket permissions: `ls -la /var/run/docker.sock`
2. Should show `administrators` group: `srw-rw---- 1 root administrators`
3. If not, run: `sudo chgrp administrators /var/run/docker.sock && sudo chmod 660 /var/run/docker.sock`

---

## Network Details

| Item | Value |
|------|-------|
| Synology IP | 192.168.86.31 |
| SSH User | lstrydom |
| App Port | 3000 |
| App URL | http://192.168.86.31:3000 |
