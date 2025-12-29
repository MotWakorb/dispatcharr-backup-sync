#!/bin/sh
set -e

# Fix permissions on data directory if running as root
# This handles the case where the volume was created with different ownership
if [ "$(id -u)" = "0" ]; then
    # Ensure data directory exists and has correct ownership
    mkdir -p /data/uploads /data/backup
    chown -R nodejs:nodejs /data

    # Drop privileges and run as nodejs user
    exec su-exec nodejs "$@"
else
    # Already running as non-root, just ensure directories exist
    mkdir -p /data/uploads /data/backup 2>/dev/null || true
    exec "$@"
fi
