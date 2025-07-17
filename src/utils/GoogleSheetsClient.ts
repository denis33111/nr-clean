import { google, sheets_v4 } from 'googleapis';
import path from 'path';
import fs from 'fs';

export class GoogleSheetsClient {
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;

  constructor(spreadsheetId: string, keyFilePathOrJson: string) {
    let auth;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      // Use credentials from environment variable
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      // Fallback to file path
      auth = new google.auth.GoogleAuth({
        keyFile: keyFilePathOrJson,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = spreadsheetId;
  }

  async getRows(range: string): Promise<any[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });
    return res.data.values || [];
  }

  async appendRow(range: string, values: any[]): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });
  }

  async updateRow(range: string, values: any[]): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });
  }

  async updateCell(range: string, value: any): Promise<void> {
    // Update a single cell value
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[value]],
      },
    });
  }

  async getHeaderRow(headerRange: string = 'A2:2'): Promise<string[]> {
    // Convenience helper to fetch the header row once and reuse
    const rows = await this.getRows(headerRange);
    return (Array.isArray(rows) && rows.length > 0 ? (rows[0] as string[]) : []);
  }
} 