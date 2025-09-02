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
      console.log('🚀🚀🚀 [GoogleSheetsClient] initialize() called - starting authentication 🚀🚀🚀');
      this.logger.info('🚀 [GoogleSheetsClient] initialize() called - starting authentication');
      
      // Try to get credentials from environment variables
      let credentials: any;
      
      // DEBUG: Log what we're receiving
      this.logger.info('DEBUG: GOOGLE_PRIVATE_KEY exists:', !!process.env['GOOGLE_PRIVATE_KEY']);
      this.logger.info('DEBUG: GOOGLE_SERVICE_ACCOUNT_EMAIL exists:', !!process.env['GOOGLE_SERVICE_ACCOUNT_EMAIL']);
      this.logger.info('DEBUG: GOOGLE_SERVICE_ACCOUNT_PATH exists:', !!process.env['GOOGLE_SERVICE_ACCOUNT_PATH']);
      this.logger.info('DEBUG: GOOGLE_CREDENTIALS_JSON exists:', !!process.env['GOOGLE_CREDENTIALS_JSON']);
      this.logger.info('DEBUG: All environment variables:', Object.keys(process.env).filter(key => key.includes('GOOGLE')));
      
      if (process.env['GOOGLE_PRIVATE_KEY'] && process.env['GOOGLE_SERVICE_ACCOUNT_EMAIL']) {
        // Use individual environment variables (for Render)
        this.logger.info('DEBUG: Using Google credentials from individual environment variables');
        
        credentials = {
          type: 'service_account',
          project_id: 'newrest-465515',
          private_key_id: '3b18e53a334d61a9a207b9584f0d367a5d7e250e',
          private_key: process.env['GOOGLE_PRIVATE_KEY'],
          client_email: process.env['GOOGLE_SERVICE_ACCOUNT_EMAIL'],
          client_id: '110694577902197703065',
          auth_uri: 'https://accounts.google.com/o/oauth2/auth',
          token_uri: 'https://oauth2.googleapis.com/token',
          auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
          client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/newresttelegrambotservice%40newrest-465515.iam.gserviceaccount.com',
          universe_domain: 'googleapis.com'
        };
        
        this.logger.info('DEBUG: Successfully created credentials object from environment variables');
        this.logger.info('DEBUG: Credentials type:', credentials.type);
        this.logger.info('DEBUG: Credentials client_email:', credentials.client_email);
        this.logger.info('DEBUG: Credentials project_id:', credentials.project_id);
      } else if (process.env['GOOGLE_SERVICE_ACCOUNT_PATH']) {
        // Use file path method (for local development)
        const keyFile = process.env['GOOGLE_SERVICE_ACCOUNT_PATH'];
        this.logger.info('DEBUG: Using Google credentials from file path:', keyFile);
        
        const auth = new google.auth.GoogleAuth({
          keyFile: keyFile,
          scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        
        this.sheets = google.sheets({ version: 'v4', auth });
        this.logger.info('Google Sheets client initialized successfully with file path method');
        return;
      } else if (process.env['GOOGLE_CREDENTIALS_JSON']) {
        // Fallback to JSON environment variable
        try {
          credentials = JSON.parse(process.env['GOOGLE_CREDENTIALS_JSON']);
          this.logger.info('DEBUG: Successfully parsed credentials JSON');
          this.logger.info('DEBUG: Credentials type:', credentials.type);
          this.logger.info('DEBUG: Credentials client_email:', credentials.client_email);
          this.logger.info('DEBUG: Credentials project_id:', credentials.project_id);
          this.logger.info('Using Google credentials from environment variable');
        } catch (parseError) {
          this.logger.error('DEBUG: JSON parse error details:', parseError);
          this.logger.error('DEBUG: Raw GOOGLE_CREDENTIALS_JSON:', process.env['GOOGLE_CREDENTIALS_JSON']);
          this.logger.error('Failed to parse GOOGLE_CREDENTIALS_JSON:', parseError);
          throw new Error('Invalid GOOGLE_CREDENTIALS_JSON format');
        }
      } else {
        throw new Error('Either GOOGLE_PRIVATE_KEY + GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PATH, or GOOGLE_CREDENTIALS_JSON environment variable is required');
      }
      
      // Use credentials object directly
      this.logger.info('DEBUG: Creating GoogleAuth with credentials object');
      const auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      this.logger.info('Google Sheets client initialized successfully with credentials object method');
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
      // First, let's list all sheets to see what's available
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });
      
      const sheetNames = spreadsheet.data.sheets?.map(sheet => sheet.properties?.title) || [];
      this.logger.info('Available sheets:', sheetNames);
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'REGISTRATION!A:T'
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
