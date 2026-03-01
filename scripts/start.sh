#!/bin/sh
# Startup script for Wine Cellar App
# Handles local Docker and Railway deployments

set -e

# Set data directory for migrations and runtime files
export DATA_DIR="/app/data"
echo "Data directory: $DATA_DIR"

# Ensure schema and migrations are available
if [ ! -f "$DATA_DIR/schema.sql" ]; then
    cp /app/data/schema.sql "$DATA_DIR/" 2>/dev/null || true
fi

if [ ! -d "$DATA_DIR/migrations" ]; then
    cp -r /app/data/migrations "$DATA_DIR/" 2>/dev/null || true
fi

# Start the application
exec node src/server.js
