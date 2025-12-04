# Dispatcharr Manager

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

### Using Docker Compose (Recommended)

```bash
docker-compose up -d
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

### Build Images
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

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.
