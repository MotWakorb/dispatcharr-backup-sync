# DBAS: Dispatcharr Backup and Sync

A web-based tool for backing up, restoring, and synchronizing [Dispatcharr](https://github.com/Dispatcharr/Dispatcharr) configuration between instances. Perfect for migrating from a development/test instance to production, creating backups, or keeping multiple Dispatcharr installations in sync.

## Features

- **Backup**: Create a complete backup of your Dispatcharr configuration to a downloadable ZIP file
- **Restore**: Restore a previously created backup to a Dispatcharr instance
- **Sync**: Two-way synchronization between a source and destination instance with granular control over what gets synced
- **Job Scheduler**: Automate recurring backups and syncs with flexible scheduling options
- **Backup Retention**: Automatically clean up old backups, keeping only the last X backups per schedule
- **Connection Management**: Save and manage multiple Dispatcharr instance connections
- **Job Tracking**: Real-time progress monitoring with detailed logs for all operations
- **Dry Run Mode**: Preview what changes would be made before committing them
- **Dark Mode**: Light, dark, or auto theme (follows system preference)
- **Update Notifications**: Automatic check for new releases with dismissible banner

### What Can Be Synced

| Category | Export | Import | Sync |
|----------|--------|--------|------|
| Channel Groups | Yes | Yes | Yes |
| Channel Profiles | Yes | Yes | Yes |
| Channels | Yes | Yes | Yes |
| M3U Sources | Yes | Yes | Yes |
| Stream Profiles | Yes | Yes | Yes |
| User Agents | Yes | Yes | Yes |
| Core Settings | Yes | Yes | Yes |
| EPG Sources | Yes | Yes | Yes |
| Plugins | Yes | Yes | Yes |
| DVR Rules | Yes | Yes | Yes |
| Comskip Config | Yes | Yes | Yes |
| Users | Yes | Yes | Yes |

## Quick Start with Docker Compose

DBAS runs entirely in Docker containers - no local installation required. It can run on any machine that has network access to your Dispatcharr instances (e.g., your home server, NAS, or even a different machine than where Dispatcharr is running).

### 1. Create a docker-compose.yml

```yaml
services:
  backend:
    image: ghcr.io/motwakorb/dispatcharr-backup-sync-backend:latest
    container_name: dispatcharr-manager-backend
    restart: unless-stopped
    ports:
      - "6002:6002"
    environment:
      - NODE_ENV=production
      - PORT=6002
      - DATA_DIR=/data
    volumes:
      - backend-data:/data
      - ./backups:/data/backup  # Optional: mount local directory for backups

  frontend:
    image: ghcr.io/motwakorb/dispatcharr-backup-sync-frontend:latest
    container_name: dispatcharr-manager-frontend
    restart: unless-stopped
    ports:
      - "6001:6001"
    depends_on:
      - backend

volumes:
  backend-data:
```

### 2. Start the Stack

```bash
docker compose up -d
```

### 3. Access the UI

Open `http://<docker-host>:6001` in your browser (e.g., `http://192.168.1.100:6001` or `http://myserver:6001`).

### 4. Verify Backend Health (Optional)

```bash
curl http://<docker-host>:6002/health
```

## Usage

### Connecting to Dispatcharr

1. Navigate to the **Settings** tab
2. Click **Create Connection**
3. Enter your Dispatcharr instance URL (e.g., `http://dispatcharr:5000`)
4. Enter your admin username and password
5. Click **Test Connection** to verify connectivity
6. Save the connection for use in Backup, Restore, and Sync operations

### Creating a Backup

1. Go to the **Backup** tab
2. Select or enter your source Dispatcharr instance
3. Choose which configuration areas to backup
4. Optionally enable **Dry Run** to preview without creating a file
5. Click **Start Backup**
6. Once complete, download the ZIP file from the Jobs tab

### Restoring a Backup

1. Go to the **Restore** tab
2. Select or enter your destination Dispatcharr instance
3. Upload a previously created backup ZIP file
4. Choose which configuration areas to restore
5. Optionally enable **Dry Run** to preview changes
6. Click **Start Restore**

### Syncing Between Instances

1. Go to the **Sync** tab
2. Configure your **Source** instance (where config comes from)
3. Configure your **Destination** instance (where config goes to)
4. Select which configuration areas to sync
5. Optionally enable **Dry Run** to preview changes
6. Click **Start Sync**

### Monitoring Jobs

The **Jobs** tab shows:
- Currently running jobs with real-time progress
- Job history with completion status
- Detailed logs for each job (click a job row to view)
- Download links for completed backups

### Scheduling Automated Jobs

The **Schedules** tab allows you to automate backups and syncs:

1. Click **Create Schedule**
2. Give your schedule a descriptive name
3. Select the job type (**Backup** or **Sync**)
4. Choose the source connection (and destination for sync jobs)
5. Configure the schedule frequency:
   - **Hourly**: Run every hour at a specific minute
   - **Daily**: Run once a day at a specific time
   - **Weekly**: Run on a specific day and time each week
   - **Monthly**: Run on a specific day of the month
   - **Custom**: Select multiple days of the week
6. Choose which configuration areas to include
7. For backup jobs, optionally set a **retention count** to automatically delete old backups (e.g., keep only the last 5 backups)
8. Enable the schedule and save

Scheduled jobs will run automatically at the configured times. You can:
- **Run Now**: Manually trigger a scheduled job
- **View History**: See past runs and their status
- **Enable/Disable**: Temporarily pause a schedule without deleting it
- **Edit**: Modify schedule settings at any time

**Note**: The scheduler uses your configured timezone from the Settings tab.

## Building from Source

### Build Docker Images Locally

```bash
# Clone the repository
git clone https://github.com/motwakorb/dispatcharr-backup-sync.git
cd dispatcharr-backup-sync

# Build images
docker build -t dispatcharr-backup-sync-backend:latest -f docker/backend.Dockerfile .
docker build -t dispatcharr-backup-sync-frontend:latest -f docker/frontend.Dockerfile .

# Start with local images
docker compose up -d
```

### Local Development

Run development servers in containers (no local Node.js installation required):

```bash
# Backend dev server (port 6002)
docker run --rm -it -v ${PWD}/backend:/app -w /app -p 6002:6002 node:20-alpine sh -c "npm install && npm run dev"

# Frontend dev server (port 6001)
docker run --rm -it -v ${PWD}/frontend:/app -w /app -p 6001:3000 node:20-alpine sh -c "npm install && npm run dev -- --host --port 3000"
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Node environment | `production` |
| `PORT` | Backend API port | `6002` |
| `DATA_DIR` | Persistent data directory | `/data` |

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Backend health check |
| `/api/connections/test` | POST | Test Dispatcharr connection |
| `/api/connections/info` | POST | Get instance info |
| `/api/export` | POST | Start export job |
| `/api/export/status/:jobId` | GET | Get export job status |
| `/api/export/download/:jobId` | GET | Download exported file |
| `/api/import` | POST | Start import job |
| `/api/import/status/:jobId` | GET | Get import job status |
| `/api/sync` | POST | Start sync job |
| `/api/sync/status/:jobId` | GET | Get sync job status |
| `/api/jobs` | GET | List active jobs |
| `/api/jobs/history/list` | GET | List completed jobs |
| `/api/jobs/:jobId/logs` | GET | Get job logs |
| `/api/jobs/:jobId/cancel` | POST | Cancel running job |
| `/api/saved-connections` | CRUD | Manage saved connections |
| `/api/schedules` | CRUD | Manage scheduled jobs |
| `/api/schedules/:id/run` | POST | Trigger manual run |
| `/api/schedules/:id/toggle` | POST | Enable/disable schedule |
| `/api/schedules/:id/history` | GET | Get schedule run history |
| `/api/settings` | GET/PUT | Manage app settings (timezone, time format, theme) |
| `/api/notifications/providers` | CRUD | Manage notification providers |
| `/api/notifications/settings` | GET/PUT | Manage notification settings |
| `/api/info` | GET | Get version info and update availability |

## Known Issues

### Logos Not Synced

Logo synchronization is currently **not supported**. The Dispatcharr API endpoint for uploading logos expects a specific content type that differs from standard JSON, making programmatic logo sync unreliable. Logos will need to be manually uploaded to your destination instance.

### M3U Auto Channel Sync Limitation

When syncing M3U sources, the **auto channel sync** feature cannot be properly preserved due to a Dispatcharr API limitation. The API does not expose or accept the auto channel sync configuration during M3U account creation/update.

**Workaround**: After syncing M3U sources, manually enable auto channel sync on the destination instance if needed:
1. Go to your destination Dispatcharr instance
2. Navigate to M3U Sources
3. Edit each M3U source and configure the auto channel sync settings as desired

### Custom Streams for Non-M3U Channels

Channels with direct URL streams (not from M3U sources) are handled specially during sync. The tool will attempt to create custom streams for these channels on the destination. This works for channels like weather feeds or other hand-configured streams with direct URLs.

### Comskip Config

If no comskip configuration exists on the source instance, it will be reported as "skipped" rather than synced. This is expected behavior - there's nothing to sync if no config exists.

## Data Persistence

- Job state and history are persisted to the `/data` volume
- Saved connections are stored in `/data/connections.json`
- Backup files are stored in `/data/backup/` - mount a local directory (e.g., `./backups:/data/backup`) for easy access to backup files from your host machine

## Running Tests

Run the Playwright smoke test against a running stack:

```bash
docker run --rm --network dispatcharr-backup-sync_dispatcharr-manager \
  -v ${PWD}/tests:/work -w /work node:20 sh -c "\
  npm install playwright@1.48.2 --no-save --no-package-lock && \
  npx playwright install --with-deps chromium && \
  node smoke.playwright.mjs"
```

## Roadmap

- ~~**Job Scheduler**: Schedule recurring sync and backup jobs to run automatically~~ (Added in v1.1.0)
- ~~**Notification System**: Alert on job success or failure via Discord, Email, Slack, and Telegram~~ (Added in v1.1.0)
- ~~**Dark Mode**: Light, dark, and auto theme support~~ (Added in v1.2.0)
- ~~**Version Display & Update Notifications**: Show current version and notify when updates are available~~ (Added in v1.2.0)
- **External Storage Export**: Export backups to common filesystems such as SMB shares, NAS shares, or object storage (S3, etc.)

## License

MIT
