# Deployment Guide

This guide covers deploying the wine-cellar-app to Synology NAS via Docker.

## Prerequisites

- Synology NAS with Docker/Container Manager installed
- SSH access enabled on Synology
- SFTP enabled (Control Panel → File Services → FTP → Enable SFTP)
- GitHub Container Registry image built (automatic via GitHub Actions on push to main)

## Environment Setup

### Synology Paths

| Item | Path |
|------|------|
| App directory | `~/Apps/wine-cellar-app/` |
| Database | `~/Apps/wine-cellar-app/data/cellar.db` |
| Environment file | `~/Apps/wine-cellar-app/.env` |
| Docker Compose | `~/Apps/wine-cellar-app/docker-compose.yml` |

### Required Environment Variables

Create `.env` file with:

```bash
ANTHROPIC_API_KEY=your-key-here
GOOGLE_SEARCH_API_KEY=your-key-here
GOOGLE_SEARCH_ENGINE_ID=your-id-here
BRIGHTDATA_API_KEY=your-key-here
BRIGHTDATA_SERP_ZONE=wine_serp
BRIGHTDATA_WEB_ZONE=wine_unlocker
```

---

## Quick Commands

### From Windows PowerShell

```powershell
# SSH into Synology
ssh lstrydom@192.168.86.31

# Download database from Synology (run scripts/sync-db.ps1 instead)
# Manual: First copy to home dir on Synology, then SCP
```

### From Synology SSH

```bash
# Navigate to app
cd ~/Apps/wine-cellar-app

# View container status
sudo docker ps

# View logs
sudo docker logs wine-cellar

# Restart container
sudo docker compose restart

# Full redeploy (pull latest image)
sudo docker compose down
sudo docker rmi ghcr.io/lbstrydom/wine-cellar-app:latest
sudo docker compose pull
sudo docker compose up -d
```

---

## Deployment Procedures

### 1. Deploy New Code Version

After pushing to main branch:

1. **Wait for GitHub Actions** to build the image (~1 min)
   ```powershell
   # Check build status
   gh run list --limit 1
   ```

2. **SSH into Synology**
   ```powershell
   ssh lstrydom@192.168.86.31
   ```

3. **Pull and restart**
   ```bash
   cd ~/Apps/wine-cellar-app
   sudo docker compose down
   sudo docker rmi ghcr.io/lbstrydom/wine-cellar-app:latest
   sudo docker compose pull
   sudo docker compose up -d
   ```

4. **Verify**
   ```bash
   sudo docker ps
   # Should show: ghcr.io/lbstrydom/wine-cellar-app:latest with status "healthy"
   ```

### 2. Update Environment Variables

1. **SSH into Synology**
   ```bash
   ssh lstrydom@192.168.86.31
   cd ~/Apps/wine-cellar-app
   ```

2. **Edit .env file**
   ```bash
   nano .env
   # Or recreate with cat:
   cat > .env << 'EOF'
   ANTHROPIC_API_KEY=your-key
   # ... other vars
   EOF
   ```

3. **Restart container**
   ```bash
   sudo docker compose down && sudo docker compose up -d
   ```

### 3. Sync Database (Synology → Local)

Use the helper script:
```powershell
.\scripts\sync-db.ps1 -Download
```

Or manually:
1. **On Synology SSH**
   ```bash
   cp ~/Apps/wine-cellar-app/data/cellar.db ~/cellar.db
   ```

2. **On Windows PowerShell**
   ```powershell
   scp lstrydom@192.168.86.31:cellar.db ./data/cellar.db
   ```

3. **Cleanup on Synology**
   ```bash
   rm ~/cellar.db
   ```

### 4. Sync Database (Local → Synology)

**Warning**: This overwrites production data!

1. **Stop container on Synology**
   ```bash
   cd ~/Apps/wine-cellar-app
   sudo docker compose down
   ```

2. **Upload from Windows**
   ```powershell
   scp ./data/cellar.db lstrydom@192.168.86.31:cellar.db
   ```

3. **On Synology, move file and restart**
   ```bash
   mv ~/cellar.db ~/Apps/wine-cellar-app/data/cellar.db
   sudo docker compose up -d
   ```

---

## Docker Compose Configuration

The production `docker-compose.yml` on Synology should contain:

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
sudo docker rmi ghcr.io/lbstrydom/wine-cellar-app:latest
sudo docker compose pull
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

**Manual approach**:
```bash
# On Synology (SSH)
cp ~/Apps/wine-cellar-app/data/cellar.db ~/cellar.db
```
```powershell
# On Windows (use SFTP, not SCP)
echo "get /home/cellar.db ./data/cellar.db`nexit" | sftp lstrydom@192.168.86.31
```

### Environment variables not loading

Ensure `.env` file exists in `~/Apps/wine-cellar-app/` and restart the container.

### Container unhealthy

Check logs:
```bash
sudo docker logs wine-cellar
```

---

## Network Details

| Item | Value |
|------|-------|
| Synology IP | 192.168.86.31 |
| SSH User | lstrydom |
| App Port | 3000 |
| App URL | http://192.168.86.31:3000 |
