# CI/CD Setup: GitHub Actions + GHCR + Synology Auto-Update

## Goal

Set up automated Docker image builds and deployment:
- GitHub Actions builds and publishes Docker images to GHCR on push to main
- Synology pulls pre-built images instead of building locally
- Nightly auto-updates via DSM Task Scheduler

## Current Repository Info

- **GitHub Owner**: [YOUR_GITHUB_USERNAME]
- **Repository**: wine-cellar-app
- **Branch**: main

## Tasks

### 1. Create GitHub Actions Workflow

Create `.github/workflows/docker-publish.yml`:
````yaml
name: Build and Publish Docker Image

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest
            type=sha,prefix=

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
````

### 2. Update Dockerfile for Production

Ensure `Dockerfile` is optimised:
````dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/
COPY public/ ./public/
COPY data/schema.sql ./data/

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/stats || exit 1

CMD ["node", "src/server.js"]
````

### 3. Create Synology-specific Compose File

Create `docker-compose.synology.yml` (for Synology deployment):
````yaml
services:
  wine-cellar:
    image: ghcr.io/[YOUR_GITHUB_USERNAME]/wine-cellar-app:latest
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
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/stats"]
      interval: 30s
      timeout: 5s
      retries: 3
````

### 4. Keep Original Compose for Local Development

Keep `docker-compose.yml` as-is for local development (builds from source).

### 5. Add .dockerignore

Create `.dockerignore`:
````
node_modules
npm-debug.log
.git
.gitignore
.env
*.md
data/cellar.db
data/cellar.db-wal
data/cellar.db-shm
````

### 6. Documentation

Create `DEPLOYMENT.md`:
````markdown
# Deployment Guide

## Initial Synology Setup

### 1. Authenticate with GHCR

SSH into Synology and log in to GitHub Container Registry:
```bash
docker login ghcr.io -u [YOUR_GITHUB_USERNAME]
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
# Find available tags at: https://github.com/[USER]/wine-cellar-app/pkgs/container/wine-cellar-app

# Edit docker-compose.synology.yml, change:
image: ghcr.io/[USER]/wine-cellar-app:latest
# To:
image: ghcr.io/[USER]/wine-cellar-app:[SHA]

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
````

## Files to Create/Modify

| File | Action |
|------|--------|
| `.github/workflows/docker-publish.yml` | Create |
| `Dockerfile` | Update |
| `docker-compose.synology.yml` | Create |
| `.dockerignore` | Create |
| `DEPLOYMENT.md` | Create |

## After Implementation

1. Push to GitHub
2. Check Actions tab - workflow should run and publish image
3. On Synology:
   - `docker login ghcr.io -u [username]` (use PAT as password)
   - Copy `docker-compose.synology.yml` to Synology
   - Run `docker compose -f docker-compose.synology.yml pull`
   - Run `docker compose -f docker-compose.synology.yml up -d`
4. Set up Task Scheduler for auto-updates