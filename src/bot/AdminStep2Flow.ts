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

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient, database: Database) {
    this.bot = bot;
    this.sheets = sheets;
    this.adminService = new AdminService(database);
    this.setupHandlers();
  }

  private setupHandlers() {
    // /pending2 command – list rows where STEP2 = pending
    this.bot.onText(/\/pending2/, async (msg) => {
      if (!msg.from) return;
      if (!(await this.adminService.isAdmin(msg.from.id))) return;
      const header = await this.sheets.getHeaderRow();
      const dataRows = await this.sheets.getRows(`A3:${String.fromCharCode(65 + header.length)}1000`);
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

    // Handle inline button callback "step2_row" as well as /step2_row command
    const startSession = async (row: number, chatId: number) => {
      this.sessions.set(chatId, { row, step: 0, answers: {} });
    };

    this.bot.onText(/\/step2_(\d+)/, async (msg, match) => {
      if (!msg.from || !match) return;
      if (!(await this.adminService.isAdmin(msg.from.id))) return;
      const row = parseInt(match[1]!, 10);
      if (isNaN(row)) return;
      this.sessions.set(msg.from.id, { row, step: 0, answers: {} });
      await this.handleNextStep(msg.from.id, msg.chat.id);
    });

    this.bot.on('callback_query', async (q) => {
      if (!q.from || !q.data) return;
      if (q.data.startsWith('step2_')) {
        const row = parseInt(q.data.replace('step2_', ''), 10);
        if (isNaN(row)) return;
        if (!(await this.adminService.isAdmin(q.from.id))) return;
        this.sessions.set(q.from.id, { row, step: 0, answers: {} });
        await this.bot.answerCallbackQuery(q.id);
        await this.handleNextStep(q.from.id, q.message!.chat.id);
        return;
      }
      const sess = this.sessions.get(q.from.id);
      if (!sess) return;
      if (q.data.startsWith('a2_')) {
        const value = q.data.substring(3);
        const dynQuestions = this.getQuestions(sess);
        const question = dynQuestions[sess.step];
        if (question) {
          const k = question.key.replace(/\s|_/g, '').toUpperCase();
          sess.answers[k] = value;
          if (k === 'AGREED') sess.agreed = /yes/i.test(value);
          if (k === 'POSITION') sess.position = value;
          sess.step++;
        }
        await this.bot.answerCallbackQuery(q.id);
        await this.handleNextStep(q.from.id, q.message!.chat.id);
      }

      // Handle rejection choice callbacks
      if (q.data === 'rej_only' || q.data === 'rej_alt') {
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

    this.bot.on('message', async (msg) => {
      // Only handle if user is in an admin session
      if (!msg.from || !this.sessions.has(msg.from.id)) return;
      const sess = this.sessions.get(msg.from.id);
      if (!sess) return;
      if (msg.text && !msg.text.startsWith('/')) {
        // Handle custom date input first (special case)
        if (sess.awaitingCustomDate) {
          sess.answers['COURSEDATE'] = msg.text.trim();
          sess.awaitingCustomDate = false;
          sess.step = 3; // notes
          await this.handleNextStep(msg.from.id, msg.chat.id);
          return;
        }
        // Handle regular questions
        const question = this.getQuestions(sess)[sess.step];
        if (question) {
          const k = question.key.replace(/\s|_/g, '').toUpperCase();
          sess.answers[k] = msg.text.trim();
          sess.step++;
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
    if (!sess) return;
    
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
    if (sess.agreed) {
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