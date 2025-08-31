import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../../utils/GoogleSheetsClient';
import { Logger } from '../../utils/Logger';

export class CheckInOutFlow {
  private bot: TelegramBot;
  private sheetsClient: GoogleSheetsClient;
  private logger: Logger;

  constructor(bot: TelegramBot, sheetsClient: GoogleSheetsClient, logger: Logger) {
    this.bot = bot;
    this.sheetsClient = sheetsClient;
    this.logger = logger;
  }

  async start(chatId: number, userId: number): Promise<void> {
    try {
      this.logger.info(`Starting check-in/out flow for user ${userId}`);
      
      // Show working user main menu
      await this.showMainMenu(chatId, userId);
      
    } catch (error) {
      this.logger.error(`Error starting check-in/out flow for user ${userId}:`, error);
      await this.bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
  }

  private async showMainMenu(chatId: number, userId: number): Promise<void> {
    // Get user info from sheets
    const userInfo = await this.sheetsClient.getWorkersSheet();
    const userRow = userInfo.find(row => row[1] === userId.toString());
    const userName = userRow ? userRow[0] : 'Worker';
    
    const message = `Καλώς ήρθατε, ${userName}! Τι θα θέλατε να κάνετε;`;
    const keyboard = {
      keyboard: [
        [
          { text: '✅ Check In' },
          { text: '❌ Check Out' }
        ],
        [
          { text: '📅 Πρόγραμμα' }
        ],
        [
          { text: '📱 Επικοινωνία Υποστήριξης' }
        ]
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: false
    };

    await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }

  public async handleCheckIn(chatId: number, _userId: number): Promise<void> {
    const message = `📍 Για check-in, πατήστε το κουμπί παρακάτω και βεβαιωθείτε ότι είστε στη σωστή ζώνη:`;
    
    const keyboard = {
      keyboard: [
        [{ text: '📍 Στείλε την τοποθεσία μου', request_location: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    };
    
    await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }

  public async handleCheckOut(chatId: number, _userId: number): Promise<void> {
    const message = `📍 Για check-out, πατήστε το κουμπί παρακάτω και βεβαιωθείτε ότι είστε στη σωστή ζώνη:`;
    
    const keyboard = {
      keyboard: [
        [{ text: '📍 Στείλε την τοποθεσία μου', request_location: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    };
    
    await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }

  public async handleSchedule(chatId: number, userId: number): Promise<void> {
    try {
      // Get user info from sheets
      const userInfo = await this.sheetsClient.getWorkersSheet();
      const userRow = userInfo.find(row => row[1] === userId.toString());
      const userName = userRow ? userRow[0] : 'Worker';
      
      if (!userName) {
        await this.bot.sendMessage(chatId, '❌ Σφάλμα: Ο χρήστης δεν βρέθηκε.');
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
          await this.bot.sendMessage(chatId, message);
        } else {
          const message = `📅 Δεν υπάρχει πρόγραμμα για σήμερα (${today.toLocaleDateString('el-GR')})`;
          await this.bot.sendMessage(chatId, message);
        }
      } catch (error) {
        this.logger.error('Error getting schedule data:', error);
        await this.bot.sendMessage(chatId, '❌ Σφάλμα κατά την ανάκτηση του προγράμματος.');
      }
    } catch (error) {
      this.logger.error('Error handling schedule request:', error);
      await this.bot.sendMessage(chatId, '❌ Σφάλμα κατά την επεξεργασία της αίτησης προγράμματος.');
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
      const scheduleData = await this.sheetsClient.getCellValue(range);
      
      if (scheduleData && scheduleData.trim() !== '') {
        return scheduleData;
      }
      
      return null;
    } catch (error) {
      this.logger.error('Error getting schedule data:', error);
      throw error;
    }
  }

  /**
   * Find user row in monthly sheet
   */
  private async findUserRowInMonthlySheet(userName: string, sheetName: string): Promise<number> {
    try {
      const data = await this.sheetsClient.getRows(`${sheetName}!A:A`);
      if (!data || data.length === 0) return -1;
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (row && row[0] === userName) {
          return i + 1; // Google Sheets is 1-indexed
        }
      }
      return -1;
    } catch (error) {
      this.logger.error(`Error finding user row in ${sheetName}:`, error);
      return -1;
    }
  }

  /**
   * Find day column in monthly sheet
   */
  private async findDayColumnInMonthlySheet(day: number, sheetName: string): Promise<string> {
    try {
      this.logger.info(`Searching for day ${day} in sheet ${sheetName}`);
      
      const data = await this.sheetsClient.getRows(`${sheetName}!2:2`);
      if (!data || data.length === 0) {
        this.logger.error(`No data found in sheet ${sheetName} row 2`);
        return '';
      }
      
      const firstRow = data[0];
      if (!firstRow) {
        this.logger.error(`First row is empty in sheet ${sheetName}`);
        return '';
      }
      
      this.logger.info(`Header row has ${firstRow.length} columns: ${JSON.stringify(firstRow)}`);
      
      const targetDay = day.toString().padStart(2, '0');
      this.logger.info(`Looking for day pattern: ${targetDay}/`);
      
      for (let i = 0; i < firstRow.length; i++) {
        const cellValue = firstRow[i];
        this.logger.info(`Column ${i}: "${cellValue}" (looking for pattern ${targetDay}/)`);
        
        if (cellValue && cellValue.includes(`${targetDay}/`)) {
          const columnLetter = this.columnIndexToLetter(i);
          this.logger.info(`Found day ${day} at column ${columnLetter} (index ${i})`);
          return columnLetter;
        }
      }
      
      this.logger.error(`Day ${day} not found in any column. Available columns: ${JSON.stringify(firstRow)}`);
      return '';
    } catch (error) {
      this.logger.error(`Error finding day column in ${sheetName}:`, error);
      return '';
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

  public async handleContactSupport(chatId: number, _userId: number): Promise<void> {
    const keyboard = {
      inline_keyboard: [
        [
          { 
            text: '📱 Contact Support', 
            url: 'https://t.me/DenisZgl'
          }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, 'Click the button below to contact support:', { 
      reply_markup: keyboard 
    });
  }
}
