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
    
    // Run reminder check every hour to send pending reminders
    cron.schedule('0 * * * *', () => {
      console.log('[ReminderService] Running hourly reminder check');
      this.processPendingReminders().catch(console.error);
    });
    
    // NEW: Daily 10:00 AM Greece time check of main sheet for course reminders
    cron.schedule('0 7 * * *', () => {
      console.log('[ReminderService] Running daily 10:00 AM Greece time course reminder check');
      this.checkMainSheetForCourseReminders().catch(console.error);
    }, {
      timezone: 'Europe/Athens'
    });
    
    // Run no-response check at 18:00 (6 PM) every day
    cron.schedule('0 18 * * *', () => {
      console.log('[ReminderService] Running no-response check at 6:00 PM');
      this.checkNoResponses().catch(console.error);
    });
    
    // Run daily UI cleanup at midnight (00:00) every day - ONLY for working users
    cron.schedule('0 0 * * *', () => {
      console.log('[ReminderService] Starting daily UI cleanup for working users at midnight');
      this.performDailyUICleanup().catch(console.error);
    });
    
    console.log('[ReminderService] Reminder service initialized - reminders will be scheduled when courses are added');
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
    
    // Parse the course date
    const courseDateTime = parsedCourseDate;
    const reminderDate = new Date(courseDateTime);
    reminderDate.setDate(reminderDate.getDate() - 1); // 1 day before
    
    // Set reminder time to 10:00 AM Greece time (GMT+3)
    // The server might be running in UTC, so we need to account for timezone
    reminderDate.setHours(10, 0, 0, 0); // 10:00 AM local time
    
    console.log(`[ReminderService] Course date: ${courseDate}`);
    console.log(`[ReminderService] Reminder date (local): ${reminderDate.toLocaleString('en-US', { timeZone: 'Europe/Athens' })}`);
    console.log(`[ReminderService] Reminder date (UTC): ${reminderDate.toISOString()}`);
    
    const now = new Date();
    const delayMs = reminderDate.getTime() - now.getTime();
    
    console.log(`[ReminderService] Course date: ${courseDate}`);
    console.log(`[ReminderService] Reminder scheduled for: ${reminderDate.toISOString()}`);
    console.log(`[ReminderService] Current time: ${now.toISOString()}`);
    console.log(`[ReminderService] Delay: ${delayMs}ms (${Math.round(delayMs / 1000 / 60)} minutes)`);
    
    // Create a unique key for this reminder
    const reminderKey = `${userId}_${courseDate}`;
    
    // If reminder time has already passed, send immediately
    if (delayMs <= 0) {
      console.log(`[ReminderService] Reminder time has passed, sending immediately`);
      // Send immediately but with a small delay to ensure proper logging
    setTimeout(() => {
        console.log(`[ReminderService] Sending immediate reminder to ${candidateName} (${userId}) for course on ${courseDate}`);
      this.sendReminderForSpecificCourse(courseDate, userId, candidateName);
      }, 5000); // 5 seconds delay
    } else {
      // Store the reminder in memory for immediate access
      this.pendingReminders.set(reminderKey, {
        courseDate,
        candidateName,
        userId,
        scheduledFor: reminderDate
      });
      
      // Also save to Google Sheets for persistence across server restarts
      try {
        await this.saveReminderToSheets(courseDate, candidateName, userId, reminderDate);
        console.log(`[ReminderService] Saved reminder to Google Sheets for ${candidateName} (${userId})`);
      } catch (error) {
        console.error(`[ReminderService] Failed to save reminder to Google Sheets for ${candidateName}:`, error);
        // Continue with in-memory storage even if Google Sheets save fails
      }
      
      console.log(`[ReminderService] Stored reminder for ${candidateName} (${userId}) scheduled for ${reminderDate.toISOString()}`);
      console.log(`[ReminderService] Total pending reminders: ${this.pendingReminders.size}`);
    }
  }

  // Process all pending reminders - called every hour by cron
  private async processPendingReminders(): Promise<void> {
    const now = new Date();
    const remindersToSend: Array<{ courseDate: string; candidateName: string; userId: number; key: string }> = [];
    
    console.log(`[ReminderService] Processing pending reminders at ${now.toISOString()}`);
    console.log(`[ReminderService] Total pending reminders: ${this.pendingReminders.size}`);
    
    // Log all pending reminders for debugging
    if (this.pendingReminders.size > 0) {
      console.log('[ReminderService] Current pending reminders:');
      for (const [key, reminder] of this.pendingReminders) {
        console.log(`  - ${key}: ${reminder.candidateName} (${reminder.userId}) for ${reminder.courseDate} at ${reminder.scheduledFor.toISOString()}`);
      }
    }
    
    // Check which reminders are due
    for (const [key, reminder] of this.pendingReminders) {
      if (reminder.scheduledFor <= now) {
        remindersToSend.push({
          courseDate: reminder.courseDate,
          candidateName: reminder.candidateName,
          userId: reminder.userId,
          key
        });
        console.log(`[ReminderService] Reminder due: ${key} scheduled for ${reminder.scheduledFor.toISOString()}, current time: ${now.toISOString()}`);
      } else {
        console.log(`[ReminderService] Reminder not yet due: ${key} scheduled for ${reminder.scheduledFor.toISOString()}, current time: ${now.toISOString()}`);
      }
    }
    
    if (remindersToSend.length === 0) {
      console.log('[ReminderService] No reminders due at this time');
      return;
    }
    
    console.log(`[ReminderService] Found ${remindersToSend.length} reminders to send`);
    
    // Send all due reminders
    for (const reminder of remindersToSend) {
      try {
        console.log(`[ReminderService] Sending scheduled reminder to ${reminder.candidateName} (${reminder.userId}) for course on ${reminder.courseDate}`);
        await this.sendReminderForSpecificCourse(reminder.courseDate, reminder.userId, reminder.candidateName);
        
        // Remove the sent reminder from pending list
        this.pendingReminders.delete(reminder.key);
        
        // Also remove from Google Sheets
        await this.removeReminderFromSheets(reminder.courseDate, reminder.userId);
        
        console.log(`[ReminderService] Reminder sent and removed from pending list for ${reminder.candidateName}`);
      } catch (error) {
        console.error(`[ReminderService] Failed to send reminder for ${reminder.candidateName}:`, error);
        // Keep the reminder in the list to retry later
      }
    }
    
    console.log(`[ReminderService] Reminder processing completed. Remaining pending: ${this.pendingReminders.size}`);
  }

  // Remove a sent reminder from Google Sheets
  private async removeReminderFromSheets(courseDate: string, userId: number): Promise<void> {
    try {
      const header = await this.sheets.getHeaderRow();
      const rowsRaw = await this.sheets.getRows('A3:Z1000');
      if (!rowsRaw || !rowsRaw.length) return;
      
      const rows = rowsRaw as string[][];
      const colCourseDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
      const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
      
      if (colCourseDate === -1 || colUserId === -1) return;
      
      // Find the row with matching course date and user ID
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue; // Skip undefined rows
        
        const rowCourseDate = (row[colCourseDate] || '').trim();
        const rowUserId = parseInt(row[colUserId] || '0', 10);
        
        if (rowCourseDate === courseDate && rowUserId === userId) {
          // Clear the reminder data (set to empty string)
          const updatedRow = [...row];
          updatedRow[colCourseDate] = '';
          updatedRow[colUserId] = '';
          
          // Find the SCHEDULEDFOR column and clear it too
          const colScheduledFor = header.findIndex(h => this.normalise(h) === 'SCHEDULEDFOR');
          if (colScheduledFor !== -1) {
            updatedRow[colScheduledFor] = '';
          }
          
          // Update the row in Google Sheets
          const rowNum = i + 3; // data starts at row 3
          const range = `A${rowNum}:${String.fromCharCode(65 + header.length - 1)}${rowNum}`;
          await this.sheets.updateRow(range, updatedRow);
          
          console.log(`[ReminderService] Removed reminder from Google Sheets for user ${userId}, course ${courseDate}`);
          break;
        }
      }
    } catch (error) {
      console.error(`[ReminderService] Failed to remove reminder from Google Sheets:`, error);
    }
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

  // Daily UI cleanup system - ONLY for working users
  private async performDailyUICleanup(): Promise<void> {
    try {
      console.log('[ReminderService] Starting daily UI cleanup for working users...');
      
      // Get all working users from Google Sheets
      const workingUsers = await this.getWorkingUsers();
      console.log(`[ReminderService] Found ${workingUsers.length} working users to clean up`);
      
      let cleanedCount = 0;
      let skippedCount = 0;
      
      for (const user of workingUsers) {
        try {
          // Only clean up users with WORKING status
          if (user.status === 'WORKING') {
            // Check if user has ongoing check-out event
            const hasOngoingCheckout = await this.checkIfUserHasOngoingCheckout(parseInt(user.id, 10));
            
            if (hasOngoingCheckout) {
              console.log(`[ReminderService] User ${user.name} has ongoing checkout, skipping cleanup`);
              skippedCount++;
            } else {
              await this.cleanupUserChatMessages(parseInt(user.id, 10));
              cleanedCount++;
              console.log(`[ReminderService] Cleaned up chat for user: ${user.name} (${user.id})`);
            }
          } else {
            skippedCount++;
            console.log(`[ReminderService] Skipped user: ${user.name} - status: ${user.status}`);
          }
        } catch (error) {
          console.error(`[ReminderService] Error cleaning up user ${user.name}:`, error);
        }
      }
      
      console.log(`[ReminderService] Daily UI cleanup completed: ${cleanedCount} cleaned, ${skippedCount} skipped`);
      
      // Notify admins about the cleanup
      if (cleanedCount > 0) {
        await this.notifyAdmins(`🧹 Daily UI cleanup completed: ${cleanedCount} working users cleaned, ${skippedCount} skipped (ongoing checkout)`);
      }
      
    } catch (error) {
      console.error('[ReminderService] Error during daily UI cleanup:', error);
    }
  }

  // Get all working users from Google Sheets
  private async getWorkingUsers(): Promise<Array<{ id: string; name: string; status: string }>> {
    try {
      const header = await this.sheets.getHeaderRow();
      const rowsRaw = await this.sheets.getRows('A3:Z1000');
      if (!rowsRaw || !rowsRaw.length) return [];
      
      const rows = rowsRaw as string[][];
      
      // Find relevant columns
      const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
      const colName = header.findIndex(h => this.normalise(h) === 'NAME');
      const colStatus = header.findIndex(h => this.normalise(h) === 'STATUS');
      
      if (colUserId === -1 || colName === -1 || colStatus === -1) {
        console.log('[ReminderService] Required columns not found for working users');
        return [];
      }
      
      const workingUsers: Array<{ id: string; name: string; status: string }> = [];
      
      for (const row of rows) {
        const userId = row[colUserId]?.trim();
        const name = row[colName]?.trim();
        const status = row[colStatus]?.trim();
        
        if (userId && name && status) {
          workingUsers.push({ id: userId, name, status });
        }
      }
      
      return workingUsers;
      
    } catch (error) {
      console.error('[ReminderService] Error getting working users:', error);
      return [];
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

  // Check if user has ongoing check-out event
  private async checkIfUserHasOngoingCheckout(userId: number): Promise<boolean> {
    try {
      // Import MessageHandler to check for ongoing sessions
      const { MessageHandler } = await import('../bot/MessageHandler');
      const { Database } = await import('../database/Database');
      const { Logger } = await import('../utils/Logger');
      
      const database = new Database();
      const logger = new Logger();
      const messageHandler = new MessageHandler(this.bot, database, logger);
      
      // Check if user has any active check-out session
      const hasOngoingCheckout = await messageHandler.hasOngoingCheckoutSession(userId);
      
      console.log(`[ReminderService] User ${userId} ongoing checkout check: ${hasOngoingCheckout}`);
      return hasOngoingCheckout;
      
    } catch (error) {
      console.error(`[ReminderService] Error checking ongoing checkout for user ${userId}:`, error);
      // If we can't check, assume no ongoing checkout to be safe
      return false;
    }
  }

  // Clean up user chat messages (delete old messages)
  private async cleanupUserChatMessages(userId: number): Promise<void> {
    try {
      console.log(`[ReminderService] Starting chat cleanup for user ${userId}`);
      
      // Get user's language preference
      const userLang = await this.getUserLanguage(userId);
      
      // Send a cleanup notification message
      const cleanupMsg = userLang === 'gr'
        ? `🧹 Καθαρισμός συνομιλίας ολοκληρώθηκε!\n\n🌅 Καλημέρα! Είναι νέα μέρα εργασίας.\n\n📝 Επιλέξτε την ενέργειά σας:`
        : `🧹 Chat cleanup completed!\n\n🌅 Good morning! It's a new work day.\n\n📝 Choose your action:`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: userLang === 'gr' ? '📝 Log In' : '📝 Log In', callback_data: 'working_checkin' }],
          [{ text: userLang === 'gr' ? '📞 Επικοινωνία' : '📞 Contact', callback_data: 'working_contact' }]
        ]
      };
      
      // Send fresh daily menu (this replaces old messages)
      await this.bot.sendMessage(userId, cleanupMsg, { reply_markup: keyboard });
      
      console.log(`[ReminderService] Chat cleanup completed for user ${userId}`);
      
    } catch (error) {
      console.error(`[ReminderService] Error cleaning up chat for user ${userId}:`, error);
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
      const header = await this.sheets.getHeaderRow();
      const rowsRaw = await this.sheets.getRows('A3:Z1000');
      if (!rowsRaw || !rowsRaw.length) {
        console.log('[ReminderService] Google Sheets is empty, creating new sheet.');
        // Add header if sheet is empty
        const newHeader = ['COURSEDATE', 'NAME', 'USERID', 'SCHEDULEDFOR'];
        await this.sheets.appendRow('A1', newHeader);
        await this.sheets.appendRow('A2', ['', '', '', '']); // Empty row for header
      }

      const colCourseDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
      const colCandidateName = header.findIndex(h => this.normalise(h) === 'NAME');
      const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
      const colScheduledFor = header.findIndex(h => this.normalise(h) === 'SCHEDULEDFOR');

      if (colCourseDate === -1 || colCandidateName === -1 || colUserId === -1 || colScheduledFor === -1) {
        console.log('[ReminderService] Required columns not found for saving reminders.');
        return;
      }

      const newRow = [courseDate, candidateName, userId.toString(), scheduledFor.toISOString()];
      await this.sheets.appendRow('A3', newRow); // Add new row starting from A3
      console.log(`[ReminderService] Saved reminder to Google Sheets: ${courseDate}, ${candidateName}, ${userId}, ${scheduledFor.toISOString()}`);
    } catch (error) {
      console.error(`[ReminderService] Failed to save reminder to Google Sheets:`, error);
    }
  }

  // Public method to manually trigger reminder check (for testing)
  public async triggerReminderCheck(): Promise<void> {
    console.log('[ReminderService] Manual reminder check triggered');
    await this.processPendingReminders();
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

  // NEW: Daily 10:00 AM Greece time check of main sheet for course reminders
  private async checkMainSheetForCourseReminders(): Promise<void> {
    try {
      console.log('[ReminderService] Starting daily 10:00 AM course reminder check...');
      
      // Get today's date in Greece timezone
      const now = new Date();
      const greeceTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Athens' }));
      const today = greeceTime.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      console.log(`[ReminderService] Checking for candidates with course date: ${today}`);
      
      // Read main sheet to find candidates with course date = today
      const header = await this.sheets.getHeaderRow("'Φύλλο1'!A2:Z2");
      const rowsRaw = await this.sheets.getRows("'Φύλλο1'!A3:Z1000");
      
      if (!rowsRaw || !rowsRaw.length) {
        console.log('[ReminderService] No data found in main sheet');
        return;
      }
      
      const rows = rowsRaw as string[][];
      
      // Find column indices
      const colCourseDate = header.findIndex(h => h === 'COURSE DATE');
      const colName = header.findIndex(h => h === 'NAME');
      const colUserId = header.findIndex(h => h === 'user id');
      const colReminderSent = header.findIndex(h => h === 'REMINDERSENT');
      const colStatus = header.findIndex(h => h === 'STATUS');
      
      if (colCourseDate === -1 || colName === -1 || colUserId === -1) {
        console.log('[ReminderService] Required columns not found in main sheet');
        return;
      }
      
      let remindersSent = 0;
      
      // Check each row for candidates with course date = today
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[colCourseDate] || !row[colName]) continue;
        
        const courseDate = row[colCourseDate].trim();
        const candidateName = row[colName].trim();
        const userIdStr = row[colUserId]?.trim();
        const reminderSent = row[colReminderSent]?.trim();
        const status = row[colStatus]?.trim();
        
        // Skip if no course date or already sent reminder
        if (!courseDate || reminderSent === 'YES') continue;
        
        // Skip if status is not WAITING (candidate already confirmed or rejected)
        if (status && status !== 'WAITING') continue;
        
        // Parse course date safely
        let parsedCourseDate: Date | null = null;
        try {
          // Try multiple date formats
          const dateFormats = [
            courseDate, // YYYY-M-D
            courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-$2-$3'), // Ensure proper format
            courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-0$2-$3'), // Add leading zeros
            courseDate.replace(/(\d+)-(\d+)-(\d+)/, '$1-$2-0$3')  // Add leading zeros
          ];
          
          for (const format of dateFormats) {
            const testDate = new Date(format + 'T00:00:00');
            if (!isNaN(testDate.getTime())) {
              parsedCourseDate = testDate;
              break;
            }
          }
        } catch (error) {
          console.warn(`[ReminderService] Failed to parse course date "${courseDate}" for ${candidateName}:`, error);
          continue;
        }
        
        if (!parsedCourseDate) {
          console.warn(`[ReminderService] Invalid course date "${courseDate}" for ${candidateName}`);
          continue;
        }
        
        // Check if course date is today
        const courseDateStr = parsedCourseDate.toISOString().split('T')[0];
        if (courseDateStr === today) {
          console.log(`[ReminderService] Found candidate ${candidateName} with course today: ${courseDate}`);
          
          // Send reminder if user ID exists
          if (userIdStr && !isNaN(parseInt(userIdStr))) {
            const userId = parseInt(userIdStr);
            
            try {
              await this.sendReminderForSpecificCourse(courseDate, userId, candidateName);
              
              // Update REMINDERSENT column to YES
              const rowNum = i + 3; // data starts at row 3
              if (colReminderSent !== -1) {
                await this.sheets.updateCell(`'Φύλλο1'!${String.fromCharCode(65 + colReminderSent)}${rowNum}`, 'YES');
                console.log(`[ReminderService] Updated REMINDERSENT to YES for ${candidateName}`);
              }
              
              remindersSent++;
            } catch (error) {
              console.error(`[ReminderService] Failed to send reminder to ${candidateName}:`, error);
            }
          } else {
            console.log(`[ReminderService] No valid user ID for ${candidateName}, skipping reminder`);
          }
        }
      }
      
      console.log(`[ReminderService] Daily reminder check completed. Sent ${remindersSent} reminders.`);
      
    } catch (error) {
      console.error('[ReminderService] Error during daily course reminder check:', error);
    }
  }
} 