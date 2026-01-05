#!/bin/sh
# Startup script for Wine Cellar App
# Handles both local Docker and Fly.io deployments

set -e

# Determine data directory
# Fly.io mounts volume at /data, local Docker uses /app/data
if [ -d "/data" ] && [ -w "/data" ]; then
    export DATA_DIR="/data"
    echo "Using Fly.io volume at /data"
else
    export DATA_DIR="/app/data"
    echo "Using local data directory at /app/data"
fi

# Ensure schema and migrations are available in data directory
if [ ! -f "$DATA_DIR/schema.sql" ]; then
    cp /app/data/schema.sql "$DATA_DIR/" 2>/dev/null || true
fi

if [ ! -d "$DATA_DIR/migrations" ]; then
    cp -r /app/data/migrations "$DATA_DIR/" 2>/dev/null || true
fi

# Start the application
exec node src/server.js
