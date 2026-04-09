#!/bin/sh
# Start the LCARS dashboard server in the background, then run the relay
# watcher as PID 1's foreground process. When the watcher exits (or the
# container is stopped), Docker will clean up the dashboard process.

echo "Starting LCARS dashboard server on port ${DASHBOARD_PORT:-4747}..."
node /app/dashboard/server.js &

echo "Starting relay watcher..."
exec node /app/bridge/watcher.js
