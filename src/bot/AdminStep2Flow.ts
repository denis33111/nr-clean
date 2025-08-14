import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
import { AdminService } from '../services/AdminService';
import { Database } from '../database/Database';

interface AdminSession {
  row: number;
  step: number;
  answers: Record<string, string>;
  agreed?: boolean;
  position?: string;
  awaitingCustomDate?: boolean;
  rejectionChoice?: 'only' | 'alt';
  lastActivity: number; // Timestamp of last activity
  awaitingRescheduleDate?: boolean; // New for reschedule flow
}

const POSITION_OPTIONS = ['HL', 'Supervisor', 'EQ'];

const QUESTIONS_BASE = [
  { key: 'AGREED', text: 'Να συνεχίσουμε με τον υποψήφιο;', options: ['Ναι', 'Όχι'] },
  { key: 'POSITION', text: 'Θέση;', options: POSITION_OPTIONS },
  // COURSE_DATE will be asked with preset buttons after position
  { key: 'NOTES', text: 'Σημειώσεις; (προαιρετικά, "-" για παράλειψη)' }
];

// Export admin sessions so MessageHandler can check for active admin flows
export const adminSessions: Map<number, AdminSession> = new Map();

export class AdminStep2Flow {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;
  private adminService: AdminService;
  private sessions = adminSessions;
  private reminderService: any; // Will be set from outside

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient, database: Database) {
    this.bot = bot;
    this.sheets = sheets;
    this.adminService = new AdminService(database);
    // Don't set up handlers automatically - let index.ts control this
    // this.setupHandlers();
    this.setupSessionCleanup();
  }

  // Public method to set reminder service (called from outside)
  public setReminderService(reminderService: any): void {
    console.log(`[AdminStep2Flow] Setting reminder service: ${!!reminderService}`);
    console.log(`[AdminStep2Flow] Reminder service type: ${typeof reminderService}`);
    console.log(`[AdminStep2Flow] Reminder service methods: ${reminderService ? Object.getOwnPropertyNames(Object.getPrototypeOf(reminderService)) : 'null'}`);
    this.reminderService = reminderService;
  }

  // Setup session cleanup to prevent memory leaks
  private setupSessionCleanup(): void {
    // Clean up expired sessions every 10 minutes
    setInterval(() => {
      const now = Date.now();
      const sessionTTL = 30 * 60 * 1000; // 30 minutes TTL
      let cleanedCount = 0;
      
      for (const [userId, session] of this.sessions) {
        // Check if session is too old (no activity for 30 minutes)
        const lastActivity = session.lastActivity || 0;
        if (now - lastActivity > sessionTTL) {
          this.sessions.delete(userId);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`[AdminStep2Flow] Memory cleanup: Removed ${cleanedCount} expired sessions`);
      }
      
      // Log session count for monitoring
      if (this.sessions.size > 0) {
        console.log(`[AdminStep2Flow] Active sessions: ${this.sessions.size}`);
      }
    }, 10 * 60 * 1000); // Every 10 minutes
  }

  // Public method to set up handlers (called from index.ts)
  public setupHandlers(): void {
    // /pending2 command – list rows where STEP2 = pending
    this.bot.onText(/\/pending2/, async (msg) => {
      if (!msg.from) return;
      // Only allow in group chats, not private chats
      if (msg.chat.type === 'private') return;
      if (!(await this.adminService.isAdmin(msg.from.id, msg.chat.id, this.bot))) return;
      const header = await this.sheets.getHeaderRow();
      const dataRows = await this.sheets.getRows('A3:Z1000');
      const rows: any[] = dataRows || [];
      const colStep2 = header.findIndex((h) => h.toUpperCase().replace(/\s/g, '') === 'STEP2');
      const colName = header.findIndex((h) => h.toUpperCase().replace(/\s/g, '') === 'NAME');
      const pendingRows = rows
        .map((r, idx) => ({ r, idx }))
        .filter(({ r }) => r[colStep2] === 'pending');

      if (pendingRows.length === 0) {
        await this.bot.sendMessage(msg.chat.id, 'No candidates waiting for Step-2.');
        return;
      }

      const keyboardRows = pendingRows.map(({ r, idx }) => [{
        text: `${r[colName] || 'Unnamed'} (row ${idx + 3})`,
        callback_data: `step2_${idx + 3}`
      }]);

      await this.bot.sendMessage(msg.chat.id, 'Pending Step-2 candidates:', {
        reply_markup: { inline_keyboard: keyboardRows }
      });
    });

    // /reschedule command – list candidates who requested reschedule
    this.bot.onText(/\/reschedule/, async (msg) => {
      if (!msg.from) return;
      // Only allow in group chats, not private chats
      if (msg.chat.type === 'private') return;
      if (!(await this.adminService.isAdmin(msg.from.id, msg.chat.id, this.bot))) return;
      
      await this.showRescheduleRequests(msg.chat.id);
    });

    // Handle inline button callback "step2_row" as well as /step2_row command
    const startSession = async (row: number, chatId: number) => {
      this.sessions.set(chatId, { row, step: 0, answers: {}, lastActivity: Date.now() });
    };

    this.bot.onText(/\/step2_(\d+)/, async (msg, match) => {
      if (!msg.from || !match) return;
      // Only allow in group chats, not private chats
      if (msg.chat.type === 'private') return;
      if (!(await this.adminService.isAdmin(msg.from.id, msg.chat.id, this.bot))) return;
      const row = parseInt(match[1]!, 10);
      if (isNaN(row)) return;
      this.sessions.set(msg.from.id, { row, step: 0, answers: {}, lastActivity: Date.now() });
      await this.handleNextStep(msg.from.id, msg.chat.id);
    });

    // Handle callback queries for reschedule actions
    this.bot.on('callback_query', async (q) => {
      if (!q.from || !q.data) return;
      // Only process AdminStep2Flow-specific callbacks
      const isAdminStep2Callback = q.data.startsWith('step2_') || 
                                  q.data.startsWith('a2_') || 
                                  q.data.startsWith('cdate_') || 
                                  q.data === 'rej_only' || 
                                  q.data === 'rej_alt' ||
                                  q.data.startsWith('reschedule_');
      if (!isAdminStep2Callback) {
        // Not an AdminStep2Flow callback, ignore it
        return;
      }
      console.log(`[AdminStep2Flow] Callback received: ${q.data} from user ${q.from.id} in chat ${q.message?.chat.id} (type: ${q.message?.chat.type})`);
      // Only allow in group chats, not private chats
      if (q.message?.chat.type === 'private') {
        console.log(`[AdminStep2Flow] Skipping private chat callback: ${q.data}`);
        return;
      }
      
      if (q.data.startsWith('reschedule_')) {
        await this.handleRescheduleCallback(q);
        return;
      }
      
      if (q.data.startsWith('step2_')) {
        console.log(`[AdminStep2Flow] Processing step2 callback: ${q.data}`);
        const row = parseInt(q.data.replace('step2_', ''), 10);
        if (isNaN(row)) {
          console.log(`[AdminStep2Flow] Invalid row number in callback: ${q.data}`);
          return;
        }
        console.log(`[AdminStep2Flow] Checking admin permissions for user ${q.from.id}`);
        const isAdmin = await this.adminService.isAdmin(q.from.id, q.message!.chat.id, this.bot);
        console.log(`[AdminStep2Flow] Admin check result for user ${q.from.id}: ${isAdmin}`);
        if (!isAdmin) return;
        this.sessions.set(q.from.id, { row, step: 0, answers: {}, lastActivity: Date.now() });
        await this.handleNextStep(q.from.id, q.message!.chat.id);
      } else if (q.data.startsWith('a2_')) {
        const value = q.data.substring(3);
        console.log(`[AdminStep2Flow] Processing a2_ callback: ${value}`);
        const sess = this.sessions.get(q.from.id);
        if (!sess) return;
        const dynQuestions = this.getQuestions(sess);
        const question = dynQuestions[sess.step];
        if (question) {
          const k = question.key.replace(/\s|_/g, '').toUpperCase();
          sess.answers[k] = value;
          if (k === 'AGREED') sess.agreed = /yes/i.test(value);
          if (k === 'POSITION') sess.position = value;
          sess.step++;
          console.log(`[AdminStep2Flow] Updated session for user ${q.from.id}: step=${sess.step}, agreed=${sess.agreed}`);
        }
        await this.bot.answerCallbackQuery(q.id);
        await this.handleNextStep(q.from.id, q.message!.chat.id);
      }

      // Handle rejection choice callbacks
      if (q.data === 'rej_only' || q.data === 'rej_alt') {
        console.log(`[AdminStep2Flow] Processing rejection choice: ${q.data}`);
        const sess = this.sessions.get(q.from.id);
        if (!sess) return;
        sess.rejectionChoice = q.data === 'rej_only' ? 'only' : 'alt';
        // Answer callback to remove loading spinner
        await this.bot.answerCallbackQuery(q.id);
        // Proceed to finish and save
        await this.saveAndFinish(q.from.id, q.message!.chat.id);
        return;
      }

      // Handle preset course date buttons
      if (q.data.startsWith('cdate_')) {
        console.log(`[AdminStep2Flow] Processing course date callback: ${q.data}`);
        const sess = this.sessions.get(q.from.id);
        if (!sess) return;
        const dateStr = q.data.replace('cdate_', '');
        if (dateStr === 'custom') {
          sess.awaitingCustomDate = true;
          await this.bot.answerCallbackQuery(q.id);
          await this.bot.sendMessage(q.message!.chat.id, 'Enter course date (e.g. 2025-07-18):', {
            reply_markup: { force_reply: true }
          });
        } else {
          sess.answers['COURSEDATE'] = dateStr;
          sess.step = 3; // move to notes
          await this.bot.answerCallbackQuery(q.id);
          await this.handleNextStep(q.from.id, q.message!.chat.id);
        }
        return;
      }
    });

    // Handle text messages for reschedule flow and regular admin flow
    this.bot.on('message', async (msg) => {
      if (!msg.from || !msg.text || msg.text.startsWith('/')) return;
      // Only allow in group chats, not private chats
      if (msg.chat.type === 'private') return;
      
      const session = this.sessions.get(msg.from.id);
      if (!session) return;

      // Handle reschedule date input
      if (session.awaitingRescheduleDate) {
        await this.handleNewCourseDate(msg.from.id, msg.text.trim(), msg.chat.id);
        return;
      }

      // Handle regular admin flow
      if (msg.text && !msg.text.startsWith('/')) {
        // Handle custom date input first (special case)
        if (session.awaitingCustomDate) {
          session.answers['COURSEDATE'] = msg.text.trim();
          session.awaitingCustomDate = false;
          session.step = 3; // notes
          await this.handleNextStep(msg.from.id, msg.chat.id);
          return;
        }
        // Handle regular questions
        const question = this.getQuestions(session)[session.step];
        if (question) {
          const k = question.key.replace(/\s|_/g, '').toUpperCase();
          session.answers[k] = msg.text.trim();
          session.step++;
          await this.handleNextStep(msg.from.id, msg.chat.id);
        }
      }
    });
  }

  private async handleNextStep(userId: number, chatId: number) {
    const sess = this.sessions.get(userId);
    if (!sess) return;

    console.log(`DEBUG handleNextStep: step=${sess.step}, agreed=${sess.agreed}`);

    // If explicitly disagreed but choice not yet made, ask how to notify candidate
    if (sess.agreed === false) {
      if (!sess.rejectionChoice) {
        console.log('DEBUG: Asking rejection choice');
        await this.askRejectionChoice(userId, chatId);
        return;
      }
      console.log('DEBUG: Going to saveAndFinish with rejection choice');
      await this.saveAndFinish(userId, chatId);
      return;
    }

    // Step 0: AGREED, Step 1: POSITION, Step 2: COURSE_DATE (preset), Step 3: NOTES
    if (sess.step === 2) {
      console.log('DEBUG: Asking course date');
      await this.askCourseDate(userId, chatId);
    } else if (sess.step === 3) {
      console.log('DEBUG: Asking notes');
      await this.askNotes(userId, chatId);
    } else if (sess.step >= 4) {
      console.log('DEBUG: Going to saveAndFinish because step >= 4');
      await this.saveAndFinish(userId, chatId);
    } else {
      console.log('DEBUG: Asking next question');
      await this.askNext(userId, chatId);
    }
  }

  private async askNext(userId: number, chatId: number) {
    const sess = this.sessions.get(userId);
    if (!sess) return;
    const q = QUESTIONS_BASE[sess.step];
    if (!q) return;
    if (q.options) {
      const buttons = q.options.map((o: string) => {
        // For AGREED question translate labels but keep EN callback values
        if (q.key === 'AGREED') {
          const cb = o.toLowerCase().startsWith('ν') ? 'Yes' : o.toLowerCase().startsWith('ό') ? 'No' : o;
          return [{ text: o, callback_data: `a2_${cb}` }];
        }
        return [{ text: o, callback_data: `a2_${o}` }];
      });
      await this.bot.sendMessage(chatId, q.text, {
        reply_markup: { inline_keyboard: buttons },
      });
    } else {
      await this.bot.sendMessage(chatId, q.text);
    }
  }

  private async askCourseDate(userId: number, chatId: number) {
    const sess = this.sessions.get(userId);
    if (!sess) return;

    const position = sess.position || 'HL';
    const isEQ = position === 'EQ';
    const targetDay = isEQ ? 5 : 4; // Friday = 5, Thursday = 4 (0=Sunday)

    // Calculate next two course dates (not today)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of today
    
    // Get next available date (not today)
    let nextDate = this.getNextDateForDay(now, targetDay);
    if (nextDate.getTime() === today.getTime()) {
      // If next date is today, get the following week
      nextDate.setDate(nextDate.getDate() + 7);
    }
    
    // Get the date after that
    const weekAfter = new Date(nextDate);
    weekAfter.setDate(weekAfter.getDate() + 7);

    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    const dayName = isEQ ? 'Παρασκευή' : 'Πέμπτη';

    const keyboard = {
      inline_keyboard: [
        [{ text: `${dayName} ${formatDate(nextDate)} 9:50-15:00`, callback_data: `cdate_${formatDate(nextDate)}` }],
        [{ text: `${dayName} ${formatDate(weekAfter)} 9:50-15:00`, callback_data: `cdate_${formatDate(weekAfter)}` }],
        [{ text: '📅 Custom date', callback_data: 'cdate_custom' }]
      ]
    };

    await this.bot.sendMessage(chatId, 'Ημερομηνία εκπαίδευσης;', {
      reply_markup: keyboard
    });
  }

  private getNextDateForDay(from: Date, targetDay: number): Date {
    const result = new Date(from);
    const currentDay = result.getDay();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7; // next week if today is same day or later
    result.setDate(result.getDate() + daysToAdd);
    return result;
  }

  private async askNotes(userId: number, chatId: number) {
    await this.bot.sendMessage(chatId, 'Any notes? (optional, send "-" to skip)', {
      reply_markup: { force_reply: true }
    });
  }

  private async askRejectionChoice(userId: number, chatId: number) {
    await this.bot.sendMessage(chatId, 'Πώς θέλετε να ενημερώσετε τον υποψήφιο για την απόρριψη τους;', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Μόνο απόρριψη (μόνο το μήνυμα απόρριψης)', callback_data: 'rej_only' }],
          [{ text: 'Απόρριψη και προτεινόμενη θέση (μήνυμα απόρριψης και μήνυμα προτεινόμενης θέσης)', callback_data: 'rej_alt' }]
        ]
      }
    });
  }

  private getQuestions(sess?: { agreed?: boolean }): any[] {
    if (!sess) return QUESTIONS_BASE;
    if (sess.agreed) {
      return [
        QUESTIONS_BASE[0], // AGREED
        QUESTIONS_BASE[1], // POSITION
        { key: 'COURSE_DATE', text: 'Course date? (e.g. 2025-07-18)' },
        QUESTIONS_BASE[2]  // NOTES
      ];
    }
    return QUESTIONS_BASE;
  }

  private async saveAndFinish(userId: number, chatId: number) {
    const sess = this.sessions.get(userId);
    console.log('[AdminStep2Flow] DEBUG: Entered saveAndFinish. sess.agreed:', sess?.agreed, 'sess.answers.AGREED:', sess?.answers?.AGREED);
    if (!sess) return;
    
    // Normalize agreed value
    const isAgreed = sess.agreed === true || sess.answers.AGREED === 'Yes';
    if (isAgreed) {
      console.log(`DEBUG saveAndFinish: step=${sess.step}, agreed=${sess.agreed}, answers=`, sess.answers);
      
      const header = await this.sheets.getHeaderRow();
      const rowRange = `A${sess.row}:${String.fromCharCode(65 + header.length - 1)}${sess.row}`;
      const rowData = await this.sheets.getRows(rowRange);
      const current = (rowData[0] as string[]) || [];

      // Ensure current row array has the same length as header
      while (current.length < header.length) {
        current.push('');
      }

      const normalise = (s: string) => s.replace(/\s|_/g, '').toUpperCase();
      header.forEach((h, idx) => {
        const key = normalise(h);
        if (key === 'STEP2') current[idx] = 'done';
        if (key in sess.answers) current[idx] = sess.answers[key] || '';
        if (key === 'JOBPOSITION' && sess.answers['POSITION']) {
          current[idx] = sess.answers['POSITION'];
        }
        if (key === 'STATUS') {
          current[idx] = sess.agreed === false ? 'STOP' : 'WAITING';
        }
        if (key === 'STEP3') {
          current[idx] = sess.agreed === false ? 'cancelled' : 'in-progress';
        }
      });

      // Set default values for tracking columns
      ['COURSE_CONFIRMED', 'REMINDER_SENT'].forEach(col => {
        const i = header.findIndex(h => normalise(h) === col);
        if (i !== -1) current[i] = '';
      });

      await this.sheets.updateRow(rowRange, current);

      // Ensure rejected candidates always have STATUS = STOP (safety override)
      if (sess.agreed === false) {
        const statusIdx = header.findIndex(h => normalise(h) === 'STATUS');
        if (statusIdx !== -1 && current[statusIdx] !== 'STOP') {
          current[statusIdx] = 'STOP';
          await this.sheets.updateRow(rowRange, current);
        }
      }

      // Helper to get candidate name if present
      const nameIdx = header.findIndex(h => normalise(h) === 'NAME');
      const candidateName = nameIdx !== -1 ? (current[nameIdx] || 'Unknown') : 'Unknown';

      // Send congratulations message if agreed
      if (isAgreed) {
        const uidIdx = header.findIndex((h) => normalise(h) === 'USERID');
        if (uidIdx !== -1) {
          const uid = parseInt(current[uidIdx] as string, 10);
          if (!isNaN(uid)) {
            const position = sess.position || '';
            const courseDate = sess.answers['COURSEDATE'] || 'TBA';
            
            // Get language preference
            const langIdx = header.findIndex(h => normalise(h) === 'LANG' || normalise(h) === 'LANGUAGE');
            const lang = langIdx !== -1 ? (current[langIdx] || '').toLowerCase() : 'en';
            const isGreek = lang.startsWith('gr');
            
            const message = isGreek 
              ? `Συγχαρητήρια ${candidateName}! Έχετε επιλεγεί για τη θέση ${position}.\nΗ εισαγωγική εκπαίδευση θα πραγματοποιηθεί ${courseDate} στις 9:50-15:00.\n\nΠαρακαλούμε υποβάλετε όλα τα απαραίτητα έγγραφα όπως συζητήσαμε νωρίτερα.\n\nΕάν χρειάζεστε βοήθεια, μη διστάσετε να επικοινωνήσετε μαζί μας.`
              : `Congratulations ${candidateName}! You have been selected for the position of ${position}.\nThe introductory training will take place on ${courseDate} at 9:50-15:00.\n\nPlease submit all necessary documents as we discussed earlier.\n\nIf you need help, don't hesitate to contact us.`;

            await this.bot.sendMessage(uid, message);
            console.log('[AdminStep2Flow] DEBUG: Sent congratulatory message to', candidateName, uid, 'for course', courseDate);
            // Schedule reminder for 1 minute after course is scheduled
            console.log('[AdminStep2Flow] DEBUG: About to schedule reminder. reminderService:', !!this.reminderService, 'courseDate:', courseDate, 'uid:', uid, 'candidateName:', candidateName);
            if (this.reminderService && courseDate !== 'TBA') {
              console.log(`[AdminStep2Flow] Scheduling reminder for ${candidateName} (${uid}) for course on ${courseDate}`);
              this.reminderService.scheduleReminderForCourse(courseDate, candidateName, uid);
            } else {
              console.log('[AdminStep2Flow] Reminder NOT scheduled:', {reminderService: !!this.reminderService, courseDate});
            }
          }
        }
        await this.bot.sendMessage(chatId, `✅ Ο/Η ${candidateName} εγκρίθηκε για τη θέση ${sess.position}. Εκπαίδευση: ${sess.answers['COURSEDATE'] || 'TBA'} (STATUS → WAITING)`);
      } else {
        await this.bot.sendMessage(chatId, `❌ Ο/Η ${candidateName} δεν εγκρίθηκε. STATUS → STOP.`);

        // Notify candidate based on admin's chosen rejection path
        const uidIdx = header.findIndex((h) => normalise(h) === 'USERID');
        if (uidIdx !== -1) {
          const uidRaw = current[uidIdx] as string;
          const uid = parseInt(uidRaw, 10);
          if (!isNaN(uid)) {
            if (sess.rejectionChoice === 'alt') {
              const rejectionMsg = `Δυστυχώς, η θέση ${sess.position || ''} δεν είναι διαθέσιμη αυτή τη στιγμή. Θα σας ενδιέφερε κάποια άλλη θέση;`;
              await this.bot.sendMessage(uid, rejectionMsg.trim(), {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'Ναι, παρακαλώ', callback_data: 'alt_yes' }],
                    [{ text: 'Όχι, ευχαριστώ', callback_data: 'alt_no' }]
                  ]
                }
              });
            } else {
              // Simple friendly rejection without alternative offer
              const rejectionMsg = `Δυστυχώς, η θέση ${sess.position || ''} δεν είναι πλέον διαθέσιμη. Σας ευχαριστούμε για το ενδιαφέρον και σας ευχόμαστε καλή συνέχεια!`;
              await this.bot.sendMessage(uid, rejectionMsg.trim());
            }
          }
        }
      }
      
      this.sessions.delete(userId);
    }
  }

  // Show candidates who requested reschedule
  private async showRescheduleRequests(chatId: number): Promise<void> {
    try {
      const header = await this.sheets.getHeaderRow();
      const dataRows = await this.sheets.getRows('A3:Z1000');
      const rows: any[] = dataRows || [];
      
      const colStep3 = header.findIndex((h) => h.toUpperCase().replace(/\s/g, '') === 'STEP3');
      const colName = header.findIndex((h) => h.toUpperCase().replace(/\s/g, '') === 'NAME');
      const colUserId = header.findIndex((h) => h.toUpperCase().replace(/\s/g, '') === 'USERID');
      const colCourseDate = header.findIndex((h) => h.toUpperCase().replace(/\s/g, '') === 'COURSEDATE');
      
      if (colStep3 === -1 || colName === -1 || colUserId === -1) {
        await this.bot.sendMessage(chatId, '❌ Error: Required columns not found in sheet.');
        return;
      }

      const rescheduleRows = rows
        .map((r, idx) => ({ r, idx }))
        .filter(({ r }) => r[colStep3] === 'reschedule');

      if (rescheduleRows.length === 0) {
        await this.bot.sendMessage(chatId, '✅ No candidates waiting for reschedule.');
        return;
      }

      const message = `🔄 **Candidates waiting for reschedule:**\n\n${rescheduleRows
        .map(({ r, idx }) => {
          const name = r[colName] || 'Unknown';
          const userId = r[colUserId] || 'Unknown';
          const courseDate = r[colCourseDate] || 'Unknown';
          return `• **${name}** (ID: ${userId})\n  📅 Current date: ${courseDate}\n  📍 Row: ${idx + 3}`;
        })
        .join('\n\n')}`;

      const keyboard = rescheduleRows.map(({ r, idx }) => [{
        text: `🔄 Reschedule ${r[colName] || 'Unknown'}`,
        callback_data: `reschedule_${idx + 3}_${r[colUserId] || '0'}`
      }]);

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });

    } catch (error) {
      console.error('[AdminStep2Flow] Error showing reschedule requests:', error);
      await this.bot.sendMessage(chatId, '❌ Error loading reschedule requests.');
    }
  }

  // Handle reschedule callback from admin
  private async handleRescheduleCallback(q: TelegramBot.CallbackQuery): Promise<void> {
    try {
      if (!q.message) return;
      
      const parts = q.data!.split('_');
      if (parts.length < 3) return;
      
      const rowStr = parts[1];
      const userIdStr = parts[2];
      
      if (!rowStr || !userIdStr) return;
      
      const row = parseInt(rowStr, 10);
      const userId = parseInt(userIdStr, 10);
      
      if (isNaN(row) || isNaN(userId)) return;

      // Create admin session for reschedule
      this.sessions.set(q.from!.id, {
        row,
        step: 0,
        answers: {},
        awaitingRescheduleDate: true,
        lastActivity: Date.now()
      });

      await this.bot.answerCallbackQuery(q.id);
      
      // Ask admin for new course date
      await this.bot.sendMessage(q.message.chat.id, 
        `📅 **Reschedule Course**\n\nPlease enter the new course date in format: **YYYY-MM-DD**\n\nExample: 2025-08-20`,
        { parse_mode: 'Markdown' }
      );

    } catch (error) {
      console.error('[AdminStep2Flow] Error handling reschedule callback:', error);
      if (q.message) {
        await this.bot.answerCallbackQuery(q.id, { text: '❌ Error processing reschedule request.' });
      }
    }
  }

  // Handle new course date from admin
  private async handleNewCourseDate(adminId: number, dateStr: string, chatId: number): Promise<void> {
    try {
      const session = this.sessions.get(adminId);
      if (!session) return;

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateStr)) {
        await this.bot.sendMessage(chatId, 
          '❌ Invalid date format. Please use YYYY-MM-DD format.\n\nExample: 2025-08-20'
        );
        return;
      }

      // Validate date is in the future
      const courseDate = new Date(dateStr);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (courseDate <= today) {
        await this.bot.sendMessage(chatId, 
          '❌ Course date must be in the future. Please enter a valid future date.'
        );
        return;
      }

      // Update Google Sheets with new course date
      const header = await this.sheets.getHeaderRow();
      const rowRange = `A${session.row}:${String.fromCharCode(65 + header.length - 1)}${session.row}`;
      const rowData = await this.sheets.getRows(rowRange);
      const current = (rowData[0] as string[]) || [];
      while (current.length < header.length) current.push('');

      const normalise = (s: string) => s.replace(/\s|_/g, '').toUpperCase();
      
      // Update course date and reset status
      header.forEach((h, idx) => {
        const key = normalise(h);
        if (key === 'COURSEDATE') current[idx] = dateStr;
        if (key === 'STEP3') current[idx] = 'pending';
        if (key === 'COURSECONFIRMED') current[idx] = '';
        if (key === 'STATUS') current[idx] = 'CANDIDATE';
      });

      await this.sheets.updateRow(rowRange, current);

      // Get candidate info for notifications
      const colName = header.findIndex(h => normalise(h) === 'NAME');
      const colUserId = header.findIndex(h => normalise(h) === 'USERID');
      const candidateName = colName !== -1 ? current[colName] || 'Unknown' : 'Unknown';
      const candidateUserId = colUserId !== -1 ? current[colUserId] || '0' : '0';

      // Reschedule reminder for new date
      if (this.reminderService && this.reminderService.scheduleReminderForCourse) {
        try {
          await this.reminderService.scheduleReminderForCourse(candidateName, parseInt(candidateUserId, 10), dateStr);
          console.log(`[AdminStep2Flow] Rescheduled reminder for ${candidateName} on ${dateStr}`);
        } catch (reminderError) {
          console.error('[AdminStep2Flow] Error rescheduling reminder:', reminderError);
        }
      }

      // Notify admin of success
      await this.bot.sendMessage(chatId,
        `✅ **Course Rescheduled Successfully!**\n\n👤 **Candidate:** ${candidateName}\n📅 **New Date:** ${dateStr}\n🔄 **Status:** Reset to pending\n⏰ **Reminder:** Rescheduled for new date`,
        { parse_mode: 'Markdown' }
      );

      // Clear admin session
      this.sessions.delete(adminId);

    } catch (error) {
      console.error('[AdminStep2Flow] Error handling new course date:', error);
      await this.bot.sendMessage(chatId, '❌ Error updating course date. Please try again.');
    }
  }
} 