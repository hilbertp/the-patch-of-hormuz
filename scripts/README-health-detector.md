# Host-Side Health Detector

Monitors the native orchestrator processes and dashboard API from the Mac host.
Reads `bridge/.run.pid` to check if both PIDs are alive. Polls `http://localhost:4747/api/health`
every 10 seconds. Writes status to `bridge/host-health.json` atomically. Fires a macOS
notification when the service has been down for 30+ seconds.

## Prerequisites

- macOS
- Liberation of Bajor started via `./scripts/start.sh` (creates `bridge/.run.pid`)
- Bash (ships with macOS)

## Install

1. Make the detector executable (if not already):

```bash
chmod +x scripts/host-health-detector.sh
```

2. Edit the plist to set your repo path. Open `scripts/com.liberation-of-bajor.health.plist`
   and update the two paths (`ProgramArguments` and `StandardErrorPath`) to point to your
   repo root (e.g., `/Users/you/liberation-of-bajor`).

3. Copy the plist and load it:

```bash
cp scripts/com.liberation-of-bajor.health.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.liberation-of-bajor.health.plist
```

## Verify

```bash
# Check the agent is running
launchctl list | grep liberation

# Check the status file
cat bridge/host-health.json

# Watch the log for state changes
tail -f bridge/host-health.log
```

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.liberation-of-bajor.health.plist
rm ~/Library/LaunchAgents/com.liberation-of-bajor.health.plist
```

## How it works

Every 10 seconds the detector:

1. Reads `bridge/.run.pid` and checks both PIDs are alive with `kill -0 $pid`.
2. Curls `http://localhost:4747/api/health` with a 3-second timeout.
3. Writes `bridge/host-health.json` atomically (write to `.tmp`, then `mv`).
4. On state change, appends a line to `bridge/host-health.log`.
5. If both checks have failed for 30+ consecutive seconds, fires a one-shot macOS notification.

The Ops dashboard reads `bridge/host-health.json` on its normal poll tick and shows a
"Service up" (green) or "Service down" (red) indicator. The Approve button is disabled when red.
