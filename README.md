# Wine Cellar App

Personal wine cellar management with visual grid layout and AI-powered pairing suggestions.

**Live at:** https://cellar.creathyst.com

## Features

- **Visual cellar grid** - See all bottles in their physical locations (Fridge F1-F9, Cellar R1-R19)
- **One-click drinking** - Tap a bottle, click "Drink", consumption logged automatically
- **Reduce-now list** - Prioritised bottles to drink down (aging, overstock)
- **AI Sommelier** - Claude-powered pairing suggestions for any dish
- **Rating aggregation** - Fetch ratings from 50+ sources
- **PWA Support** - Installable on any device, works offline
- **Mobile-friendly** - Works on phone, tablet, laptop

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL (Supabase) / SQLite (local)
- **AI**: Claude API (Anthropic)
- **Deployment**: Railway (auto-deploy from GitHub)
- **Domain**: Cloudflare DNS

## Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Run locally with SQLite
npm run dev
```

Open http://localhost:3000

## Deployment

The app auto-deploys to Railway when you push to the `main` branch.

```bash
# Deploy (just push to main)
git add -A && git commit -m "your message" && git push
```

Railway will:
1. Detect the push
2. Build the Docker image
3. Deploy with environment variables
4. Connect to Supabase PostgreSQL

### Environment Variables

Set in Railway dashboard:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude API key |
| `GOOGLE_SEARCH_API_KEY` | Google Search API key |
| `GOOGLE_SEARCH_ENGINE_ID` | Google CSE ID |
| `BRIGHTDATA_API_KEY` | BrightData API key |
| `BRIGHTDATA_SERP_ZONE` | BrightData SERP zone |
| `BRIGHTDATA_WEB_ZONE` | BrightData Web zone |

### Custom Domain

The app uses Cloudflare for DNS:
- Domain: `cellar.creathyst.com`
- CNAME: `qxi4wlbz.up.railway.app`

## Project Structure

```
wine-cellar-app/
├── src/
│   ├── server.js           # Express app entry point
│   ├── routes/             # API endpoints
│   ├── services/           # Business logic
│   ├── config/             # Configuration
│   └── db/                 # Database abstraction
├── public/
│   ├── index.html          # Frontend UI
│   ├── css/                # Styles
│   └── js/                 # Frontend modules
├── data/
│   └── migrations/         # Database migrations
├── docs/                   # Documentation
├── Dockerfile
└── docker-compose.yml      # Local development
```

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
- `POST /api/pairing/natural` - AI pairing suggestions

## Documentation

- [CLAUDE.md](CLAUDE.md) - AI assistant coding guidelines
- [docs/STATUS.md](docs/STATUS.md) - Current status and features
- [docs/ROADMAP.md](docs/ROADMAP.md) - Development roadmap

## Troubleshooting

**View logs:**
```bash
railway logs
```

**Local development with PostgreSQL:**
```bash
DATABASE_URL="your-supabase-url" npm run dev
```

**Reset local SQLite:**
```bash
rm data/cellar.db
npm run dev  # Creates fresh database
```
