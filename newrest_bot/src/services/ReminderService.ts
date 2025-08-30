import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
import { Logger } from '../utils/Logger';

export class ReminderService {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;
  private logger: Logger;
  private intervalId: NodeJS.Timeout | null = null;
  private lastCleanupDate: string = (() => {
    const date = new Date().toISOString().split('T')[0];
    return date || '';
  })();

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient, logger: Logger) {
    this.bot = bot;
    this.sheets = sheets;
    this.logger = logger;
  }

  /**
   * Start the reminder service
   * Checks every 5 minutes for reminders that need to be sent
   */
  public start(): void {
    try {
      // Check every 5 minutes instead of cron
      this.intervalId = setInterval(async () => {
        await this.checkAndSendReminders();
      }, 300000); // 5 minutes = 300,000 ms

      this.logger.info('[ReminderService] Reminder service started successfully - checking every 5 minutes');
    } catch (error) {
      this.logger.error('[ReminderService] Failed to start reminder service:', error);
    }
  }

  /**
   * Stop the reminder service
   */
  public stop(): void {
    try {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.logger.info('[ReminderService] Reminder service stopped');
      }
    } catch (error) {
      this.logger.error('[ReminderService] Failed to stop reminder service:', error);
    }
  }

  /**
   * Main method to check and send reminders
   * Only processes reminders at specific times
   */
  private async checkAndSendReminders(): Promise<void> {
    try {
      const now = new Date();
      const greeceTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Athens' }));
      const currentHour = greeceTime.getHours();
      const currentMinute = greeceTime.getMinutes();

      // Check if it's time for day-before reminders (10:00 AM Greece time)
      if (currentHour === 10 && currentMinute === 0) {
        this.logger.info('[ReminderService] Time for day-before reminders (10:00 AM Greece time)');
        await this.processDayBeforeReminders();
      }

      // Check if it's time for course day reminders (9:55 AM Greece time)
      if (currentHour === 9 && currentMinute === 55) {
        this.logger.info('[ReminderService] Time for course day check-in reminders (9:55 AM Greece time)');
        await this.processCourseDayCheckInReminders();
      }

      // Check if it's time for check-out reminders (3:30 PM Greece time)
      if (currentHour === 15 && currentMinute === 30) {
        this.logger.info('[ReminderService] Time for course day check-out reminders (3:30 PM Greece time)');
        await this.processCourseDayCheckOutReminders();
      }

      // Clean up old data once per day
      await this.cleanupOldData();
      
    } catch (error) {
      this.logger.error('[ReminderService] Error in checkAndSendReminders:', error);
    }
  }

  /**
   * Process day-before reminders for candidates with courses tomorrow
   */
  private async processDayBeforeReminders(): Promise<void> {
    try {
      this.logger.info('[ReminderService] Starting day-before reminder processing...');
      
      const candidates = await this.getCandidatesForDayBeforeReminders();
      
      if (candidates.length === 0) {
        this.logger.info('[ReminderService] No candidates need day-before reminders today');
        return;
      }

      this.logger.info(`[ReminderService] Found ${candidates.length} candidates for day-before reminders`);

      for (const candidate of candidates) {
        await this.sendDayBeforeReminder(candidate);
        await this.delay(1000); // Rate limiting
      }

      this.logger.info('[ReminderService] Day-before reminder processing completed successfully');
    } catch (error) {
      this.logger.error('[ReminderService] Error in day-before reminder processing:', error);
    }
  }

  /**
   * Process course day check-in reminders
   */
  private async processCourseDayCheckInReminders(): Promise<void> {
    try {
      this.logger.info('[ReminderService] Starting course day check-in reminder processing...');
      
      const candidates = await this.getCandidatesForCourseDayReminders();
      
      if (candidates.length === 0) {
        this.logger.info('[ReminderService] No candidates need course day check-in reminders today');
        return;
      }

      this.logger.info(`[ReminderService] Found ${candidates.length} candidates for course day check-in reminders`);

      for (const candidate of candidates) {
        await this.sendCourseDayCheckInReminder(candidate);
        await this.delay(1000); // Rate limiting
      }

      this.logger.info('[ReminderService] Course day check-in reminder processing completed successfully');
    } catch (error) {
      this.logger.error('[ReminderService] Error in course day check-in reminder processing:', error);
    }
  }

  /**
   * Process course day check-out reminders
   */
  private async processCourseDayCheckOutReminders(): Promise<void> {
    try {
      this.logger.info('[ReminderService] Starting course day check-out reminder processing...');
      
      const candidates = await this.getCandidatesForCourseDayReminders();
      
      if (candidates.length === 0) {
        this.logger.info('[ReminderService] No candidates need course day check-out reminders today');
        return;
      }

      this.logger.info(`[ReminderService] Found ${candidates.length} candidates for course day check-out reminders`);

      for (const candidate of candidates) {
        await this.sendCourseDayCheckOutReminder(candidate);
        await this.delay(1000); // Rate limiting
      }

      this.logger.info('[ReminderService] Course day check-out reminder processing completed successfully');
    } catch (error) {
      this.logger.error('[ReminderService] Error in course day check-out reminder processing:', error);
    }
  }

  /**
   * Get candidates who need day-before reminders
   * Criteria: STATUS = "WAITING", COURSE_DATE = tomorrow, PRE_COURSE_REMINDER = empty
   */
  private async getCandidatesForDayBeforeReminders(): Promise<any[]> {
    try {
      const data = await this.sheets.getRegistrationSheet();
      
      if (!data || data.length < 3) {
        this.logger.warn('[ReminderService] No data found in Registration sheet');
        return [];
      }

      const headers = data[1]; // Row 2 contains headers
      if (!headers) {
        this.logger.error('[ReminderService] Headers not found in row 2');
        return [];
      }

      const dataRows = data.slice(2); // Data starts from row 3

      // Find column indices
      const statusCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'STATUS');
      const courseDateCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'COURSE_DATE');
      const preReminderCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'PRE_COURSE_REMINDER');
      const userIdCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'USERID');
      const nameCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'NAME');
      const languageCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'LANGUAGE');

      this.logger.info(`[ReminderService] Column indices - Status: ${statusCol}, CourseDate: ${courseDateCol}, PreReminder: ${preReminderCol}, UserId: ${userIdCol}, Name: ${nameCol}, Language: ${languageCol}`);

      if (statusCol === -1 || courseDateCol === -1 || preReminderCol === -1 || userIdCol === -1 || nameCol === -1 || languageCol === -1) {
        this.logger.error('[ReminderService] Required columns not found in headers');
        return [];
      }

      // Calculate tomorrow's date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD format

      this.logger.info(`[ReminderService] Looking for day-before reminders on: ${tomorrowStr}`);

      // Filter candidates
      const candidates = dataRows
        .filter((row) => {
          if (!row) return false;
          
          const status = row[statusCol];
          const courseDate = row[courseDateCol];
          const preReminder = row[preReminderCol];
          const userId = row[userIdCol];
          const name = row[nameCol];

          // Debug logging for each row
          this.logger.info(`[ReminderService] Row check - Status: ${status}, CourseDate: ${courseDate}, PreReminder: ${preReminder || 'EMPTY'}, UserId: ${userId}, Name: ${name}`);

          // Check if candidate needs day-before reminder
          // FIXED LOGIC: Look for PRE_REMINDER date that matches tomorrow
          return status === 'WAITING' && 
                 preReminder === tomorrowStr && // PRE_REMINDER column matches tomorrow
                 userId && 
                 name;
        })
        .map((row, index) => {
          if (!row) return null;
          
          return {
            rowIndex: index + 3, // Convert to actual sheet row number
            userId: parseInt(row[userIdCol] || '0', 10),
            name: row[nameCol] || 'Unknown',
            language: row[languageCol] || 'en',
            courseDate: row[courseDateCol] || '',
            statusCol,
            courseDateCol,
            preReminderCol,
            userIdCol,
            nameCol,
            languageCol
          };
        })
        .filter(candidate => candidate !== null) as any[];

      this.logger.info(`[ReminderService] Found ${candidates.length} candidates for day-before reminders on ${tomorrowStr}`);
      return candidates;

    } catch (error) {
      this.logger.error('[ReminderService] Error getting candidates for day-before reminders:', error);
      return [];
    }
  }

  /**
   * Get candidates who need course day reminders
   * Criteria: STATUS = "WORKING", COURSE_DATE = today, DAY_COURSE_REMINDER = empty
   */
  private async getCandidatesForCourseDayReminders(): Promise<any[]> {
    try {
      const data = await this.sheets.getRegistrationSheet();
      
      if (!data || data.length < 3) {
        this.logger.warn('[ReminderService] No data found in Registration sheet');
        return [];
      }

      const headers = data[1]; // Row 2 contains headers
      if (!headers) {
        this.logger.error('[ReminderService] Headers not found in row 2');
        return [];
      }

      const dataRows = data.slice(2); // Data starts from row 3

      // Find column indices
      const statusCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'STATUS');
      const courseDateCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'COURSE_DATE');
      const dayReminderCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'DAY_COURSE_REMINDER');
      const userIdCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'USERID');
      const nameCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'NAME');
      const languageCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'LANGUAGE');

      if (statusCol === -1 || courseDateCol === -1 || dayReminderCol === -1 || userIdCol === -1 || nameCol === -1 || languageCol === -1) {
        this.logger.error('[ReminderService] Required columns not found in headers');
        return [];
      }

      // Calculate today's date
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

      this.logger.info(`[ReminderService] Looking for course day reminders on: ${todayStr}`);

      // Filter candidates
      const candidates = dataRows
        .filter((row) => {
          if (!row) return false;
          
          const status = row[statusCol];
          const courseDate = row[courseDateCol];
          const dayReminder = row[dayReminderCol];
          const userId = row[userIdCol];
          const name = row[nameCol];

          // Debug logging for each row
          this.logger.info(`[ReminderService] Row check - Status: ${status}, CourseDate: ${courseDate}, DayReminder: ${dayReminder}, UserId: ${userId}, Name: ${name}`);

          // Check if candidate needs course day reminder
          // FIXED LOGIC: Look for DAY_COURSE_REMINDER date that matches today
          return status === 'WAITING' && 
                 dayReminder === todayStr && // DAY_COURSE_REMINDER column matches today
                 userId && 
                 name;
        })
        .map((row, index) => {
          if (!row) return null;
          
          return {
            rowIndex: index + 3, // Convert to actual sheet row number
            userId: parseInt(row[userIdCol] || '0', 10),
            name: row[nameCol] || 'Unknown',
            language: row[languageCol] || 'en',
            courseDate: row[courseDateCol] || '',
            statusCol,
            courseDateCol,
            dayReminderCol,
            userIdCol,
            nameCol,
            languageCol
          };
        })
        .filter(candidate => candidate !== null) as any[];

      this.logger.info(`[ReminderService] Found ${candidates.length} candidates for course day reminders on ${todayStr}`);
      return candidates;

    } catch (error) {
      this.logger.error('[ReminderService] Error getting candidates for course day reminders:', error);
      return [];
    }
  }

  /**
   * Send day-before reminder to a candidate
   */
  private async sendDayBeforeReminder(candidate: any): Promise<void> {
    try {
      const { userId, name, language, courseDate, rowIndex, preReminderCol } = candidate;
      if (preReminderCol === undefined) {
        this.logger.error(`[ReminderService] PRE_COURSE_REMINDER column not found for candidate ${userId}`);
        return;
      }
      const isGreek = language.startsWith('gr');

      // Create reminder message
      const message = isGreek
        ? `🔔 Υπενθύμιση: Η εκπαίδευσή σας είναι αύριο στις 9:50-15:00.\n\nΘα παρευρεθείτε;`
        : `🔔 Reminder: Your course is tomorrow at 9:50-15:00.\n\nWill you attend?`;

      // Create inline keyboard
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: isGreek ? '✅ Ναι, θα παρευρεθώ' : '✅ Yes, I will attend',
              callback_data: `reminder_yes_${userId}_${rowIndex}`
            }
          ],
          [
            {
              text: isGreek ? '❌ Όχι, δεν μπορώ να παρευρεθώ' : '❌ No, I cannot attend',
              callback_data: `reminder_no_${userId}_${rowIndex}`
            }
          ]
        ]
      };

      // Send message
      await this.bot.sendMessage(userId, message, { reply_markup: keyboard });
      
      // Update PRE_COURSE_REMINDER column to today's date
      const today = new Date().toISOString().split('T')[0];
      if (preReminderCol !== undefined && today) {
        const preReminderRange = `${String.fromCharCode(65 + preReminderCol)}${rowIndex}`;
        await this.sheets.updateCell(preReminderRange, today);
      }

      this.logger.info(`[ReminderService] Day-before reminder sent to candidate ${name} (${userId}) for course on ${courseDate}`);

    } catch (error) {
      this.logger.error(`[ReminderService] Failed to send day-before reminder to candidate ${candidate.userId}:`, error);
    }
  }

  /**
   * Send course day check-in reminder
   */
  private async sendCourseDayCheckInReminder(candidate: any): Promise<void> {
    try {
      const { userId, name, language, rowIndex } = candidate;
      const isGreek = language.startsWith('gr');

      // Create check-in reminder message
      const message = isGreek
        ? `🎯 Σήμερα είναι η μέρα της εκπαίδευσής σας!\n\n⏰ Ώρα: 9:50-15:00\n📍 Παρακαλώ κάντε check-in όταν φτάσετε:`
        : `🎯 Today is your course day!\n\n⏰ Time: 9:50-15:00\n📍 Please check-in when you arrive:`;

      // Create inline keyboard for check-in
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: isGreek ? '📍 Check-In' : '📍 Check-In',
              callback_data: `course_checkin_${userId}_${rowIndex}`
            }
          ]
        ]
      };

      // Send message
      await this.bot.sendMessage(userId, message, { reply_markup: keyboard });

      this.logger.info(`[ReminderService] Course day check-in reminder sent to candidate ${name} (${userId})`);

    } catch (error) {
      this.logger.error(`[ReminderService] Failed to send course day check-in reminder to candidate ${candidate.userId}:`, error);
    }
  }

  /**
   * Send course day check-out reminder
   */
  private async sendCourseDayCheckOutReminder(candidate: any): Promise<void> {
    try {
      const { userId, name, language, rowIndex } = candidate;
      const isGreek = language.startsWith('gr');

      // Create check-out reminder message
      const message = isGreek
        ? `🏁 Η εκπαίδευσή σας τελείωσε!\n\nΠαρακαλώ κάντε check-out:`
        : `🏁 Your course has ended!\n\nPlease check-out:`;

      // Create inline keyboard for check-out
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: isGreek ? '🏁 Check-Out' : '🏁 Check-Out',
              callback_data: `course_checkout_${userId}_${rowIndex}`
            }
          ]
        ]
      };

      // Send message
      await this.bot.sendMessage(userId, message, { reply_markup: keyboard });

      this.logger.info(`[ReminderService] Course day check-out reminder sent to candidate ${name} (${userId})`);

    } catch (error) {
      this.logger.error(`[ReminderService] Failed to send course day check-out reminder to candidate ${candidate.userId}:`, error);
    }
  }

  /**
   * Handle reminder response from candidate
   */
  public async handleReminderResponse(callbackData: string): Promise<void> {
    try {
      const parts = callbackData.split('_');
      if (parts.length < 4) return;

      const response = parts[1]; // 'yes' or 'no'
      const userIdStr = parts[2];
      const rowIndexStr = parts[3];

      if (!userIdStr || !rowIndexStr) return;

      const userId = parseInt(userIdStr, 10);
      const rowIndex = parseInt(rowIndexStr, 10);

      if (isNaN(userId) || isNaN(rowIndex)) return;

      this.logger.info(`[ReminderService] Handling reminder response: ${response} from user ${userId}`);

      if (response === 'yes') {
        await this.handleAttendanceConfirmation(userId, rowIndex);
      } else if (response === 'no') {
        await this.handleAttendanceDecline(userId, rowIndex);
      }

    } catch (error) {
      this.logger.error('[ReminderService] Error handling reminder response:', error);
    }
  }

  /**
   * Handle callback query from Telegram for reminder responses
   */
  public async handleReminderCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    try {
      if (!query.data) return;
      
      // Answer the callback query to remove loading state
      await this.bot.answerCallbackQuery(query.id);
      
      // Handle the reminder response
      await this.handleReminderResponse(query.data);
      
    } catch (error) {
      this.logger.error('[ReminderService] Error handling reminder callback:', error);
    }
  }

  /**
   * Handle when candidate confirms attendance
   */
  private async handleAttendanceConfirmation(userId: number, rowIndex: number): Promise<void> {
    try {
      // Get candidate data first
      const candidateData = await this.getCandidateData(rowIndex);
      if (!candidateData) {
        this.logger.error(`[ReminderService] Could not get candidate data for row ${rowIndex}`);
        return;
      }

      // Update STATUS to "WORKING"
      const statusData = await this.sheets.getRegistrationSheet();
      const statusHeaders = statusData[1];
      if (statusHeaders) {
        const statusCol = statusHeaders.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'STATUS');
        if (statusCol !== -1) {
          const statusRange = `${String.fromCharCode(65 + statusCol)}${rowIndex}`;
          await this.sheets.updateCell(statusRange, 'WORKING');
        }
      }

      // Update DAY_COURSE_REMINDER to tomorrow's date (they will get course day reminders)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      // Find DAY_COURSE_REMINDER column
      const dayData = await this.sheets.getRegistrationSheet();
      const dayHeaders = dayData[1];
      if (dayHeaders) {
        const dayReminderCol = dayHeaders.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'DAY_COURSE_REMINDER');
        
        if (dayReminderCol !== -1 && tomorrowStr) {
          const dayReminderRange = `${String.fromCharCode(65 + dayReminderCol)}${rowIndex}`;
          await this.sheets.updateCell(dayReminderRange, tomorrowStr);
        }
      }

      // Add candidate to WORKERS sheet
      await this.sheets.addToWorkersSheet(
        candidateData.name,
        userId,
        'WORKING',
        candidateData.language
      );

      // Send confirmation message
      const message = candidateData.language.startsWith('gr')
        ? `🎉 Ευχαριστούμε! Έχετε επιβεβαιώσει την παρουσία σας. Θα σας δούμε αύριο στις 9:50!`
        : `🎉 Thank you! You have confirmed your attendance. We will see you tomorrow at 9:50!`;
      
      await this.bot.sendMessage(userId, message);

      this.logger.info(`[ReminderService] Candidate ${userId} confirmed attendance, status updated to WORKING, will get course day reminders`);

    } catch (error) {
      this.logger.error(`[ReminderService] Error handling attendance confirmation for user ${userId}:`, error);
    }
  }

  /**
   * Handle when candidate declines attendance
   */
  private async handleAttendanceDecline(userId: number, rowIndex: number): Promise<void> {
    try {
      // Update STATUS to "RESCHEDULE"
      const rescheduleData = await this.sheets.getRegistrationSheet();
      const rescheduleHeaders = rescheduleData[1];
      if (rescheduleHeaders) {
        const statusCol = rescheduleHeaders.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'STATUS');
        if (statusCol !== -1) {
          const statusRange = `${String.fromCharCode(65 + statusCol)}${rowIndex}`;
          await this.sheets.updateCell(statusRange, 'RESCHEDULE');
        }
      }

      // DAY_COURSE_REMINDER stays empty (no course day reminders)

      // Send message
      const message = `ℹ️ Κατανοητό. Θα επικοινωνήσουμε μαζί σας για επαναπρογραμματισμό.`;
      await this.bot.sendMessage(userId, message);

      this.logger.info(`[ReminderService] Candidate ${userId} declined attendance, status updated to RESCHEDULE, no course day reminders`);

    } catch (error) {
      this.logger.error(`[ReminderService] Error handling attendance decline for user ${userId}:`, error);
    }
  }

  /**
   * Get candidate data from specific row
   */
  private async getCandidateData(rowIndex: number): Promise<any> {
    try {
      const data = await this.sheets.getRegistrationSheet();
      if (!data || data.length < rowIndex) return null;

      const headers = data[1];
      if (!headers) return null;

      const row = data[rowIndex - 1]; // Convert to 0-based index
      if (!row) return null;

      const nameCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'NAME');
      const languageCol = headers.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'LANGUAGE');

      return {
        name: row[nameCol] || 'Unknown',
        language: row[languageCol] || 'en'
      };
    } catch (error) {
      this.logger.error('[ReminderService] Error getting candidate data:', error);
      return null;
    }
  }

  /**
   * Clean up old data once per day
   */
  private async cleanupOldData(): Promise<void> {
    try {
      const today = new Date();
      const currentDate = today.toISOString().split('T')[0];
      
      if (!currentDate) {
        this.logger.error('[ReminderService] Failed to generate current date');
        return;
      }
      
      // Only cleanup once per day
      if (currentDate === this.lastCleanupDate) {
        return;
      }
      
      this.lastCleanupDate = currentDate;
      this.logger.info('[ReminderService] Daily cleanup completed');
      
    } catch (error) {
      this.logger.error('[ReminderService] Error in daily cleanup:', error);
    }
  }

  /**
   * Handle course day check-in response
   */
  public async handleCourseCheckIn(callbackData: string): Promise<void> {
    try {
      const parts = callbackData.split('_');
      if (parts.length < 4) return;

      const userIdStr = parts[2];
      const rowIndexStr = parts[3];
      
      if (!userIdStr || !rowIndexStr) return;

      const userId = parseInt(userIdStr, 10);
      const rowIndex = parseInt(rowIndexStr, 10);

      if (isNaN(userId) || isNaN(rowIndex)) return;

      this.logger.info(`[ReminderService] Handling course check-in from user ${userId}`);

      // Send confirmation message
      const message = `✅ Επιβεβαιώθηκε η άφιξή σας! Καλή εκπαίδευση!`;
      await this.bot.sendMessage(userId, message);

      this.logger.info(`[ReminderService] Course check-in confirmed for user ${userId}`);

    } catch (error) {
      this.logger.error('[ReminderService] Error handling course check-in:', error);
    }
  }

  /**
   * Handle course day check-out response
   */
  public async handleCourseCheckOut(callbackData: string): Promise<void> {
    try {
      const parts = callbackData.split('_');
      if (parts.length < 4) return;

      const userIdStr = parts[2];
      const rowIndexStr = parts[3];
      
      if (!userIdStr || !rowIndexStr) return;

      const userId = parseInt(userIdStr, 10);
      const rowIndex = parseInt(rowIndexStr, 10);

      if (isNaN(userId) || isNaN(rowIndex)) return;

      this.logger.info(`[ReminderService] Handling course check-out from user ${userId}`);

      // Send confirmation message
      const message = `🎉 Συγχαρητήρια! Έχετε ολοκληρώσει την εκπαίδευσή σας επιτυχώς!`;
      await this.bot.sendMessage(userId, message);

      this.logger.info(`[ReminderService] Course check-out confirmed for user ${userId}`);

    } catch (error) {
      this.logger.error('[ReminderService] Error handling course check-out:', error);
    }
  }

  /**
   * Force immediate reminder check - for testing purposes
   */
  public async forceReminderCheck(): Promise<void> {
    try {
      this.logger.info('[ReminderService] Force reminder check triggered');
      
      // Force check all reminder types immediately
      await this.checkAndSendReminders();
      
      this.logger.info('[ReminderService] Force reminder check completed');
    } catch (error) {
      this.logger.error('[ReminderService] Error in force reminder check:', error);
    }
  }

  /**
   * Handle callback query from Telegram for course day responses
   */
  public async handleCourseDayCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    try {
      if (!query.data) return;
      
      // Answer the callback query to remove loading state
      await this.bot.answerCallbackQuery(query.id);
      
      // Handle the course day response
      if (query.data.startsWith('course_checkin_')) {
        await this.handleCourseCheckIn(query.data);
      } else if (query.data.startsWith('course_checkout_')) {
        await this.handleCourseCheckOut(query.data);
      }
      
    } catch (error) {
      this.logger.error('[ReminderService] Error handling course day callback:', error);
    }
  }

  /**
   * Utility function to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
