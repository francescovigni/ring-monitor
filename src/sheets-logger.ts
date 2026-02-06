import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { AlarmEvent } from './ring-monitor.js';

export class GoogleSheetsLogger {
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;
  private sheetName: string;

  constructor(
    serviceAccountPath: string,
    spreadsheetId: string,
    sheetName: string = 'Ring Events'
  ) {
    this.spreadsheetId = spreadsheetId;
    this.sheetName = sheetName;

    // Load service account credentials from JSON file
    const absolutePath = path.isAbsolute(serviceAccountPath)
      ? serviceAccountPath
      : path.resolve(process.cwd(), serviceAccountPath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Service account file not found: ${absolutePath}`);
    }

    const credentials = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));

    // Authenticate with Google Sheets API using service account
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async initialize(): Promise<void> {
    console.log('📊 Initializing Google Sheets connection...');

    try {
      // Check if sheet exists, if not create headers
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A1:G1`,
      });

      if (!response.data.values || response.data.values.length === 0) {
        // Create headers
        await this.createHeaders();
      }

      console.log('✅ Google Sheets connected successfully');
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      if (err.code === 400 || err.message?.includes('Unable to parse range')) {
        // Sheet might not exist, try to create it
        console.log(`📝 Sheet "${this.sheetName}" not found, creating headers...`);
        await this.createHeaders();
      } else {
        throw error;
      }
    }
  }

  private async createHeaders(): Promise<void> {
    const headers = [
      ['Timestamp', 'Location', 'Location ID', 'Device', 'Device Type', 'Event Type', 'Details'],
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A1:G1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: headers,
      },
    });

    console.log('✅ Created sheet headers');
  }

  async logEvent(event: AlarmEvent): Promise<void> {
    const row = [
      event.timestamp.toISOString(),
      event.locationName,
      event.locationId,
      event.deviceName,
      event.deviceType,
      event.eventType,
      JSON.stringify(event.details),
    ];

    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:G`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [row],
        },
      });
    } catch (error) {
      console.error('❌ Failed to log event to Google Sheets:', error);
      throw error;
    }
  }

  async logEvents(events: AlarmEvent[]): Promise<void> {
    if (events.length === 0) return;

    const rows = events.map((event) => [
      event.timestamp.toISOString(),
      event.locationName,
      event.locationId,
      event.deviceName,
      event.deviceType,
      event.eventType,
      JSON.stringify(event.details),
    ]);

    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:G`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rows,
        },
      });
    } catch (error) {
      console.error('❌ Failed to log events to Google Sheets:', error);
      throw error;
    }
  }
}
