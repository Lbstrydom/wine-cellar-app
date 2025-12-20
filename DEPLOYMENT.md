# Deployment Guide

## Initial Synology Setup

### 1. Authenticate with GHCR

SSH into Synology and log in to GitHub Container Registry:
```bash
docker login ghcr.io -u Lbstrydom
```

When prompted for password, use a GitHub Personal Access Token with `read:packages` scope.

### 2. Deploy
```bash
cd /volume1/homes/lstrydom/Apps/wine-cellar-app
# Use the Synology-specific compose file
docker compose -f docker-compose.synology.yml pull
docker compose -f docker-compose.synology.yml up -d
```

### 3. Set Up Auto-Updates (DSM Task Scheduler)

1. Open DSM → Control Panel → Task Scheduler
2. Create → Scheduled Task → User-defined script
3. Name: "Wine Cellar Update"
4. User: root
5. Schedule: Daily at 3:00 AM (or preferred time)
6. Task Settings → Run command:
```bash
cd /volume1/homes/lstrydom/Apps/wine-cellar-app
docker compose -f docker-compose.synology.yml pull
docker compose -f docker-compose.synology.yml up -d
docker image prune -f
```

## Manual Updates
```bash
ssh Lstrydom@100.121.86.46
cd ~/Apps/wine-cellar-app
docker compose -f docker-compose.synology.yml pull
docker compose -f docker-compose.synology.yml up -d
```

## Rollback

Images are tagged with git SHA. To rollback:
```bash
# Find available tags at: https://github.com/Lbstrydom/wine-cellar-app/pkgs/container/wine-cellar-app

# Edit docker-compose.synology.yml, change:
image: ghcr.io/lbstrydom/wine-cellar-app:latest
# To:
image: ghcr.io/lbstrydom/wine-cellar-app:[SHA]

# Then:
docker compose -f docker-compose.synology.yml up -d
```

## Local Development

Use the standard compose file (builds locally):
```bash
docker compose up -d --build
```

Or run without Docker:
```bash
npm install
npm start
```

## Environment Variables

Create a `.env` file on Synology with:
```
ANTHROPIC_API_KEY=your_api_key_here
```

The compose file will automatically read this file.
