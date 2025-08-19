import { google, sheets_v4 } from 'googleapis';
import path from 'path';
import fs from 'fs';

export class GoogleSheetsClient {
  private sheets: any;
  private spreadsheetId: string;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTimeout = 30000; // 30 seconds cache

  constructor(spreadsheetId: string, credentials: any) {
    this.spreadsheetId = spreadsheetId;
    this.sheets = google.sheets({ 
      version: 'v4', 
      auth: new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      })
    });
  }

  private getCacheKey(operation: string, range: string): string {
    return `${operation}:${range}`;
  }

  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.cacheTimeout;
  }

  private getCachedData(cacheKey: string): any | null {
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached.timestamp)) {
      console.log(`[GoogleSheetsClient] Using cached data for: ${cacheKey}`);
      return cached.data;
    }
    return null;
  }

  private setCachedData(cacheKey: string, data: any): void {
    this.cache.set(cacheKey, { data, timestamp: Date.now() });
    console.log(`[GoogleSheetsClient] Cached data for: ${cacheKey}`);
  }

  async getRows(range: string): Promise<string[][]> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey('rows', range);
    
    console.log(`[GoogleSheetsClient] getRows called for range ${range} at ${new Date().toISOString()}`);
    
    // Check cache first
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      console.log(`[GoogleSheetsClient] Rows from cache at ${new Date().toISOString()}, total time: ${Date.now() - startTime}ms`);
      return cachedData;
    }
    
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });
    
    const result = res.data.values || [];
    
    // Cache the result
    this.setCachedData(cacheKey, result);
    
    console.log(`[GoogleSheetsClient] Rows retrieved at ${new Date().toISOString()}, total time: ${Date.now() - startTime}ms`);
    return result;
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

  async getCellValue(range: string): Promise<string> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });
    
    const values = res.data.values;
    return values && values.length > 0 && values[0] && values[0].length > 0 ? values[0][0] : '';
  }

  // WORKERS sheet methods
  async getWorkersSheet(): Promise<string[][]> {
    try {
      return await this.getRows('WORKERS!A2:C1000');
    } catch (error) {
      console.error('[GoogleSheetsClient] Error accessing WORKERS sheet:', error);
      
      // If WORKERS sheet fails, try to access main sheet as fallback
      try {
        console.log('[GoogleSheetsClient] Falling back to main sheet for worker data');
        const mainSheetRows = await this.getRows("'Φύλλο1'!A3:Z1000");
        const mainSheetHeader = await this.getHeaderRow("'Φύλλο1'!A2:Z2");
        
        // Find relevant columns in main sheet
        const nameCol = mainSheetHeader.findIndex(h => h === 'NAME');
        const userIdCol = mainSheetHeader.findIndex(h => h === 'user id');
        const statusCol = mainSheetHeader.findIndex(h => h === 'STATUS');
        
        if (nameCol !== -1 && userIdCol !== -1 && statusCol !== -1) {
          // Convert main sheet data to worker format
          const workerRows: string[][] = [];
          for (const row of mainSheetRows) {
            if (row[nameCol] && row[userIdCol] && row[statusCol]) {
              workerRows.push([row[nameCol], row[userIdCol], row[statusCol]]);
            }
          }
          console.log(`[GoogleSheetsClient] Converted ${workerRows.length} rows from main sheet to worker format`);
          return workerRows;
        }
      } catch (fallbackError) {
        console.error('[GoogleSheetsClient] Fallback to main sheet also failed:', fallbackError);
      }
      
      // Return empty array if all else fails
      console.warn('[GoogleSheetsClient] Returning empty worker data due to sheet access errors');
      return [];
    }
  }

  async getWorkerById(userId: number): Promise<{ name: string; status: string; id: string } | null> {
    const workers = await this.getWorkersSheet();
    
    for (const row of workers) {
      if (row.length >= 3 && row[1] === userId.toString()) {
        return {
          name: row[0] || '',
          id: row[1] || '',
          status: row[2] || ''
        };
      }
    }
    return null;
  }

  async getWorkerByName(name: string): Promise<{ name: string; status: string; id: string } | null> {
    const workers = await this.getWorkersSheet();
    
    for (const row of workers) {
      if (row.length >= 3 && row[0]?.toLowerCase() === name.toLowerCase()) {
        return {
          name: row[0] || '',
          id: row[1] || '',
          status: row[2] || ''
        };
      }
    }
    return null;
  }

  async addWorker(name: string, userId: number, status: string = 'WORKING'): Promise<void> {
    await this.appendRow('WORKERS!A:C', [name, userId.toString(), status]);
    // Clear cache for WORKERS sheet to ensure fresh data
    this.clearCacheForWorkers();
  }

  async updateWorkerStatus(userId: number, status: string): Promise<void> {
    const workers = await this.getWorkersSheet();
    
    for (let i = 0; i < workers.length; i++) {
      const row = workers[i];
      if (row && row.length >= 2 && row[1] === userId.toString()) {
        const rowNumber = i + 2; // +2 because we start from A2
        await this.updateCell(`WORKERS!C${rowNumber}`, status);
        // Clear cache for WORKERS sheet to ensure fresh data
        this.clearCacheForWorkers();
        return;
      }
    }
  }

  async getHeaderRow(range?: string): Promise<string[]> {
    const startTime = Date.now();
    const rangeToUse = range || 'A2:Z2';
    const cacheKey = this.getCacheKey('header', rangeToUse);
    
    console.log(`[GoogleSheetsClient] getHeaderRow called at ${new Date().toISOString()}`);
    
    // Check cache first
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      console.log(`[GoogleSheetsClient] Header row from cache at ${new Date().toISOString()}, total time: ${Date.now() - startTime}ms`);
      return cachedData;
    }
    
    try {
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: rangeToUse,
      });
      
      console.log(`[GoogleSheetsClient] API response:`, res.data);
      
      const values = res.data.values;
      const result = values && values.length > 0 ? (values[0] as string[]) : [];
      
      // Cache the result
      this.setCachedData(cacheKey, result);
      
      console.log(`[GoogleSheetsClient] Header row retrieved at ${new Date().toISOString()}, total time: ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      console.error(`[GoogleSheetsClient] Error getting header row:`, error);
      throw error;
    }
  }

  // Clear cache for WORKERS sheet
  private clearCacheForWorkers(): void {
    const cacheKeys = Array.from(this.cache.keys());
    const workersKeys = cacheKeys.filter(key => key.includes('WORKERS'));
    workersKeys.forEach(key => this.cache.delete(key));
    console.log(`[GoogleSheetsClient] Cleared cache for WORKERS sheet`);
  }

  // Clear cache for month sheets
  public clearCacheForMonthSheet(sheetName: string): void {
    const cacheKeys = Array.from(this.cache.keys());
    const monthKeys = cacheKeys.filter(key => key.includes(sheetName));
    monthKeys.forEach(key => this.cache.delete(key));
    console.log(`[GoogleSheetsClient] Cleared cache for month sheet: ${sheetName}`);
  }
} 