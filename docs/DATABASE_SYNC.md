# Database Sync Guide

This guide explains how to sync the wine cellar database between your Synology NAS (production) and local development environment.

## Database Location

- **Synology (Docker)**: `~/Apps/wine-cellar-app/data/cellar.db` (or `/volume1/homes/<username>/Apps/wine-cellar-app/data/cellar.db`)
- **Local Development**: `data/cellar.db`

The database is a SQLite file, so syncing is simply a matter of copying the file.

---

## Syncing FROM Synology TO Local

Use this when you want to work with production data locally.

### Option 1: Using SCP (Recommended)

```bash
# From your local machine
scp user@synology-ip:/volume1/docker/wine-cellar/data/cellar.db ./data/cellar.db
```

### Option 2: Using Synology File Station

1. Open Synology DSM in browser
2. Open **File Station**
3. Navigate to `docker/wine-cellar/data/`
4. Right-click `cellar.db` → **Download**
5. Save to your local `data/` folder

### Option 3: Using rsync

```bash
rsync -avz user@synology-ip:/volume1/docker/wine-cellar/data/cellar.db ./data/
```

---

## Syncing FROM Local TO Synology

Use this when you want to push local changes to production.

**Warning**: This will overwrite production data. Make a backup first!

### Step 1: Stop the Container

```bash
ssh user@synology-ip
cd /volume1/docker/wine-cellar
sudo docker compose down
```

### Step 2: Backup Existing Database

```bash
cp data/cellar.db data/cellar.db.backup-$(date +%Y%m%d)
```

### Step 3: Copy New Database

```bash
# From local machine
scp ./data/cellar.db user@synology-ip:/volume1/docker/wine-cellar/data/cellar.db
```

### Step 4: Restart Container

```bash
ssh user@synology-ip
cd /volume1/docker/wine-cellar
sudo docker compose up -d
```

---

## Quick Commands Reference

```bash
# Download from Synology
scp user@SYNOLOGY_IP:~/Apps/wine-cellar-app/data/cellar.db ./data/

# Upload to Synology (after stopping container!)
scp ./data/cellar.db user@SYNOLOGY_IP:~/Apps/wine-cellar-app/data/

# SSH into Synology
ssh user@SYNOLOGY_IP

# Docker commands on Synology
cd /volume1/docker/wine-cellar
sudo docker compose down
sudo docker compose up -d
sudo docker logs wine-cellar
```

---

## Important Notes

1. **Always backup before overwriting** - SQLite files can be corrupted if copied while the app is writing
2. **Stop the container** before uploading a new database to prevent corruption
3. **Database migrations** run automatically on app startup, so schema differences are usually handled
4. The `data/` directory on Synology is mounted as a Docker volume, so changes persist across container restarts

---

## Troubleshooting

### "Database is locked" error
The app is still running. Stop the container first:
```bash
sudo docker compose down
```

### Permissions issues on Synology
The docker user may need ownership:
```bash
sudo chown 1000:1000 /volume1/docker/wine-cellar/data/cellar.db
```

### Database schema mismatch
If you get errors after syncing, the migrations should auto-run. If not:
```bash
sudo docker compose down
sudo docker compose up -d
sudo docker logs wine-cellar
```
Check logs for migration errors.
