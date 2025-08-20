import TelegramBot from 'node-telegram-bot-api';
// @ts-ignore – No types for node-cron in repo
import cron from 'node-cron';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';

export class ReminderService {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;
  private pendingReminders: Map<string, { courseDate: string; candidateName: string; userId: number; scheduledFor: Date }> = new Map();

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient) {
    this.bot = bot;
    this.sheets = sheets;
    
    console.log('[ReminderService] Initializing scheduled reminders...');
    
    // Restore pending reminders from Google Sheets on startup
    this.restorePendingReminders().catch(console.error);
    
    // Single daily scan at 10:00 AM server time for all course reminders
    cron.schedule('0 10 * * *', () => {
      console.log('[ReminderService] Running daily 10:00 AM course reminder check');
      this.checkMainSheetForTomorrowCourseReminders().catch(console.error);
    });
    
    console.log('🔍 [ReminderService] Daily 10:00 AM server time cron job scheduled successfully');
    console.log('🔍 [ReminderService] Cron pattern: 0 10 * * * (10:00 AM server time)');
    console.log('🔍 [ReminderService] Will check for candidates with courses tomorrow and send reminders');
    
    // Run no-response check at 18:00 (6 PM) every day
    cron.schedule('0 18 * * *', () => {
      console.log('[ReminderService] Running no-response check at 6:00 PM');
      this.checkNoResponses().catch(console.error);
    });
    

    
    console.log('[ReminderService] Reminder service initialized - reminders will be processed daily at 10:00 AM for tomorrow\'s courses');
  }

  // Public method to schedule reminder for a specific course
  public async scheduleReminderForCourse(courseDate: string, candidateName: string, userId: number) {
    console.log(`[ReminderService] scheduleReminderForCourse called for ${candidateName} (${userId}) on ${courseDate}`);
    
    // BULLETPROOF date parsing - handle various formats safely
    let parsedCourseDate: Date | null = null;
    try {
      // Try multiple date formats
      const dateFormats = [
        courseDate, // YYYY-M-D
        courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-$2-$3'), // Ensure proper format
        courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-0$2-$3'), // Add leading zeros to month
        courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-$2-0$3'), // Add leading zeros to day
        courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-0$2-0$3') // Add leading zeros to both
      ];
      
      for (const format of dateFormats) {
        const testDate = new Date(format + 'T00:00:00');
        if (!isNaN(testDate.getTime())) {
          parsedCourseDate = testDate;
          break;
        }
      }
    } catch (error) {
      console.error(`[ReminderService] Failed to parse course date "${courseDate}" for ${candidateName}:`, error);
      // Don't crash - just log and return
      return;
    }
    
    if (!parsedCourseDate) {
      console.error(`[ReminderService] Invalid course date "${courseDate}" for ${candidateName} - cannot schedule reminder`);
      return;
    }
    
    // Create a unique key for this reminder
    const reminderKey = `${userId}_${courseDate}`;
    
    // Store the reminder in memory for the daily scan
    this.pendingReminders.set(reminderKey, {
      courseDate,
      candidateName,
      userId,
      scheduledFor: parsedCourseDate
    });
    
    // Also save to Google Sheets for persistence across server restarts
    try {
      await this.saveReminderToSheets(courseDate, candidateName, userId, parsedCourseDate);
      console.log(`[ReminderService] Saved reminder to Google Sheets for ${candidateName} (${userId})`);
    } catch (error) {
      console.error(`[ReminderService] Failed to save reminder to Google Sheets for ${candidateName}:`, error);
      // Continue with in-memory storage even if Google Sheets save fails
    }
    
    console.log(`[ReminderService] Stored reminder for ${candidateName} (${userId}) for course on ${courseDate}`);
    console.log(`[ReminderService] Total pending reminders: ${this.pendingReminders.size}`);
    console.log(`[ReminderService] Reminder will be processed during daily 10:00 AM scan`);
  }







  private normalise(s: string) { return s.replace(/\s|_/g, '').toUpperCase(); }

  private async sendReminders() {
    // TESTING: Send reminders for ALL future courses, not just tomorrow
    // This allows testing with courses scheduled for any future date
    console.log('[ReminderService] TESTING MODE: Sending reminders for all future courses');
    return this.sendRemindersForAllFutureCourses();
  }

  private async sendReminderForSpecificCourse(courseDate: string, userId: number, candidateName: string): Promise<void> {
    const header = await this.sheets.getHeaderRow();
    const rowsRaw = await this.sheets.getRows('A3:Z1000');
    if (!rowsRaw || !rowsRaw.length) return;
    const rows = rowsRaw as string[][];

    const colDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
    const colConfirmed = header.findIndex(h => this.normalise(h) === 'COURSECONFIRMED');
    const colReminder = header.findIndex(h => {
      const n = this.normalise(h);
      return n === 'REMINDER' || n === 'REMINDERSENT';
    });
    const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
    const colLang = header.findIndex(h => { const n=this.normalise(h); return n==='LANG' || n==='LANGUAGE'; });
    const nameIdx = header.findIndex(h => this.normalise(h) === 'NAME');

    // Find the specific row for this user and course
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const rowUserId = parseInt(r[colUserId] || '0', 10);
      const rowCourseDate = (r[colDate] || '').trim();
      
      if (rowUserId === userId && rowCourseDate === courseDate) {
        // Skip if reminder already sent or already confirmed
        if (colReminder !== -1 && (r[colReminder] || '').trim()) {
          console.log(`[ReminderService] Reminder already sent for ${candidateName} (${userId}) for course on ${courseDate}`);
          return;
        }
        
        const confirmed = (r[colConfirmed] || '').trim();
        if (confirmed === 'YES') {
          console.log(`[ReminderService] Course already confirmed for ${candidateName} (${userId}) for course on ${courseDate}`);
          return;
        }

        const langVal = (r[colLang] || '').toLowerCase();
        const lang: 'gr' | 'en' = langVal.startsWith('gr') ? 'gr' : 'en';

        const courseTime = '9:50-15:00';
        const msg = lang === 'gr'
          ? `📅 Υπενθύμιση: Η εισαγωγική εκπαίδευση είναι στις ${courseDate} στις ${courseTime}.\nΠαρακαλούμε επιβεβαιώστε την παρουσία σας:`
          : `📅 Reminder: The introductory course is on ${courseDate} at ${courseTime}.\nPlease confirm your attendance:`;

        const keyboard: TelegramBot.InlineKeyboardButton[][] = [
          [{ text: lang === 'gr' ? '✅ Θα παραβρεθώ' : '✅ I will attend', callback_data: 'course_yes' }],
          [{ text: lang === 'gr' ? '❌ Δεν μπορώ να παραβρεθώ' : '❌ I cannot attend', callback_data: 'course_no' }]
        ];

        try {
          await this.bot.sendMessage(userId, msg, { reply_markup: { inline_keyboard: keyboard } });
          console.log(`[ReminderService] Sent reminder to ${candidateName} (${userId}) for course on ${courseDate}`);
          
          // Notify admins
          await this.notifyAdmins(`🔔 Υπενθύμιση στάλθηκε στον ${candidateName} για το μάθημα στις ${courseDate}`);
          
          // Mark reminder sent
          if (colReminder !== -1) {
            r[colReminder] = new Date().toISOString();
            const rowNum = i + 3; // data starts at row 3
            const range = `A${rowNum}:${String.fromCharCode(65 + header.length - 1)}${rowNum}`;
            await this.sheets.updateRow(range, r);
          }
        } catch (err) {
          console.error(`[ReminderService] Failed to send reminder to ${userId} for course on ${courseDate}:`, err);
        }
        
        return; // Found and processed the specific course
      }
    }
    
    console.log(`[ReminderService] Could not find course data for ${candidateName} (${userId}) for course on ${courseDate}`);
  }

  private async sendRemindersForAllFutureCourses() {
    const header = await this.sheets.getHeaderRow();
    const rowsRaw = await this.sheets.getRows('A3:Z1000');
    if (!rowsRaw || !rowsRaw.length) return;
    const rows = rowsRaw as string[][];

    const colDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
    const colConfirmed = header.findIndex(h => this.normalise(h) === 'COURSECONFIRMED');
    const colReminder = header.findIndex(h => {
      const n = this.normalise(h);
      return n === 'REMINDER' || n === 'REMINDERSENT';
    });
    const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
    const colLang = header.findIndex(h => { const n=this.normalise(h); return n==='LANG' || n==='LANGUAGE'; });
    const nameIdx = header.findIndex(h => this.normalise(h) === 'NAME');

    const candidatesNotified: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const courseDate = (r[colDate] || '').trim();
      if (!courseDate || courseDate === 'TBA' || courseDate === 'RESCHEDULE') continue;
      
      // TESTING: Check if course date is in the future (any future date)
      const courseDateObj = new Date(courseDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset time to start of day
      courseDateObj.setHours(0, 0, 0, 0);
      
      if (courseDateObj <= today) continue; // Skip past courses
      
      // Skip if reminder already sent or already confirmed
      if (colReminder !== -1 && (r[colReminder] || '').trim()) continue;
      const confirmed = (r[colConfirmed] || '').trim();
      if (confirmed === 'YES') continue;

      const uidStr = r[colUserId] || '';
      const uid = parseInt(uidStr, 10);
      const langVal = (r[colLang] || '').toLowerCase();
      const lang: 'gr' | 'en' = langVal.startsWith('gr') ? 'gr' : 'en';

      const courseTime = '9:50-15:00';
      const msg = lang === 'gr'
        ? `📅 Υπενθύμιση: Η εισαγωγική εκπαίδευση είναι στις ${courseDate} στις ${courseTime}.\nΠαρακαλούμε επιβεβαιώστε την παρουσία σας:`
        : `📅 Reminder: The introductory course is on ${courseDate} at ${courseTime}.\nPlease confirm your attendance:`;

      const keyboard: TelegramBot.InlineKeyboardButton[][] = [
        [{ text: lang === 'gr' ? '✅ Θα παραβρεθώ' : '✅ I will attend', callback_data: 'course_yes' }],
        [{ text: lang === 'gr' ? '❌ Δεν μπορώ να παραβρεθώ' : '❌ I cannot attend', callback_data: 'course_no' }]
      ];

      if (!isNaN(uid)) {
        try {
          await this.bot.sendMessage(uid, msg, { reply_markup: { inline_keyboard: keyboard } });
          const candidateName = nameIdx !== -1 ? (r[nameIdx] || uidStr) : uidStr;
          candidatesNotified.push(candidateName);
          console.log(`[ReminderService] Sent reminder to ${candidateName} (${uid}) for course on ${courseDate}`);
        } catch (err) {
          console.error('Failed to DM reminder to', uid, err);
        }
      }

      // mark reminder sent
      if (colReminder !== -1) {
        r[colReminder] = new Date().toISOString();
        const rowNum = i + 3; // data starts at row 3
        const range = `A${rowNum}:${String.fromCharCode(65 + header.length - 1)}${rowNum}`;
        await this.sheets.updateRow(range, r);
      }
    }

    // Send ONE consolidated admin notification
    if (candidatesNotified.length > 0) {
      const candidateList = candidatesNotified.join(', ');
      const adminText = `🔔 Υπενθύμισες στάλθηκαν στους παρακάτω υποψήφιους για μελλοντικά μαθήματα:\n${candidateList}`;
      await this.notifyAdmins(adminText);
    } else {
      console.log('[ReminderService] No candidates found for future courses');
    }
  }

  private async sendRemindersForDate(targetDate: string) {
    const header = await this.sheets.getHeaderRow();
    const rowsRaw = await this.sheets.getRows('A3:Z1000');
    if (!rowsRaw || !rowsRaw.length) return;
    const rows = rowsRaw as string[][];

    const colDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
    const colConfirmed = header.findIndex(h => this.normalise(h) === 'COURSECONFIRMED');
    const colReminder = header.findIndex(h => {
      const n = this.normalise(h);
      return n === 'REMINDER' || n === 'REMINDERSENT';
    });
    const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
    const colLang = header.findIndex(h => { const n=this.normalise(h); return n==='LANG' || n==='LANGUAGE'; });
    const nameIdx = header.findIndex(h => this.normalise(h) === 'NAME');

    const candidatesNotified: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const courseDate = (r[colDate] || '').trim();
      if (!courseDate || courseDate === 'TBA' || courseDate === 'RESCHEDULE') continue;
      
          // Only send reminder for courses on target date
    if (courseDate !== targetDate) continue;
      
      // Skip if reminder already sent or already confirmed
      if (colReminder !== -1 && (r[colReminder] || '').trim()) continue;
      const confirmed = (r[colConfirmed] || '').trim();
      if (confirmed === 'YES') continue;

      const uidStr = r[colUserId] || '';
      const uid = parseInt(uidStr, 10);
      const langVal = (r[colLang] || '').toLowerCase();
      const lang: 'gr' | 'en' = langVal.startsWith('gr') ? 'gr' : 'en';

      const courseTime = '9:50-15:00';
      const msg = lang === 'gr'
        ? `📅 Υπενθύμιση: Η εισαγωγική εκπαίδευση είναι αύριο (${courseDate}) στις ${courseTime}.\nΠαρακαλούμε επιβεβαιώστε την παρουσία σας:`
        : `📅 Reminder: The introductory course is tomorrow (${courseDate}) at ${courseTime}.\nPlease confirm your attendance:`;

      const keyboard: TelegramBot.InlineKeyboardButton[][] = [
        [{ text: lang === 'gr' ? '✅ Θα παραβρεθώ' : '✅ I will attend', callback_data: 'course_yes' }],
        [{ text: lang === 'gr' ? '❌ Δεν μπορώ να παραβρεθώ' : '❌ I cannot attend', callback_data: 'course_no' }]
      ];

      if (!isNaN(uid)) {
        try {
          await this.bot.sendMessage(uid, msg, { reply_markup: { inline_keyboard: keyboard } });
          const candidateName = nameIdx !== -1 ? (r[nameIdx] || uidStr) : uidStr;
          candidatesNotified.push(candidateName);
        } catch (err) {
          console.error('Failed to DM reminder to', uid, err);
        }
      }

      // mark reminder sent
      if (colReminder !== -1) {
        r[colReminder] = new Date().toISOString();
        const rowNum = i + 3; // data starts at row 3
        const range = `A${rowNum}:${String.fromCharCode(65 + header.length - 1)}${rowNum}`;
        await this.sheets.updateRow(range, r);
      }
    }

    // Send ONE consolidated admin notification
    if (candidatesNotified.length > 0) {
      const candidateList = candidatesNotified.join(', ');
      const adminText = `🔔 Υπενθύμισες στάλθηκαν στους παρακάτω υποψήφιους για το μάθημα αύριο (${targetDate}):\n${candidateList}`;
      await this.notifyAdmins(adminText);
    }
  }

  private async checkNoResponses() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const header = await this.sheets.getHeaderRow();
    const rowsRaw = await this.sheets.getRows('A3:Z1000');
    if (!rowsRaw || !rowsRaw.length) return;
    const rows = rowsRaw as string[][];

    const colDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
    const colConfirmed = header.findIndex(h => this.normalise(h) === 'COURSECONFIRMED');
    const colReminder = header.findIndex(h => {
      const n = this.normalise(h);
      return n === 'REMINDER' || n === 'REMINDERSENT';
    });
    const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
    const nameIdx = header.findIndex(h => this.normalise(h) === 'NAME');

    const noResponseCandidates: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const courseDate = (r[colDate] || '').trim();
      if (!courseDate || courseDate === 'TBA' || courseDate === 'RESCHEDULE') continue;
      
      // Check if course is tomorrow
      if (courseDate !== tomorrowStr) continue;
      
      // Check if reminder was sent but no response received
      const reminderSent = colReminder !== -1 && (r[colReminder] || '').trim();
      const confirmed = (r[colConfirmed] || '').trim();
      
      if (reminderSent && confirmed !== 'YES' && confirmed !== 'NO') {
        const candidateName = nameIdx !== -1 ? (r[nameIdx] || 'Unknown') : 'Unknown';
        noResponseCandidates.push(candidateName);
      }
    }

    // Notify admins about candidates who didn't respond
    if (noResponseCandidates.length > 0) {
      const candidateList = noResponseCandidates.join(', ');
      const adminText = `⚠️ Οι παρακάτω υποψήφιοι δεν απάντησαν στην υπενθύμιση για το μάθημα αύριο (${tomorrowStr}):\n${candidateList}`;
      await this.notifyAdmins(adminText);
    }
  }

  private async notifyAdmins(message: string): Promise<void> {
    try {
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (!adminGroupId) {
        console.log('[ReminderService] ADMIN_GROUP_ID not set, skipping admin notification');
      return;
    }
    
      await this.bot.sendMessage(adminGroupId, message);
      console.log('[ReminderService] Admin notification sent successfully');
    } catch (error) {
      console.error('[ReminderService] Failed to send admin notification:', error);
    }
  }





  // Refresh a single working user
  private async refreshWorkingUser(user: { id: string; name: string; status: string }): Promise<void> {
    try {
      const userId = parseInt(user.id, 10);
      if (isNaN(userId)) {
        console.log(`[ReminderService] Invalid user ID: ${user.id}`);
        return;
      }
      
      // Get user's language preference
      const userLang = await this.getUserLanguage(userId);
      
      // Send fresh daily start message
      const refreshMsg = userLang === 'gr'
        ? `🌅 Καλημέρα! Είναι νέα μέρα εργασίας.\n\n📝 Επιλέξτε την ενέργειά σας:`
        : `🌅 Good morning! It's a new work day.\n\n📝 Choose your action:`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: userLang === 'gr' ? '📝 Log In' : '📝 Log In', callback_data: 'working_checkin' }],
          [{ text: userLang === 'gr' ? '📞 Επικοινωνία' : '📞 Contact', callback_data: 'working_contact' }]
        ]
      };
      
      await this.bot.sendMessage(userId, refreshMsg, { reply_markup: keyboard });
      console.log(`[ReminderService] Sent daily refresh message to user ${user.name} (${userId})`);
      
    } catch (error) {
      console.error(`[ReminderService] Error refreshing user ${user.name}:`, error);
    }
  }

  // Helper method to get user's language from Google Sheets
  private async getUserLanguage(userId: number): Promise<'en' | 'gr'> {
    try {
      const header = await this.sheets.getHeaderRow();
      const rowsRaw = await this.sheets.getRows('A3:Z1000');
      if (!rowsRaw || !rowsRaw.length) return 'en';
      
      const rows = rowsRaw as string[][];
      
      // Column B for user ID, find language column
      const userIdCol = 1; // Column B (0-indexed = 1)
      const langCol = header.findIndex(h => {
        const norm = h.toUpperCase().replace(/\s|_/g, '');
        return norm === 'LANG' || norm === 'LANGUAGE';
      });
      
      if (langCol === -1) return 'en';
      
      for (const row of rows) {
        if (!row[userIdCol]) continue;
        
        const rowUserId = parseInt(row[userIdCol] || '', 10);
        if (rowUserId === userId) {
          const langVal = (row[langCol] || '').toLowerCase();
          return langVal.startsWith('gr') ? 'gr' : 'en';
        }
      }
      
      return 'en';
    } catch (error) {
      console.error('[ReminderService] Error getting user language:', error);
      return 'en';
    }
  }




  // Restore pending reminders from Google Sheets
  private async restorePendingReminders(): Promise<void> {
    try {
      const header = await this.sheets.getHeaderRow();
      const rowsRaw = await this.sheets.getRows('A3:Z1000');
      if (!rowsRaw || !rowsRaw.length) {
        console.log('[ReminderService] No pending reminders found in Google Sheets.');
        return;
      }

      const rows = rowsRaw as string[][];
      const colCourseDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
      const colCandidateName = header.findIndex(h => this.normalise(h) === 'NAME');
      const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
      const colScheduledFor = header.findIndex(h => this.normalise(h) === 'SCHEDULEDFOR');

      if (colCourseDate === -1 || colCandidateName === -1 || colUserId === -1 || colScheduledFor === -1) {
        console.log('[ReminderService] Required columns not found for restoring pending reminders.');
        return;
      }

      for (const row of rows) {
        const courseDate = (row[colCourseDate] || '').trim();
        const candidateName = (row[colCandidateName] || '').trim();
        const userIdStr = (row[colUserId] || '').trim();
        const scheduledForStr = (row[colScheduledFor] || '').trim();

        if (!courseDate || !candidateName || !userIdStr || !scheduledForStr) {
          console.warn(`[ReminderService] Skipping incomplete reminder row: ${row}`);
          continue;
        }

        const userId = parseInt(userIdStr, 10);
        const scheduledFor = new Date(scheduledForStr);

        if (isNaN(userId) || isNaN(scheduledFor.getTime())) {
          console.warn(`[ReminderService] Skipping invalid reminder row: ${row}`);
          continue;
        }

        const reminderKey = `${userId}_${courseDate}`;
        this.pendingReminders.set(reminderKey, {
          courseDate,
          candidateName,
          userId,
          scheduledFor
        });
        console.log(`[ReminderService] Restored reminder: ${reminderKey} (scheduled for ${scheduledFor.toISOString()})`);
      }
      console.log(`[ReminderService] Restored ${this.pendingReminders.size} pending reminders from Google Sheets.`);
    } catch (error) {
      console.error('[ReminderService] Error restoring pending reminders from Google Sheets:', error);
    }
  }

  // Save a single reminder to Google Sheets
  private async saveReminderToSheets(courseDate: string, candidateName: string, userId: number, scheduledFor: Date): Promise<void> {
    try {
      console.log(`🔍 [ReminderService] ===== STARTING saveReminderToSheets =====`);
      console.log(`🔍 [ReminderService] Parameters: courseDate=${courseDate}, candidateName=${candidateName}, userId=${userId}, scheduledFor=${scheduledFor}`);
      
      const header = await this.sheets.getHeaderRow();
      console.log(`🔍 [ReminderService] Header row retrieved:`, header);
      
      const rowsRaw = await this.sheets.getRows('A3:Z1000');
      console.log(`🔍 [ReminderService] Data rows retrieved: ${rowsRaw ? rowsRaw.length : 0} rows`);
      
      if (!rowsRaw || !rowsRaw.length) {
        console.log('[ReminderService] Google Sheets is empty, creating new sheet.');
        // Add header if sheet is empty
        const newHeader = ['COURSEDATE', 'NAME', 'USERID', 'SCHEDULEDFOR'];
        await this.sheets.appendRow('A1', newHeader);
        await this.sheets.appendRow('A2', ['', '', '', '']); // Empty row for header
      }

      console.log(`🔍 [ReminderService] ===== COLUMN MAPPING DEBUG =====`);
      
      const colCourseDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
      console.log(`🔍 [ReminderService] COURSEDATE column search:`);
      console.log(`   - Looking for normalised: 'COURSEDATE'`);
      console.log(`   - Found at index: ${colCourseDate}`);
      console.log(`   - Header value at that index: '${header[colCourseDate]}'`);
      
      const colCandidateName = header.findIndex(h => this.normalise(h) === 'NAME');
      console.log(`🔍 [ReminderService] NAME column search:`);
      console.log(`   - Looking for normalised: 'NAME'`);
      console.log(`   - Found at index: ${colCandidateName}`);
      console.log(`   - Header value at that index: '${header[colCandidateName]}'`);
      
      const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
      console.log(`🔍 [ReminderService] USERID column search:`);
      console.log(`   - Looking for normalised: 'USERID'`);
      console.log(`   - Found at index: ${colUserId}`);
      console.log(`   - Header value at that index: '${header[colUserId]}'`);
      
      const colScheduledFor = header.findIndex(h => this.normalise(h) === 'SCHEDULEDFOR');
      console.log(`🔍 [ReminderService] SCHEDULEDFOR column search:`);
      console.log(`   - Looking for normalised: 'SCHEDULEDFOR'`);
      console.log(`   - Found at index: ${colScheduledFor}`);
      console.log(`   - Header value at that index: '${header[colScheduledFor]}'`);
      
      // Check for potential column name issues
      console.log(`🔍 [ReminderService] ===== COLUMN NAME ANALYSIS =====`);
      header.forEach((col, index) => {
        if (col && (col.includes('COURSE') || col.includes('NAME') || col.includes('USER') || col.includes('SCHEDULE'))) {
          console.log(`🔍 [ReminderService] Related column found at index ${index}: '${col}' (length: ${col.length})`);
          console.log(`   - Normalised: '${this.normalise(col)}'`);
          console.log(`   - Contains spaces: ${col.includes(' ')}`);
          console.log(`   - Contains tabs: ${col.includes('\t')}`);
          console.log(`   - Contains newlines: ${col.includes('\n')}`);
          console.log(`   - Raw bytes: ${Buffer.from(col).toString('hex')}`);
        }
      });

      if (colCourseDate === -1 || colCandidateName === -1 || colUserId === -1 || colScheduledFor === -1) {
        console.log(`❌ [ReminderService] Required columns not found for saving reminders.`);
        console.log(`   - COURSEDATE: ${colCourseDate === -1 ? 'NOT FOUND' : `FOUND at ${colCourseDate}`}`);
        console.log(`   - NAME: ${colCandidateName === -1 ? 'NOT FOUND' : `FOUND at ${colCandidateName}`}`);
        console.log(`   - USERID: ${colUserId === -1 ? 'NOT FOUND' : `FOUND at ${colUserId}`}`);
        console.log(`   - SCHEDULEDFOR: ${colScheduledFor === -1 ? 'NOT FOUND' : `FOUND at ${colScheduledFor}`}`);
        return;
      }

      console.log(`✅ [ReminderService] All required columns found successfully!`);
      
      const newRow = [courseDate, candidateName, userId.toString(), scheduledFor.toISOString()];
      console.log(`🔍 [ReminderService] New row data:`, newRow);
      
      console.log(`🔍 [ReminderService] About to append row to A3...`);
      await this.sheets.appendRow('A3', newRow); // Add new row starting from A3
      console.log(`✅ [ReminderService] Row appended successfully!`);
      
      console.log(`🔍 [ReminderService] ===== saveReminderToSheets COMPLETED =====`);
      console.log(`[ReminderService] Saved reminder to Google Sheets: ${courseDate}, ${candidateName}, ${userId}, ${scheduledFor.toISOString()}`);
    } catch (error) {
      console.error(`[ReminderService] Failed to save reminder to Google Sheets:`, error);
      console.error(`[ReminderService] Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace',
        courseDate,
        candidateName,
        userId,
        scheduledFor
      });
    }
  }

  // Public method to manually trigger reminder check (for testing)
  public async triggerReminderCheck(): Promise<void> {
    console.log('[ReminderService] Manual reminder check triggered');
    await this.checkMainSheetForTomorrowCourseReminders();
  }

  // Public method to get current pending reminders count (for monitoring)
  public getPendingRemindersCount(): number {
    return this.pendingReminders.size;
  }

  // Public method to get pending reminders details (for monitoring)
  public getPendingRemindersDetails(): Array<{ key: string; courseDate: string; candidateName: string; userId: number; scheduledFor: Date }> {
    return Array.from(this.pendingReminders.entries()).map(([key, reminder]) => ({
      key,
      courseDate: reminder.courseDate,
      candidateName: reminder.candidateName,
      userId: reminder.userId,
      scheduledFor: reminder.scheduledFor
    }));
  }

  // Daily 10:00 AM server time check of main sheet for tomorrow's course reminders
  private async checkMainSheetForTomorrowCourseReminders(): Promise<void> {
    try {
      console.log('🔍 [ReminderService] ===== STARTING DAILY 10:00 AM TOMORROW COURSE REMINDER CHECK =====');
      console.log('🔍 [ReminderService] Step 1: Getting current server time...');
      
      // Get tomorrow's date in server timezone (send reminders 1 day before course)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      console.log('🔍 [ReminderService] Step 2: Time calculation results:');
      console.log(`   - Server time: ${now.toLocaleString()}`);
      console.log(`   - Tomorrow's date (YYYY-MM-DD): ${tomorrowStr}`);
      console.log(`   - Looking for candidates with course date: ${tomorrowStr}`);
      
      console.log('🔍 [ReminderService] Step 3: Reading main sheet header...');
      
      // Read main sheet to find candidates with course date = tomorrow
      const header = await this.sheets.getHeaderRow("'Φύλλο1'!A2:Z2");
      console.log('🔍 [ReminderService] Step 4: Header row retrieved:');
      console.log(`   - Header columns: ${header.join(', ')}`);
      
      console.log('🔍 [ReminderService] Step 5: Reading main sheet data rows...');
      const rowsRaw = await this.sheets.getRows("'Φύλλο1'!A3:Z1000");
      
      if (!rowsRaw || !rowsRaw.length) {
        console.log('❌ [ReminderService] ERROR: No data found in main sheet');
        return;
      }
      
      const rows = rowsRaw as string[][];
      console.log(`🔍 [ReminderService] Step 6: Data rows retrieved: ${rows.length} rows found`);
      
      // Find column indices
      const colCourseDate = header.findIndex(h => h === 'COURSE DATE');
      const colName = header.findIndex(h => h === 'NAME');
      const colUserId = header.findIndex(h => h === 'user id');
      const colReminderSent = header.findIndex(h => h === 'REMINDERSENT');
      const colStatus = header.findIndex(h => h === 'STATUS');
      
      console.log('🔍 [ReminderService] Step 7: Column mapping results:');
      console.log(`   - COURSE DATE column: ${colCourseDate} (${colCourseDate !== -1 ? 'FOUND' : 'NOT FOUND'})`);
      console.log(`   - NAME column: ${colName} (${colName !== -1 ? 'FOUND' : 'NOT FOUND'})`);
      console.log(`   - user id column: ${colUserId} (${colUserId !== -1 ? 'FOUND' : 'NOT FOUND'})`);
      console.log(`   - REMINDERSENT column: ${colReminderSent} (${colReminderSent !== -1 ? 'FOUND' : 'NOT FOUND'})`);
      console.log(`   - STATUS column: ${colStatus} (${colStatus !== -1 ? 'FOUND' : 'NOT FOUND'})`);
      
      if (colCourseDate === -1 || colName === -1 || colUserId === -1) {
        console.log('❌ [ReminderService] ERROR: Required columns not found in main sheet');
        return;
      }
      
      let remindersSent = 0;
      let candidatesChecked = 0;
      let candidatesWithCourseTomorrow = 0;
      let candidatesSkipped = 0;
      
      console.log('🔍 [ReminderService] Step 8: Starting to process each row...');
      
      // Check each row for candidates with course date = tomorrow
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        candidatesChecked++;
        
        if (!row || !row[colCourseDate] || !row[colName]) {
          console.log(`🔍 [ReminderService] Row ${i + 3}: Skipping - no course date or name`);
          continue;
        }
        
        const courseDate = row[colCourseDate].trim();
        const candidateName = row[colName].trim();
        const userIdStr = row[colUserId]?.trim();
        const reminderSent = row[colReminderSent]?.trim();
        const status = row[colStatus]?.trim();
        
        console.log(`🔍 [ReminderService] Row ${i + 3}: Processing candidate "${candidateName}"`);
        console.log(`   - Course date: "${courseDate}"`);
        console.log(`   - User ID: "${userIdStr}"`);
        console.log(`   - Reminder sent: "${reminderSent}"`);
        console.log(`   - Status: "${status}"`);
        
        // Skip if no course date or already sent reminder
        if (!courseDate) {
          console.log(`🔍 [ReminderService] Row ${i + 3}: Skipping - no course date`);
          candidatesSkipped++;
          continue;
        }
        
        if (reminderSent === 'YES') {
          console.log(`🔍 [ReminderService] Row ${i + 3}: Skipping - reminder already sent`);
          candidatesSkipped++;
          continue;
        }
        
        // Skip if status is not WAITING (candidate already confirmed or rejected)
        if (status && status !== 'WAITING') {
          console.log(`🔍 [ReminderService] Row ${i + 3}: Skipping - status is "${status}" (not WAITING)`);
          candidatesSkipped++;
          continue;
        }
        
        console.log(`🔍 [ReminderService] Row ${i + 3}: Candidate "${candidateName}" passed initial checks, parsing date...`);
        
        // Parse course date safely
        let parsedCourseDate: Date | null = null;
        try {
          console.log(`🔍 [ReminderService] Row ${i + 3}: Attempting to parse date "${courseDate}"`);
          
          // Try multiple date formats
          const dateFormats = [
            courseDate, // YYYY-M-D
            courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-$2-$3'), // Ensure proper format
            courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-0$2-$3'), // Add leading zeros to month
            courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-$2-0$3'), // Add leading zeros to day
            courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-0$2-0$3') // Add leading zeros to both
          ];
          
          console.log(`🔍 [ReminderService] Row ${i + 3}: Trying date formats: ${dateFormats.join(', ')}`);
          
          for (let j = 0; j < dateFormats.length; j++) {
            const format = dateFormats[j];
            const testDate = new Date(format + 'T00:00:00');
            console.log(`🔍 [ReminderService] Row ${j + 1} "${format}" -> ${testDate.toISOString()} (valid: ${!isNaN(testDate.getTime())})`);
            
            if (!isNaN(testDate.getTime())) {
              parsedCourseDate = testDate;
              console.log(`🔍 [ReminderService] Row ${i + 3}: SUCCESS! Parsed date: ${parsedCourseDate.toISOString()}`);
              break;
            }
          }
        } catch (error) {
          console.warn(`⚠️ [ReminderService] Row ${i + 3}: Failed to parse course date "${courseDate}" for ${candidateName}:`, error);
          candidatesSkipped++;
          continue;
        }
        
        if (!parsedCourseDate) {
          console.warn(`⚠️ [ReminderService] Row ${i + 3}: Invalid course date "${courseDate}" for ${candidateName} - skipping`);
          candidatesSkipped++;
          continue;
        }
        
        // Check if course date is tomorrow
        const courseDateStr = parsedCourseDate.toISOString().split('T')[0];
        console.log(`🔍 [ReminderService] Row ${i + 3}: Comparing course date "${courseDateStr}" with tomorrow "${tomorrowStr}"`);
        
        if (courseDateStr === tomorrowStr) {
          candidatesWithCourseTomorrow++;
          console.log(`🎯 [ReminderService] Row ${i + 3}: MATCH! Candidate "${candidateName}" has course tomorrow: ${courseDate}`);
          
          // Send reminder if user ID exists
          if (userIdStr && !isNaN(parseInt(userIdStr))) {
            const userId = parseInt(userIdStr);
            console.log(`🔍 [ReminderService] Row ${i + 3}: Valid user ID found: ${userId}`);
            
            try {
              console.log(`🔍 [ReminderService] Row ${i + 3}: Sending reminder to ${candidateName} (${userId})...`);
              await this.sendReminderForSpecificCourse(courseDate, userId, candidateName);
              console.log(`✅ [ReminderService] Row ${i + 3}: Reminder sent successfully to ${candidateName}`);
              
              // Update REMINDERSENT column to YES
              const rowNum = i + 3; // data starts at row 3
              if (colReminderSent !== -1) {
                console.log(`🔍 [ReminderService] Row ${i + 3}: Updating REMINDERSENT column to YES...`);
                await this.sheets.updateCell(`'Φύλλο1'!${String.fromCharCode(65 + colReminderSent)}${rowNum}`, 'YES');
                console.log(`✅ [ReminderService] Row ${i + 3}: REMINDERSENT updated to YES for ${candidateName}`);
              } else {
                console.log(`⚠️ [ReminderService] Row ${i + 3}: REMINDERSENT column not found, cannot update`);
              }
              
              remindersSent++;
            } catch (error) {
              console.error(`❌ [ReminderService] Row ${i + 3}: Failed to send reminder to ${candidateName}:`, error);
            }
          } else {
            console.log(`⚠️ [ReminderService] Row ${i + 3}: No valid user ID for ${candidateName}, skipping reminder`);
            candidatesSkipped++;
          }
        } else {
          console.log(`🔍 [ReminderService] Row ${i + 3}: No match - course date "${courseDateStr}" is not tomorrow "${tomorrowStr}"`);
        }
      }
      
      console.log('🔍 [ReminderService] ===== TOMORROW COURSE REMINDER CHECK COMPLETED =====');
      console.log('📊 [ReminderService] FINAL STATISTICS:');
      console.log(`   - Total rows checked: ${candidatesChecked}`);
      console.log(`   - Candidates with course tomorrow: ${candidatesWithCourseTomorrow}`);
      console.log(`   - Reminders sent: ${remindersSent}`);
      console.log(`   - Candidates skipped: ${candidatesSkipped}`);
      console.log(`   - Remaining pending reminders: ${this.pendingReminders.size}`);
      console.log('🔍 [ReminderService] ===== END OF TOMORROW COURSE REMINDER CHECK =====');
      
    } catch (error) {
      console.error('❌ [ReminderService] CRITICAL ERROR during tomorrow course reminder check:', error);
      console.error('❌ [ReminderService] Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    }
  }
} 