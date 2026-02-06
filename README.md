# Ring Alarm to Google Sheets Monitor

Monitor Ring Alarm events in real-time and automatically log them to Google Sheets.

## Features

- 🔔 Real-time monitoring of Ring Alarm events
- 📊 Automatic logging to Google Sheets
- 🔄 Automatic refresh token management
- 📦 Batched writes to avoid API rate limits
- 🐳 Docker support for easy deployment
- 🎯 Monitors: contact sensors, motion sensors, alarm state changes, doorbell presses, and more

## Prerequisites

- Node.js 20+ (or Docker)
- A Ring account with Ring Alarm
- A Google Cloud project with Sheets API enabled

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Get Ring Refresh Token

Run the Ring authentication CLI:

```bash
npm run auth
```

This will prompt you for your Ring email, password, and 2FA code. Copy the refresh token that's output.

> ⚠️ **Important**: The refresh token is updated periodically. This app automatically saves new tokens to your `.env` file. If you don't save token updates, push notifications (motion/doorbell events) will stop working.

### 3. Set Up Google Sheets API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
4. Go to [Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
5. Create a new service account
6. Create a JSON key for the service account
7. Save the JSON key file as `src/service_account.json`

### 4. Create Google Sheet

1. Create a new Google Sheet
2. Copy the spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
3. **Share the sheet** with your service account email (found in the JSON key file) with Editor access

### 5. Configure Environment

```bash
cp .env.example .env
cp src/service_account.json.example src/service_account.json
```

Edit `.env` with your values:

```env
RING_REFRESH_TOKEN=your_token_here
GOOGLE_SERVICE_ACCOUNT_PATH=./src/service_account.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEET_NAME=Ring Events
```

Replace `src/service_account.json` with your actual service account key file.

### 6. Run the Monitor

Development mode (with hot reload):
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

## Docker Deployment

### Quick Start with Docker Compose

1. **Build and run:**
   ```bash
   npm run build
   docker-compose up -d
   ```

2. **View logs:**
   ```bash
   docker-compose logs -f
   ```

3. **Stop:**
   ```bash
   docker-compose down
   ```

### Deploy to VPS

1. Copy `deploy.sh.example` to `deploy.sh` and update the server details:
   ```bash
   cp deploy.sh.example deploy.sh
   chmod +x deploy.sh
   # Edit deploy.sh with your server IP and path
   ```

2. Run the deploy script:
   ```bash
   ./deploy.sh
   ```

Or manually copy these files to your VPS:
   ```
   dist/
   src/service_account.json
   package.json
   package-lock.json
   Dockerfile
   docker-compose.yml
   .env
   ```

2. Build and start:
   ```bash
   docker-compose up -d --build
   ```

The container will:
- Automatically restart on failure
- Persist refresh token updates to the mounted `.env` file
- Keep logs limited to 10MB (3 rotated files)

## Events Logged

| Event Type | Description |
|------------|-------------|
| `alarm_away` | Alarm armed in Away mode |
| `alarm_home` | Alarm armed in Home mode |
| `alarm_disarmed` | Alarm disarmed |
| `alarm_triggered` | Alarm is actively sounding |
| `sensor_opened` | Contact sensor opened (door/window) |
| `sensor_closed` | Contact sensor closed |
| `motion_detected` | Motion sensor triggered |
| `doorbell_pressed` | Doorbell button pressed |
| `lock_locked` | Smart lock locked |
| `lock_unlocked` | Smart lock unlocked |
| `low_battery` | Device battery below 20% |
| `tamper_detected` | Device tamper detected |
| `smoke_co_alarm` | Smoke or CO alarm triggered |
| `flood_freeze_alert` | Flood or freeze sensor triggered |
| `connected` | Hub connected |
| `disconnected` | Hub disconnected |

## Google Sheet Format

The events are logged with these columns:

| Column | Description |
|--------|-------------|
| Timestamp | ISO 8601 timestamp |
| Location | Ring location name |
| Location ID | Ring location ID |
| Device | Device name |
| Device Type | Type of device |
| Event Type | Type of event |
| Details | JSON with additional details |

## Running as a Service

To run continuously, you can use PM2:

```bash
npm install -g pm2
pm2 start npm --name "ring-monitor" -- start
pm2 save
pm2 startup
```

Or create a systemd service on Linux.

## Troubleshooting

### "No devices found"
- Make sure you're using the correct Ring account (the one with the Ring Alarm)
- Try deleting the `.env` file and re-running `npm run auth`

### "getDevices() timed out"
- Update `ring-client-api` to the latest version: `npm install ring-client-api@latest`
- Check your network/firewall allows WebSocket connections to `*.prd.rings.solutions`

### "Push notifications not working"
- This happens when the refresh token isn't being saved properly
- Delete the device from Ring Control Center in the Ring app
- Re-run `npm run auth` to get a fresh token
- Make sure the app is running continuously to save token updates

### "Google Sheets API error"
- Verify the Sheets API is enabled in Google Cloud Console
- Make sure you shared the spreadsheet with the service account email
- Check that the service_account.json file is valid

### Docker issues
- View logs: `docker-compose logs -f`
- Rebuild after changes: `docker-compose up -d --build`
- Check .env is mounted: `docker exec ring-alarm-monitor cat /app/.env`

## License

MIT
