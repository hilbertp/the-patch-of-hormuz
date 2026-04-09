FROM node:20-slim

WORKDIR /app

# Install the Claude CLI globally — this provides the `claude` binary
# that watcher.js invokes via `claude -p`.
RUN npm install -g @anthropic-ai/claude-code

# Copy application source.
# bridge/ and .claude/ are volume-mounted at runtime, but we copy them
# here so the image works standalone (volumes override at container start).
COPY bridge/ ./bridge/
COPY dashboard/ ./dashboard/

# Entrypoint script starts both services.
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 4747

ENTRYPOINT ["/app/docker-entrypoint.sh"]
