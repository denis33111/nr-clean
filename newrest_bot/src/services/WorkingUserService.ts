import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
import { Logger } from '../utils/Logger';

export class WorkingUserService {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;
  private logger: Logger;
  private workingUserActions: Map<number, string> = new Map();

  /**
   * Get current user action (CHECK_IN or CHECK_OUT)
   */
  public getCurrentUserAction(userId: number): string | null {
    return this.workingUserActions.get(userId) || null;
  }

  /**
   * Set current user action
   */
  public setCurrentUserAction(userId: number, action: string): void {
    this.workingUserActions.set(userId, action);
  }

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient, logger: Logger) {
    this.bot = bot;
    this.sheets = sheets;
    this.logger = logger;
  }

  /**
   * Check if user is a working employee
   */
  public async isWorkingUser(userId: number): Promise<boolean> {
    try {
      const data = await this.sheets.getRegistrationSheet();
      if (!data || data.length < 3) return false;
      
      const headers = data[1];
      if (!headers) return false;
      
      const dataRows = data.slice(2);
      
      const userIdCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'USERID');
      const statusCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'STATUS');
      
      if (userIdCol === -1 || statusCol === -1) return false;
      
      const userRow = dataRows.find(row => row && parseInt(row[userIdCol] || '0', 10) === userId);
      return userRow ? userRow[statusCol] === 'WORKING' : false;
    } catch (error) {
      this.logger.error('[WorkingUserService] Error checking working user status:', error);
      return false;
    }
  }

  /**
   * Get working user's name from registration sheet
   */
  public async getWorkingUserName(userId: number): Promise<string | null> {
    try {
      const data = await this.sheets.getRegistrationSheet();
      if (!data || data.length < 3) return null;
      
      const headers = data[1];
      if (!headers) return null;
      
      const dataRows = data.slice(2);
      
      const userIdCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'USERID');
      const nameCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'NAME');
      
      if (userIdCol === -1 || nameCol === -1) return null;
      
      const userRow = dataRows.find(row => row && parseInt(row[userIdCol] || '0', 10) === userId);
      return userRow ? userRow[nameCol] || null : null;
    } catch (error) {
      this.logger.error('[WorkingUserService] Error getting working user name:', error);
      return null;
    }
  }

  /**
   * Show working user menu
   */
  public async showWorkingUserMenu(userId: number): Promise<void> {
    try {
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Check In', callback_data: 'working_checkin' },
            { text: '❌ Check Out', callback_data: 'working_checkout' }
          ],
          [
            { text: '📅 Πρόγραμμα', callback_data: 'working_schedule' }
          ],
          [
            { text: '📞 Contact', callback_data: 'contact' }
          ]
        ]
      };
      
      await this.bot.sendMessage(userId, 'Menu', { reply_markup: keyboard });
      this.logger.info(`[WorkingUserService] Working user menu shown to user ${userId}`);
    } catch (error) {
      this.logger.error('[WorkingUserService] Error showing working user menu:', error);
    }
  }

  /**
   * Handle check-in request
   */
  public async handleCheckInRequest(userId: number): Promise<void> {
    try {
      // Set current action to CHECK_IN
      this.setCurrentUserAction(userId, 'CHECK_IN');
      
      const message = `📍 Για check-in, πατήστε το κουμπί παρακάτω και βεβαιωθείτε ότι είστε στη σωστή ζώνη:`;
      
      const keyboard = {
        keyboard: [
          [{ text: '📍 Στείλε την τοποθεσία μου', request_location: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      
      await this.bot.sendMessage(userId, message, { reply_markup: keyboard });
      this.logger.info(`[WorkingUserService] Check-in location request sent to user ${userId}`);
    } catch (error) {
      this.logger.error('[WorkingUserService] Error handling check-in request:', error);
    }
  }

  /**
   * Handle check-out request
   */
  public async handleCheckOutRequest(userId: number): Promise<void> {
    try {
      // Set current action to CHECK_OUT
      this.setCurrentUserAction(userId, 'CHECK_OUT');
      
      const message = `📍 Για check-out, πατήστε το κουμπί παρακάτω και βεβαιωθείτε ότι είστε στη σωστή ζώνη:`;
      
      const keyboard = {
        keyboard: [
          [{ text: '📍 Στείλε την τοποθεσία μου', request_location: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      
      await this.bot.sendMessage(userId, message, { reply_markup: keyboard });
      this.logger.info(`[WorkingUserService] Check-out location request sent to user ${userId}`);
    } catch (error) {
      this.logger.error('[WorkingUserService] Error handling check-out request:', error);
    }
  }

  /**
   * Handle schedule request
   */
  public async handleScheduleRequest(userId: number): Promise<void> {
    try {
      const userName = await this.getWorkingUserName(userId);
      if (!userName) {
        await this.bot.sendMessage(userId, '❌ Σφάλμα: Ο χρήστης δεν βρέθηκε στους εργαζόμενους.');
        return;
      }

      // Get today's date
      const today = new Date();
      const monthYear = `${today.getFullYear()}/${today.getMonth() + 1}`;
      const day = today.getDate();
      
      try {
        // Try to get schedule data from the monthly sheet
        const scheduleData = await this.getScheduleData(userName, monthYear, day);
        
        if (scheduleData) {
          const message = `📅 Πρόγραμμα για ${userName} - ${today.toLocaleDateString('el-GR')}\n\n${scheduleData}`;
          await this.bot.sendMessage(userId, message);
        } else {
          const message = `📅 Δεν υπάρχει πρόγραμμα για σήμερα (${today.toLocaleDateString('el-GR')})`;
          await this.bot.sendMessage(userId, message);
        }
      } catch (error) {
        this.logger.error('[WorkingUserService] Error getting schedule data:', error);
        await this.bot.sendMessage(userId, '❌ Σφάλμα κατά την ανάκτηση του προγράμματος.');
      }
      
      this.logger.info(`[WorkingUserService] Schedule request handled for user ${userId}`);
    } catch (error) {
      this.logger.error('[WorkingUserService] Error handling schedule request:', error);
      await this.bot.sendMessage(userId, '❌ Σφάλμα κατά την επεξεργασία της αίτησης προγράμματος.');
    }
  }

  /**
   * Get schedule data for a specific user and date
   */
  private async getScheduleData(userName: string, monthYear: string, day: number): Promise<string | null> {
    try {
      const sheetName = monthYear;
      
      // Find the user row in the monthly sheet
      const userRow = await this.findUserRowInMonthlySheet(userName, sheetName);
      if (userRow === -1) {
        return null; // User not found in this month's sheet
      }
      
      // Find the day column
      const dayCol = await this.findDayColumnInMonthlySheet(day, sheetName);
      if (dayCol === '') {
        return null; // Day column not found
      }
      
      // Get the schedule data for this user and day
      const range = `${sheetName}!${dayCol}${userRow}`;
      const scheduleData = await this.sheets.getCellValue(range);
      
      if (scheduleData && scheduleData.trim() !== '') {
        return scheduleData;
      }
      
      return null;
    } catch (error) {
      this.logger.error('[WorkingUserService] Error getting schedule data:', error);
      throw error;
    }
  }

  /**
   * Process check-in with location
   */
  public async processCheckIn(userId: number): Promise<void> {
    try {
      const userName = await this.getWorkingUserName(userId);
      if (!userName) {
        await this.bot.sendMessage(userId, '❌ Error: User not found in working employees.');
        return;
      }

      const today = new Date();
      const monthYear = `${today.getFullYear()}/${today.getMonth() + 1}`;
      const day = today.getDate();
      
      // Store check-in data in the correct monthly sheet
      await this.storeCheckInOutData(userName, monthYear, day, 'CHECK-IN');
      
      const message = `✅ Check-in completed successfully!\n\n📅 Date: ${today.toLocaleDateString()}\n⏰ Time: ${today.toLocaleTimeString()}`;
      
      await this.bot.sendMessage(userId, message, { reply_markup: { remove_keyboard: true } });
      
      // Show check-out option after check-in
      setTimeout(() => {
        this.showCheckOutOption(userId);
      }, 1000);
      
      this.logger.info(`[WorkingUserService] Check-in processed for user ${userId} at ${today.toLocaleString()}`);
    } catch (error) {
      this.logger.error('[WorkingUserService] Error processing check-in:', error);
      await this.bot.sendMessage(userId, '❌ Error processing check-in. Please try again.');
    }
  }

  /**
   * Process check-out with location
   */
  public async processCheckOut(userId: number): Promise<void> {
    try {
      const userName = await this.getWorkingUserName(userId);
      if (!userName) {
        await this.bot.sendMessage(userId, '❌ Error: User not found in working employees.');
        return;
      }

      const today = new Date();
      const monthYear = `${today.getFullYear()}/${today.getMonth() + 1}`;
      const day = today.getDate();
      
      // Store check-out data in the correct monthly sheet
      await this.storeCheckInOutData(userName, monthYear, day, 'CHECK-OUT');
      
      const message = `✅ Check-out completed successfully!\n\n📅 Date: ${today.toLocaleDateString()}\n⏰ Time: ${today.toLocaleTimeString()}`;
      
      await this.bot.sendMessage(userId, message, { reply_markup: { remove_keyboard: true } });
      
      // Show check-in option after check-out
      setTimeout(() => {
        this.showCheckInOption(userId);
      }, 1000);
      
      this.logger.info(`[WorkingUserService] Check-out processed for user ${userId} at ${today.toLocaleString()}`);
    } catch (error) {
      this.logger.error('[WorkingUserService] Error processing check-out:', error);
      await this.bot.sendMessage(userId, '❌ Error processing check-out. Please try again.');
    }
  }

  /**
   * Store check-in/out data in the correct monthly sheet
   */
  private async storeCheckInOutData(userName: string, monthYear: string, day: number, action: string): Promise<void> {
    try {
      const sheetName = monthYear;
      const time = new Date().toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      
      // Find the correct row for the user in the monthly sheet
      let userRow = await this.findUserRowInMonthlySheet(userName, sheetName);
      
      // If user not found, add them to a new row
      if (userRow === -1) {
        userRow = await this.addUserToMonthlySheet(userName, sheetName);
        this.logger.info(`[WorkingUserService] Added new user ${userName} to sheet ${sheetName} at row ${userRow}`);
      }
      
      // Find the correct column for the day
      const dayCol = await this.findDayColumnInMonthlySheet(day, sheetName);
      if (dayCol === '') {
        throw new Error(`Day ${day} column not found in sheet ${sheetName}`);
      }
      
      // Get existing data in the cell
      const existingRange = `${sheetName}!${dayCol}${userRow}`;
      const existingData = await this.sheets.getCellValue(existingRange);
      
      let dataToStore = '';
      
      if (action === 'CHECK-IN') {
        // For check-in, store as "6:36 PM - " (enter time)
        dataToStore = `${time} - `;
      } else if (action === 'CHECK-OUT') {
        // For check-out, append to existing data: "6:36 PM - 6:39 PM"
        if (existingData && existingData.includes(' - ')) {
          dataToStore = `${existingData}${time}`;
        } else {
          dataToStore = ` - ${time}`;
        }
      }
      
      // Update the cell in the monthly sheet
      const range = `${sheetName}!${dayCol}${userRow}`;
      await this.sheets.updateCell(range, dataToStore);
      
      this.logger.info(`[WorkingUserService] Stored ${action} data for ${userName} in ${sheetName} at ${dayCol}${userRow}: ${dataToStore}`);
    } catch (error) {
      this.logger.error('[WorkingUserService] Error storing check-in/out data:', error);
      throw error;
    }
  }

  /**
   * Find user row in monthly sheet
   */
  private async findUserRowInMonthlySheet(userName: string, sheetName: string): Promise<number> {
    try {
      const data = await this.sheets.getRows(`${sheetName}!A:A`);
      if (!data || data.length === 0) return -1;
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (row && row[0] === userName) {
          return i + 1; // Google Sheets is 1-indexed
        }
      }
      return -1;
    } catch (error) {
      this.logger.error(`[WorkingUserService] Error finding user row in ${sheetName}:`, error);
      return -1;
    }
  }

  /**
   * Show check-out option after check-in
   */
  private async showCheckOutOption(userId: number): Promise<void> {
    try {
      const message = `✅ Check-in ολοκληρώθηκε! Τώρα μπορείτε να κάνετε check-out όταν τελειώσετε τη δουλειά.`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '❌ Check Out', callback_data: 'working_checkout' }
          ],
          [
            { text: '📅 Πρόγραμμα', callback_data: 'working_schedule' }
          ],
          [
            { text: '📞 Contact', callback_data: 'contact' }
          ]
        ]
      };
      
      await this.bot.sendMessage(userId, message, { reply_markup: keyboard });
      this.logger.info(`[WorkingUserService] Check-out option shown to user ${userId} after check-in`);
    } catch (error) {
      this.logger.error('[WorkingUserService] Error showing check-out option:', error);
    }
  }

  /**
   * Show check-in option after check-out
   */
  private async showCheckInOption(userId: number): Promise<void> {
    try {
      const message = `✅ Check-out ολοκληρώθηκε! Μπορείτε να κάνετε check-in ξανά αύριο.`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Check In', callback_data: 'working_checkin' },
            { text: '❌ Check Out', callback_data: 'working_checkout' }
          ],
          [
            { text: '📅 Πρόγραμμα', callback_data: 'working_schedule' }
          ],
          [
            { text: '📞 Contact', callback_data: 'contact' }
          ]
        ]
      };
      
      await this.bot.sendMessage(userId, message, { reply_markup: keyboard });
      this.logger.info(`[WorkingUserService] Full menu shown to user ${userId} after check-out`);
    } catch (error) {
      this.logger.error('[WorkingUserService] Error showing full menu after check-out:', error);
    }
  }

  /**
   * Find day column in monthly sheet
   */
  private async findDayColumnInMonthlySheet(day: number, sheetName: string): Promise<string> {
    try {
      this.logger.info(`[WorkingUserService] Searching for day ${day} in sheet ${sheetName}`);
      
      const data = await this.sheets.getRows(`${sheetName}!2:2`);
      if (!data || data.length === 0) {
        this.logger.error(`[WorkingUserService] No data found in sheet ${sheetName} row 2`);
        return '';
      }
      
      const firstRow = data[0];
      if (!firstRow) {
        this.logger.error(`[WorkingUserService] First row is empty in sheet ${sheetName}`);
        return '';
      }
      
      this.logger.info(`[WorkingUserService] Header row has ${firstRow.length} columns: ${JSON.stringify(firstRow)}`);
      
      const targetDay = day.toString().padStart(2, '0');
      this.logger.info(`[WorkingUserService] Looking for day pattern: ${targetDay}/`);
      
      for (let i = 0; i < firstRow.length; i++) {
        const cellValue = firstRow[i];
        this.logger.info(`[WorkingUserService] Column ${i}: "${cellValue}" (looking for pattern ${targetDay}/)`);
        
        if (cellValue && cellValue.includes(`${targetDay}/`)) {
          const columnLetter = this.columnIndexToLetter(i);
          this.logger.info(`[WorkingUserService] Found day ${day} at column ${columnLetter} (index ${i})`);
          return columnLetter;
        }
      }
      
      this.logger.error(`[WorkingUserService] Day ${day} not found in any column. Available columns: ${JSON.stringify(firstRow)}`);
      return '';
    } catch (error) {
      this.logger.error(`[WorkingUserService] Error finding day column in ${sheetName}:`, error);
      return '';
    }
  }

  /**
   * Add new user to monthly sheet
   */
  private async addUserToMonthlySheet(userName: string, sheetName: string): Promise<number> {
    try {
      // Get current data to find the next available row
      const data = await this.sheets.getRows(`${sheetName}!A:A`);
      const nextRow = (data?.length || 0) + 1;
      
      // Add user name to column A in the new row
      const range = `${sheetName}!A${nextRow}`;
      await this.sheets.updateCell(range, userName);
      
      this.logger.info(`[WorkingUserService] Added user ${userName} to sheet ${sheetName} at row ${nextRow}`);
      return nextRow;
    } catch (error) {
      this.logger.error(`[WorkingUserService] Error adding user to sheet ${sheetName}:`, error);
      throw error;
    }
  }

  /**
   * Convert column index to letter (0=A, 1=B, 2=C, etc.)
   */
  private columnIndexToLetter(index: number): string {
    let result = '';
    while (index >= 0) {
      result = String.fromCharCode(65 + (index % 26)) + result;
      index = Math.floor(index / 26) - 1;
    }
    return result;
  }

  /**
   * Handle callback queries for working user actions
   */
  public async handleWorkingUserCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    try {
      const { data, from } = query;
      if (!data || !from) return;

      const userId = from.id;

      switch (data) {
        case 'working_checkin':
          await this.handleCheckInRequest(userId);
          break;
        case 'working_checkout':
          await this.handleCheckOutRequest(userId);
          break;
        case 'working_schedule':
          await this.handleScheduleRequest(userId);
          break;
        case 'contact':
          // This will be handled by the main bot's contact flow
          await this.bot.answerCallbackQuery(query.id, { text: 'Contact feature coming soon!' });
          break;
      }
    } catch (error) {
      this.logger.error('[WorkingUserService] Error handling working user callback:', error);
    }
  }
}
