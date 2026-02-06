import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RingAlarmMonitor, AlarmEvent } from './ring-monitor.js';
import { GoogleSheetsLogger } from './sheets-logger.js';
import { bufferTime, filter } from 'rxjs/operators';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, '../.env');

// Configuration from environment variables
const config = {
  ringRefreshToken: process.env.RING_REFRESH_TOKEN,
  serviceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './src/service_account.json',
  spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
  sheetName: process.env.GOOGLE_SHEET_NAME || 'Ring Events',
  batchInterval: parseInt(process.env.BATCH_INTERVAL_MS || '5000', 10),
};

function validateConfig(): void {
  const required = [
    ['RING_REFRESH_TOKEN', config.ringRefreshToken],
    ['GOOGLE_SPREADSHEET_ID', config.spreadsheetId],
  ] as const;

  const missing = required.filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((name) => console.error(`   - ${name}`));
    console.error('\nPlease copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

async function updateEnvFile(oldToken: string, newToken: string): Promise<void> {
  try {
    if (fs.existsSync(ENV_FILE)) {
      const content = fs.readFileSync(ENV_FILE, 'utf-8');
      const updated = content.replace(oldToken, newToken);
      fs.writeFileSync(ENV_FILE, updated, 'utf-8');
      console.log('🔄 Updated refresh token in .env file');
    }
  } catch (error) {
    console.error('⚠️ Failed to update .env file with new refresh token:', error);
    console.log('⚠️ Please manually update RING_REFRESH_TOKEN in your .env file:');
    console.log(`   ${newToken}`);
  }
}

async function main(): Promise<void> {
  console.log('🏠 Ring Alarm to Google Sheets Monitor');
  console.log('=====================================\n');

  validateConfig();

  // Initialize Google Sheets logger
  const sheetsLogger = new GoogleSheetsLogger(
    config.serviceAccountPath,
    config.spreadsheetId!,
    config.sheetName
  );

  await sheetsLogger.initialize();

  // Initialize Ring monitor
  const ringMonitor = new RingAlarmMonitor(config.ringRefreshToken!);

  // Handle refresh token updates (CRITICAL for push notifications to work)
  ringMonitor.onRefreshTokenUpdate.subscribe(async ({ newRefreshToken, oldRefreshToken }) => {
    console.log('🔑 Refresh token updated');
    await updateEnvFile(oldRefreshToken, newRefreshToken);
  });

  // Buffer events and batch write to Google Sheets
  // This prevents too many API calls if many events happen quickly
  ringMonitor.onEvent
    .pipe(
      bufferTime(config.batchInterval),
      filter((events): events is AlarmEvent[] => events.length > 0)
    )
    .subscribe(async (events) => {
      try {
        await sheetsLogger.logEvents(events);
        console.log(`✅ Logged ${events.length} event(s) to Google Sheets`);
      } catch (error) {
        console.error('❌ Failed to log events:', error);
      }
    });

  // Start monitoring
  await ringMonitor.start();

  console.log('\n🎯 Monitoring Ring alarm events...');
  console.log('Press Ctrl+C to stop\n');

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n\n👋 Shutting down...');
    ringMonitor.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
