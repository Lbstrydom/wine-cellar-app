# Wine Cellar App

Personal wine cellar management with visual grid layout and AI-powered pairing suggestions.

## Features

- **Visual cellar grid** - See all bottles in their physical locations (Fridge F1-F9, Cellar R1-R19)
- **One-click drinking** - Tap a bottle, click "Drink", consumption logged automatically
- **Reduce-now list** - Prioritised bottles to drink down (aging, overstock)
- **Pairing suggestions** - Select dish characteristics, get matched bottles from your cellar
- **Mobile-friendly** - Works on phone, tablet, laptop

## Quick Start (Local Testing)

```bash
# Install dependencies
npm install

# Run migration (first time only, or to reset)
cd data && python3 migrate.py && cd ..

# Start server
npm start
```

Open http://localhost:3000

---

## Deployment on Synology DS223

### Prerequisites

1. **Tailscale installed** on Synology, phone, and laptop (you've done this ✓)
2. **Container Manager** (Docker) installed on Synology
   - Open Package Center → search "Container Manager" → Install

### Step 1: Copy files to Synology

Option A - Via File Station:
1. Open File Station on Synology
2. Navigate to a shared folder (e.g., `/docker` or `/volume1/docker`)
3. Create folder `wine-cellar`
4. Upload all files from this directory

Option B - Via SCP (from your PC):
```bash
scp -r wine-cellar-app/* your-user@synology-ip:/volume1/docker/wine-cellar/
```

### Step 2: Build and run with Docker Compose

SSH into Synology:
```bash
ssh your-user@synology-ip
cd /volume1/docker/wine-cellar
sudo docker-compose up -d --build
```

Or via Container Manager UI:
1. Open Container Manager
2. Go to Project → Create
3. Set path to `/volume1/docker/wine-cellar`
4. It will detect `docker-compose.yml` and build

### Step 3: Import your wine data

First time only - need to run the migration script:

```bash
# SSH into Synology
ssh your-user@synology-ip

# Copy your data files to the container's data folder
cp /path/to/inventory_layout.xlsx /volume1/docker/wine-cellar/data/
cp /path/to/reduce_now_priority.csv /volume1/docker/wine-cellar/data/
cp /path/to/pairing_matrix.csv /volume1/docker/wine-cellar/data/

# Run migration inside container
docker exec -it wine-cellar sh -c "cd /app/data && python3 migrate.py"
```

### Step 4: Access the app

From any device with Tailscale:
```
http://[synology-tailscale-ip]:3000
```

Find your Synology's Tailscale IP:
- Tailscale admin console: https://login.tailscale.com/admin/machines
- Or on Synology: `tailscale ip`

Bookmark this URL on your phone for quick access.

---

## File Structure

```
wine-cellar-app/
├── data/
│   ├── schema.sql          # Database schema
│   ├── migrate.py          # Data import script
│   └── cellar.db           # SQLite database (created on first run)
├── public/
│   └── index.html          # Frontend UI
├── src/
│   └── server.js           # Express API server
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

---

## API Reference

### Layout & Grid
- `GET /api/layout` - Full cellar layout with all slots and contents
- `GET /api/stats` - Summary stats (bottles, empty slots, etc.)

### Wines
- `GET /api/wines` - All wines with bottle counts
- `GET /api/wines/:id` - Single wine details
- `POST /api/wines` - Add new wine
- `PUT /api/wines/:id` - Update wine

### Slot Actions
- `POST /api/slots/move` - Move bottle between slots
- `POST /api/slots/:location/drink` - Log consumption, clear slot
- `POST /api/slots/:location/add` - Add bottle to empty slot

### Reduce Now
- `GET /api/reduce-now` - Prioritised drink-down list
- `POST /api/reduce-now` - Add wine to reduce list
- `DELETE /api/reduce-now/:wine_id` - Remove from list

### Pairing
- `GET /api/pairing-rules` - View pairing matrix
- `POST /api/pairing/suggest` - Get pairing suggestions for food signals

---

## Backup

The database is a single SQLite file. Backup options:

1. **Synology Hyper Backup** - Include `/volume1/docker/wine-cellar/data/`
2. **Manual copy** - `cp data/cellar.db data/cellar-backup-$(date +%Y%m%d).db`
3. **Cron job** - Add to Synology Task Scheduler

---

## Troubleshooting

**Container won't start:**
```bash
docker logs wine-cellar
```

**Database locked:**
```bash
docker restart wine-cellar
```

**Reset everything:**
```bash
docker-compose down
rm data/cellar.db
docker-compose up -d --build
# Re-run migration
```

**Update the app:**
```bash
# Pull latest code, then:
docker-compose down
docker-compose up -d --build
```
