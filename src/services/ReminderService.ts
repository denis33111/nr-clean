import TelegramBot from 'node-telegram-bot-api';
// @ts-ignore – No types for node-cron in repo
import cron from 'node-cron';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';

export class ReminderService {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient) {
    this.bot = bot;
    this.sheets = sheets;
    
    console.log('[ReminderService] Initializing scheduled reminders...');
    
    // Run no-response check at 18:00 (6 PM) every day
    cron.schedule('0 18 * * *', () => {
      console.log('[ReminderService] Running no-response check at 6:00 PM');
      this.checkNoResponses().catch(console.error);
    });
    
    // Run daily refresh at midnight (00:00) every day - ONLY for working users
    cron.schedule('0 0 * * *', () => {
      console.log('[ReminderService] Starting daily refresh for working users at midnight');
      this.performDailyRefresh().catch(console.error);
    });
    
    console.log('[ReminderService] Reminder service initialized - reminders will be scheduled when courses are added');
  }

  // Public method to schedule reminder for a specific course
  public scheduleReminderForCourse(courseDate: string, candidateName: string, userId: number) {
    console.log(`[ReminderService] scheduleReminderForCourse called for ${candidateName} (${userId}) on ${courseDate}`);
    
    // Parse the course date
    const courseDateTime = new Date(courseDate + 'T00:00:00');
    const reminderDate = new Date(courseDateTime);
    reminderDate.setDate(reminderDate.getDate() - 1); // 1 day before
    reminderDate.setHours(10, 0, 0, 0); // 10:00 AM
    
    const now = new Date();
    const delayMs = reminderDate.getTime() - now.getTime();
    
    console.log(`[ReminderService] Course date: ${courseDate}`);
    console.log(`[ReminderService] Reminder scheduled for: ${reminderDate.toISOString()}`);
    console.log(`[ReminderService] Current time: ${now.toISOString()}`);
    console.log(`[ReminderService] Delay: ${delayMs}ms (${Math.round(delayMs / 1000 / 60)} minutes)`);
    
    // If reminder time has already passed, send immediately
    if (delayMs <= 0) {
      console.log(`[ReminderService] Reminder time has passed, sending immediately`);
      setTimeout(() => {
        console.log(`[ReminderService] Sending immediate reminder to ${candidateName} (${userId}) for course on ${courseDate}`);
        this.sendReminderForSpecificCourse(courseDate, userId, candidateName);
      }, 5000); // 5 seconds delay
    } else {
      // Schedule for the correct time
      setTimeout(() => {
        console.log(`[ReminderService] Sending scheduled reminder to ${candidateName} (${userId}) for course on ${courseDate}`);
        this.sendReminderForSpecificCourse(courseDate, userId, candidateName);
      }, delayMs);
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

  // Daily refresh system - ONLY for working users
  private async performDailyRefresh(): Promise<void> {
    try {
      console.log('[ReminderService] Starting daily refresh for working users...');
      
      // Get all working users from Google Sheets
      const workingUsers = await this.getWorkingUsers();
      console.log(`[ReminderService] Found ${workingUsers.length} working users to refresh`);
      
      let refreshedCount = 0;
      let skippedCount = 0;
      
      for (const user of workingUsers) {
        try {
          // Only refresh users with WORKING status
          if (user.status === 'WORKING') {
            await this.refreshWorkingUser(user);
            refreshedCount++;
            console.log(`[ReminderService] Refreshed working user: ${user.name} (${user.id})`);
          } else {
            skippedCount++;
            console.log(`[ReminderService] Skipped user: ${user.name} - status: ${user.status}`);
          }
        } catch (error) {
          console.error(`[ReminderService] Error refreshing user ${user.name}:`, error);
        }
      }
      
      console.log(`[ReminderService] Daily refresh completed: ${refreshedCount} refreshed, ${skippedCount} skipped`);
      
      // Notify admins about the refresh
      if (refreshedCount > 0) {
        await this.notifyAdmins(`🔄 Daily refresh completed: ${refreshedCount} working users refreshed for new day`);
      }
      
    } catch (error) {
      console.error('[ReminderService] Error during daily refresh:', error);
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
} 