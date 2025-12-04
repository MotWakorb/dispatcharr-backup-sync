# Dispatcharr Manager

[![Build and Push Docker Images](https://github.com/MotWakorb/dispatcharr-backup-sync/actions/workflows/docker-build.yml/badge.svg)](https://github.com/MotWakorb/dispatcharr-backup-sync/actions/workflows/docker-build.yml)

A modern web-based GUI for managing Dispatcharr configurations. Sync channels, groups, profiles, DVR rules, users, and more between Dispatcharr instances.

## Features

- 🚀 **Modern Web UI** - Reactive interface built with Svelte
- 🔄 **Live Sync** - Real-time configuration synchronization
- 📦 **Export/Import** - Save configurations to YAML/JSON files
- 🗜️ **Compression** - Archive exports as ZIP or TAR.GZ
- 👥 **User Management** - Sync users (excluding admins) with XC credentials
- 📺 **DVR Support** - Sync recording rules and comskip config
- 🔌 **Plugin Sync** - Synchronize plugin settings
- 🖼️ **Logo Management** - Sync and download channel logos
- 🐳 **Docker Ready** - Easy deployment with Docker Compose

## Quick Start

### Using Pre-built Docker Images (Easiest)

```bash
# Create docker-compose.yml
cat > docker-compose.yml <<EOF
version: '3.8'

services:
  backend:
    image: ghcr.io/motwakorb/dispatcharr-backup-sync-backend:latest
    container_name: dispatcharr-manager-backend
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
    networks:
      - dispatcharr-manager

  frontend:
    image: ghcr.io/motwakorb/dispatcharr-backup-sync-frontend:latest
    container_name: dispatcharr-manager-frontend
    restart: unless-stopped
    ports:
      - "3000:80"
    depends_on:
      - backend
    networks:
      - dispatcharr-manager

networks:
  dispatcharr-manager:
    driver: bridge
EOF

# Start the application
docker-compose up -d
```

Access the application at: http://localhost:3000

### Building from Source

```bash
# Clone the repository
git clone https://github.com/MotWakorb/dispatcharr-backup-sync.git
cd dispatcharr-backup-sync

# Build and start with Docker Compose
docker-compose up -d --build
```

Access the application at: http://localhost:3000

### Manual Setup

#### Backend
```bash
cd backend
npm install
npm run dev
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Architecture

```
dispatcharr-manager/
├── backend/          # Node.js + Express API
│   ├── src/
│   │   ├── routes/   # API endpoints
│   │   ├── services/ # Business logic
│   │   └── types/    # TypeScript types
│   └── package.json
├── frontend/         # Svelte frontend
│   ├── src/
│   │   ├── routes/   # Pages
│   │   ├── lib/      # Components
│   │   └── stores/   # State management
│   └── package.json
└── docker/           # Docker configurations
    ├── backend.Dockerfile
    └── frontend.Dockerfile
```

## Configuration Options

### Sync Options
- Channel Groups
- Channel Profiles
- Channels
- M3U Sources
- Stream Profiles
- User Agents
- Core Settings
- Logos
- Plugins
- DVR Rules
- Comskip Config
- Users (non-admin)

### Export Options
- Format: YAML or JSON
- Compression: None, ZIP, or TAR.GZ
- Include logo files

## API Endpoints

### Sync
- `POST /api/sync` - Direct sync between instances
- `GET /api/sync/status/:jobId` - Get sync job status

### Export
- `POST /api/export` - Export configuration to file
- `GET /api/export/:jobId` - Download exported file

### Import
- `POST /api/import` - Import configuration from file

### Connections
- `POST /api/connections/test` - Test Dispatcharr connection
- `GET /api/connections/info` - Get instance information

## Environment Variables

```env
# Backend
PORT=3001
NODE_ENV=production

# Frontend
VITE_API_URL=http://localhost:3001
```

## Development

### Requirements
- Node.js 18+
- npm or pnpm

### Backend Development
```bash
cd backend
npm run dev
```

### Frontend Development
```bash
cd frontend
npm run dev
```

### Build for Production
```bash
# Backend
cd backend
npm run build

# Frontend
cd frontend
npm run build
```

## Docker

### Pre-built Images

Container images are automatically built and published to GitHub Container Registry on every commit to main:

- **Backend**: `ghcr.io/motwakorb/dispatcharr-backup-sync-backend:latest`
- **Frontend**: `ghcr.io/motwakorb/dispatcharr-backup-sync-frontend:latest`

Tags available:
- `latest` - Latest build from main branch
- `main` - Latest build from main branch
- `v*` - Semantic version tags (e.g., `v1.0.0`)
- `main-<sha>` - Specific commit SHA

### Build Images Locally
```bash
docker-compose build
```

### Run Services
```bash
docker-compose up -d
```

### View Logs
```bash
docker-compose logs -f
```

### Stop Services
```bash
docker-compose down
```

## CI/CD

GitHub Actions automatically builds and publishes Docker images on:
- Push to `main` branch
- New version tags (e.g., `v1.0.0`)
- Pull requests (build only, no push)

The workflow uses Docker BuildKit with layer caching for fast builds.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.
