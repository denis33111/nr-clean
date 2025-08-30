import { google } from 'googleapis';
import { Logger } from './Logger';

export class GoogleSheetsClient {
  private sheets: any;
  private spreadsheetId: string;
  private logger: Logger;

  constructor() {
    this.spreadsheetId = process.env['GOOGLE_SHEETS_ID'] || '';
    this.logger = new Logger();
  }

  async initialize(): Promise<void> {
    try {
      // Try to get credentials from environment variable first
      let credentials: any;
      
      if (process.env['GOOGLE_CREDENTIALS_JSON']) {
        // Use credentials from environment variable
        try {
          credentials = JSON.parse(process.env['GOOGLE_CREDENTIALS_JSON']);
          this.logger.info('Using Google credentials from environment variable');
        } catch (parseError) {
          this.logger.error('Failed to parse GOOGLE_CREDENTIALS_JSON:', parseError);
          throw new Error('Invalid GOOGLE_CREDENTIALS_JSON format');
        }
      } else if (process.env['GOOGLE_SERVICE_ACCOUNT_PATH']) {
        // Fallback to file path (for local development)
        const keyFile = process.env['GOOGLE_SERVICE_ACCOUNT_PATH'];
        this.logger.info('Using Google credentials from file path');
        
        const auth = new google.auth.GoogleAuth({
          keyFile: keyFile,
          scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        
        this.sheets = google.sheets({ version: 'v4', auth });
        this.logger.info('Google Sheets client initialized successfully');
        return;
      } else {
        throw new Error('Either GOOGLE_CREDENTIALS_JSON or GOOGLE_SERVICE_ACCOUNT_PATH environment variable is required');
      }
      
      // Use credentials object directly
      const auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      this.logger.info('Google Sheets client initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Google Sheets client:', error);
      throw error;
    }
  }

  async getWorkersSheet(): Promise<string[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'WORKERS!A:D'
      });

      return response.data.values || [];
    } catch (error) {
      this.logger.error('Failed to get WORKERS sheet:', error);
      throw error;
    }
  }

  async isUserInWorkersSheet(userId: number): Promise<boolean> {
    try {
      const workers = await this.getWorkersSheet();
      
      // Check if user ID exists in column B (ID column)
      return workers.some(row => row[1] === userId.toString());
    } catch (error) {
      this.logger.error(`Failed to check if user ${userId} is in WORKERS sheet:`, error);
      return false;
    }
  }

  async findUserInWorkersSheet(userId: number): Promise<{ rowIndex: number; name: string; status: string; language: string } | null> {
    try {
      const workers = await this.getWorkersSheet();
      
      // Find user by ID in column B (ID column)
      for (let i = 0; i < workers.length; i++) {
        const row = workers[i];
        if (row && row[1] === userId.toString()) {
          return {
            rowIndex: i + 1, // Convert to 1-based index for Google Sheets
            name: row[0] || '',
            status: row[2] || '',
            language: row[3] || ''
          };
        }
      }
      
      return null; // User not found
    } catch (error) {
      this.logger.error(`Failed to find user ${userId} in WORKERS sheet:`, error);
      return null;
    }
  }

  async getRegistrationSheet(): Promise<string[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Registration!A:T'
      });

      return response.data.values || [];
    } catch (error) {
      this.logger.error('Failed to get Registration sheet:', error);
      throw error;
    }
  }

  async appendToRegistrationSheet(values: string[]): Promise<number> {
    try {
      // Get current row count to calculate the new row number
      const currentRows = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Registration!A:R'
      });
      
      const currentRowCount = (currentRows.data.values || []).length;
      const newRowNumber = currentRowCount + 1; // +1 because rows are 1-indexed in Google Sheets
      
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Registration!A:R',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [values]
        }
      });

      this.logger.info(`Data appended to Registration sheet successfully at row ${newRowNumber}`);
      return newRowNumber;
    } catch (error) {
      this.logger.error('Failed to append to Registration sheet:', error);
      throw error;
    }
  }

  async addToWorkersSheet(name: string, userId: number, status: string = 'WORKING', language: string = 'en'): Promise<void> {
    try {
      // Check if user already exists in WORKERS sheet
      const existingUser = await this.findUserInWorkersSheet(userId);
      
      if (existingUser) {
        // User exists, update their status instead of creating new row
        const rowIndex = existingUser.rowIndex;
        const statusRange = `C${rowIndex}`; // STATUS column (C)
        await this.updateCell(statusRange, status);
        
        this.logger.info(`User ${userId} status updated to ${status} in existing row ${rowIndex}`);
      } else {
        // User doesn't exist, create new row
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: 'WORKERS!A:D',
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: {
            values: [[name, userId.toString(), status, language]]
          }
        });

        this.logger.info(`User ${userId} added to WORKERS sheet successfully`);
      }
    } catch (error) {
      this.logger.error(`Failed to add/update user ${userId} in WORKERS sheet:`, error);
      throw error;
    }
  }

  // Admin methods for AdminStep2Flow
  async getHeaderRow(): Promise<string[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Registration!A2:T2' // Read specifically Row 2 where headers are, including S and T
      });

      const rows = response.data.values || [];
      return rows[0] || []; // Return the first (and only) row from the range
    } catch (error) {
      this.logger.error('Failed to get header row:', error);
      throw error;
    }
  }

  async getRows(range: string): Promise<string[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range
      });

      return response.data.values || [];
    } catch (error) {
      this.logger.error(`Failed to get rows for range ${range}:`, error);
      throw error;
    }
  }

  async updateCell(range: string, value: string): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueInputOption: 'RAW',
        resource: {
          values: [[value]]
        }
      });

      this.logger.info(`Updated cell ${range} with value: ${value}`);
    } catch (error) {
      this.logger.error(`Failed to update cell ${range}:`, error);
      throw error;
    }
  }

  async getCellValue(range: string): Promise<string> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range
      });

      const rows = response.data.values || [];
      if (rows.length > 0 && rows[0].length > 0) {
        return rows[0][0] || '';
      }
      return '';
    } catch (error) {
      this.logger.error(`Failed to get cell value for range ${range}:`, error);
      return '';
    }
  }
}
