import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
// @ts-ignore - pdfkit types added separately
import PDFDocument from 'pdfkit';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – get-stream default export with .buffer helper
// Using dynamic import for ES Module compatibility
let getStream: any;
import fs from 'fs';
import { courseSessions } from './CandidateCourseFlow';

const SHEET_RANGE = 'A2:G1000'; // Adjust as needed
const SHEET_HEADER = [
  'NAME', 'PHONE', 'ADRESS', 'TRANSPORT', 'BANK', 'AGE', 'DRIVING_LICENSE'
];

const BANK_OPTIONS = ['EUROBANK', 'ALPHABANK', 'PIRAEUS BANK', 'NATIONALBANK'];
// Transport question shows friendly labels; codes are mapped when saving to sheet
const TRANSPORT_OPTIONS_EN = ['Bus', 'Own vehicle', 'Both'];
const TRANSPORT_OPTIONS_GR = ['Λεωφορείο', 'Δικό σας όχημα', 'Και τα δύο'];

// Google Maps short URL pointing to the main Newrest facilities (Athens – Building 14A)
const NEWREST_MAP_URL = 'https://maps.app.goo.gl/f5ttxdDEyoU6TBi77';

const QUESTIONS = {
  en: [
    { key: 'NAME', text: 'What is your full name?' },
    { key: 'AGE', text: 'What is your age?' },
    { key: 'ADRESS', text: 'In which area do you live?' },
    { key: 'PHONE', text: 'What is your phone number?' },
    { key: 'EMAIL', text: 'What is your email address?' },
    { key: 'BANK', text: 'Select your bank:', options: BANK_OPTIONS },
    { key: 'TRANSPORT', text: 'How will you get to work?', options: TRANSPORT_OPTIONS_EN },
    { key: 'DRIVING_LICENSE', text: 'Do you have a driving license?', options: ['Yes', 'No'] },
  ],
  gr: [
    { key: 'NAME', text: 'Ποιο είναι το πλήρες όνομά σας;' },
    { key: 'AGE', text: 'Ποια είναι η ηλικία σας;' },
    { key: 'ADRESS', text: 'Σε ποια περιοχή μένετε;' },
    { key: 'PHONE', text: 'Ποιος είναι ο αριθμός τηλεφώνου σας;' },
    { key: 'EMAIL', text: 'Ποιο είναι το email σας;' },
    { key: 'BANK', text: 'Επιλέξτε τράπεζα:', options: BANK_OPTIONS },
    { key: 'TRANSPORT', text: 'Πώς θα πηγαίνετε στη δουλειά;', options: TRANSPORT_OPTIONS_GR },
    { key: 'DRIVING_LICENSE', text: 'Έχετε δίπλωμα οδήγησης;', options: ['Ναι', 'Όχι'] },
  ]
};

export interface CandidateSession {
  lang: 'en' | 'gr';
  answers: Record<string, string>;
  step: number;
  // If the user is currently editing a specific answer, this holds the key
  editingKey?: string;
  // Flag to indicate the session is in review mode (all questions answered)
  reviewing?: boolean;
  // Flag to indicate the user is awaiting custom date input
  awaitingCustomDate?: boolean;
  // Timestamp of the last activity in the session
  lastActivity: number;
}

// Export the singleton sessions map so other parts of the bot (e.g., MessageHandler)
// can check whether a user is currently inside the Step-1 hiring flow.
export const candidateSessions: Map<number, CandidateSession> = new Map();
export const processingUsers: Set<number> = new Set(); // Track users being processed

export class CandidateStep1Flow {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;
  private sessions = candidateSessions;

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient) {
    this.bot = bot;
    this.sheets = sheets;
    this.setupHandlers();
    this.setupSessionCleanup();
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
        console.log(`[CandidateStep1Flow] Memory cleanup: Removed ${cleanedCount} expired sessions`);
      }
      
      // Log session count for monitoring
      if (this.sessions.size > 0) {
        console.log(`[CandidateStep1Flow] Active sessions: ${this.sessions.size}`);
      }
    }, 10 * 60 * 1000); // Every 10 minutes
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
      console.error('[CandidateStep1Flow] Error getting user language:', error);
      return 'en';
    }
  }

  // Helper method to check if user has "working" status
  private async getUserStatus(userId: number): Promise<{ status: string; name: string } | null> {
    try {
      const header = await this.sheets.getHeaderRow();
      const rowsRaw = await this.sheets.getRows('A3:Z1000');
      if (!rowsRaw || !rowsRaw.length) return null;
      
      const rows = rowsRaw as string[][];
      
      // Column B for user ID, find status and name columns
      const userIdCol = 1; // Column B (0-indexed = 1)
      const statusCol = header.findIndex(h => {
        const norm = h.toUpperCase().replace(/\s|_/g, '');
        return norm === 'STEP' || norm === 'STATUS';
      });
      const nameCol = header.findIndex(h => {
        const norm = h.toUpperCase().replace(/\s|_/g, '');
        return norm === 'NAME';
      });
      
      if (statusCol === -1 || nameCol === -1) return null;
      
      for (const row of rows) {
        if (!row[userIdCol]) continue;
        
        const rowUserId = parseInt(row[userIdCol] || '', 10);
        if (rowUserId === userId) {
          return {
            status: (row[statusCol] || '').trim(),
            name: (row[nameCol] || '').trim()
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('[CandidateStep1Flow] Error getting user status:', error);
      return null;
    }
  }

  private setupHandlers() {
    this.bot.onText(/\/start/, async (msg) => {
      const startTime = Date.now();
      console.log(`[CandidateStep1Flow] /start command received at ${new Date().toISOString()}`);
      
      // Only allow in private chats, not group chats
      if (msg.chat.type !== 'private') return;
      
      const userId = msg.from!.id;
      console.log(`[CandidateStep1Flow] Processing user ${userId} at ${new Date().toISOString()}`);
      
      // Check if user is already being processed
      if (processingUsers.has(userId)) {
        console.log(`[CandidateStep1Flow] User ${userId} already being processed, skipping`);
        return;
      }
      
      // Mark user as being processed
      processingUsers.add(userId);
      console.log(`[CandidateStep1Flow] User ${userId} marked as processing`);
      
      try {
        // Check if user already has "working" status
        console.log(`[CandidateStep1Flow] Checking user status at ${new Date().toISOString()}`);
        const userStatus = await this.getUserStatus(userId);
        console.log(`[CandidateStep1Flow] User status result:`, userStatus);
        
        if (userStatus && userStatus.status.toLowerCase() === 'working') {
          console.log(`[CandidateStep1Flow] User is working, showing main menu at ${new Date().toISOString()}`);
          // User is already working, show working user main menu
          const { MessageHandler } = await import('./MessageHandler');
          const { Database } = await import('../database/Database');
          const { Logger } = await import('../utils/Logger');
          const database = new Database();
          const logger = new Logger();
          const messageHandler = new MessageHandler(this.bot, database, logger);
          await messageHandler.showWorkingUserMainMenu(msg.chat.id, userId, userStatus.name);
          console.log(`[CandidateStep1Flow] Main menu sent at ${new Date().toISOString()}, total time: ${Date.now() - startTime}ms`);
          return;
        }
        
        console.log(`[CandidateStep1Flow] Starting application flow at ${new Date().toISOString()}`);
        // Clear any existing course session to prevent conflicts
        courseSessions.delete(msg.from!.id);
        
        this.sessions.set(msg.from!.id, { lang: 'en', answers: {}, step: -1, lastActivity: Date.now() });
        await this.askLanguage(msg.chat.id);
        console.log(`[CandidateStep1Flow] Language question sent at ${new Date().toISOString()}, total time: ${Date.now() - startTime}ms`);
      } catch (error) {
        console.error('[CandidateStep1Flow] Error checking user status:', error);
        // Continue with application flow if there's an error
      } finally {
        // Always remove user from processing set
        processingUsers.delete(userId);
        console.log(`[CandidateStep1Flow] User ${userId} removed from processing`);
      }
    });

    this.bot.on('callback_query', async (query) => {
      if (!query.data || !query.from) return;
      // Only allow in private chats, not group chats
      if (query.message?.chat.type !== 'private') return;
      
      const userId = query.from.id;
      if (query.data === 'lang_en' || query.data === 'lang_gr') {
        const lang = query.data === 'lang_en' ? 'en' : 'gr';
        this.sessions.set(userId, { lang, answers: {}, step: 0, lastActivity: Date.now() });
        await this.askNext(userId, query.message!.chat.id);
        await this.bot.answerCallbackQuery(query.id);
        return;
      }

      // Handle answer selections, callback data format: ans_<KEY>_<VALUE-with-underscores>
      if (query.data.startsWith('ans_')) {
        const session = this.sessions.get(userId);
        if (!session) return;

        // Guard against out-of-bounds step
        if (session.step >= QUESTIONS[session.lang].length) {
          await this.bot.answerCallbackQuery(query.id);
          return;
        }

        // Determine which question this answer belongs to
        const currentKey = session.editingKey || QUESTIONS[session.lang][session.step]!.key;

        // Expected callback prefix: ans_<KEY>_
        const expectedPrefix = `ans_${currentKey}_`;
        if (!query.data.startsWith(expectedPrefix)) return; // malformed / out-of-sync

        // Extract value part (keep underscores as stored)
        const answerValue = query.data.substring(expectedPrefix.length);

        // Save under the full question key so look-ups work (even if key contains underscores)
        session.answers[currentKey] = answerValue;

        // Handle edit mode separately
        if (session.editingKey) {
          delete session.editingKey;
          session.reviewing = true;
          await this.bot.answerCallbackQuery(query.id);
          await this.sendReview(userId, query.message!.chat.id);
          return;
        }

        // Advance to next question
        session.step++;
        await this.bot.answerCallbackQuery(query.id);
        if (session.step < QUESTIONS[session.lang].length) {
          await this.askNext(userId, query.message!.chat.id);
        } else {
          session.reviewing = true;
          await this.sendReview(userId, query.message!.chat.id);
        }
        return;
      }

      // Handle review actions
      if (query.data === 'review_confirm') {
        await this.bot.answerCallbackQuery(query.id);
        await this.saveAndFinish(userId, query.message!.chat.id);
        return;
      }

      if (query.data.startsWith('review_edit_')) {
        const key = query.data.replace('review_edit_', '');
        const session = this.sessions.get(userId);
        if (!session) return;
        session.editingKey = key;
        session.reviewing = false;
        await this.bot.answerCallbackQuery(query.id);
        await this.askEdit(userId, query.message!.chat.id, key);
        return;
      }
    });

    this.bot.on('message', async (msg) => {
      if (!msg.text || !msg.from) return;
      // Only allow in private chats, not group chats
      if (msg.chat.type !== 'private') return;
      
      const userId = msg.from.id;
      const session = this.sessions.get(userId);
      if (!session) return;
      
      // Skip if user is editing a specific answer
      if (session.editingKey) {
        await this.handleEditResponse(msg);
        return;
      }
      
      // Skip if user is in review mode
      if (session.reviewing) {
        await this.handleReviewResponse(msg);
        return;
      }
      
      // Skip if user is awaiting custom date input
      if (session.awaitingCustomDate) {
        await this.handleCustomDateResponse(msg);
        return;
      }
      
      // Handle text input for current question
      await this.handleTextResponse(msg);
    });
  }

  private async askLanguage(chatId: number) {
    await this.bot.sendMessage(chatId, 'Please select your language / Παρακαλώ επιλέξτε γλώσσα', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'English', callback_data: 'lang_en' },
            { text: 'Ελληνικά', callback_data: 'lang_gr' }
          ]
        ]
      }
    });
  }

  private async askNext(userId: number, chatId: number) {
    const session = this.sessions.get(userId)!;
    const q = QUESTIONS[session.lang][session.step];
    if (!q) return; // Guard for undefined

    if (q.options) {
      await this.bot.sendMessage(chatId, q.text, {
        reply_markup: {
          inline_keyboard: [
            // Each option as its own row
            ...q.options.map(option => [
              { text: option, callback_data: `ans_${q.key}_${option.replace(/\s/g, '_')}` }
            ])
          ]
        }
      });
    } else {
      await this.bot.sendMessage(chatId, q.text);
    }
  }

  private async saveAndFinish(userId: number, chatId: number) {
    const session = this.sessions.get(userId)!;

    // Determine the data row index BEFORE appending so we can reference it later (header is on row 2)
    const existingRows = await this.sheets.getRows('A3:A1000');
    const rowIndex = existingRows.length + 3; // 1-based index in Google Sheets

    // Fetch the header row from the sheet (assumes headers are on row 2, so range A2:2)
    const headerRow = await this.sheets.getHeaderRow();
    const normalise = (s: string) => s.replace(/\s|_/g, '').toUpperCase();

    const row = headerRow.map((headerCell) => {
      const key = normalise(headerCell);
      if (key === 'DATE') {
        return new Date().toLocaleDateString();
      }
      const mapping: Record<string, string> = {
        NAM: 'NAME',
        DRLICENCE: 'DRIVING_LICENSE',
      };
      const answerKey = mapping[key] || headerCell.toUpperCase();
      let value = session.answers[answerKey] || '';

      // Convert friendly answers to sheet codes
      if (key === 'TRANSPORT') {
        const vLower = value.toLowerCase();
        if (vLower.includes('bus') || vLower.includes('λεωφο')) value = 'MMM';
        else if (vLower.includes('own') || vLower.includes('vehicle') || vLower.includes('όχημα')) value = 'VEHICLE';
        else value = 'BOTH';
      }
      if (key === 'BANK') {
        value = value.replace(/_/g, ' ');
      }
      if (key === 'DRLICENCE') {
        const vLower = value.toLowerCase().trim();
        value = vLower.startsWith('y') || vLower.startsWith('ν') ? 'YES' : 'NO';
      }

      // Process-tracking fields
      if (key === 'STEP1') return 'done';
      if (key === 'STEP2') return 'pending';
      if (key === 'STATUS') return 'WAITING';
      if (key === 'USERID') return userId.toString();
      if (key === 'LANG' || key === 'LANGUAGE') return session.lang;

      return value;
    });

    await this.sheets.appendRow('A2', row);

    // Notify admins that a candidate is ready for step-2
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (!adminGroupId) {
      console.error('[CandidateStep1Flow] ADMIN_GROUP_ID not set - cannot notify admins');
      return;
    }
    
    console.log(`[DEBUG] Admin notification - ADMIN_GROUP_ID env: ${adminGroupId}`);
    
    const inlineBtn = { text: session.lang === 'en' ? 'Start evaluation' : 'Ξεκινήστε αξιολόγηση', callback_data: `step2_${rowIndex}` };
    const notifyText = session.lang === 'en'
      ? `🆕 Candidate ready for Step-2: ${session.answers['NAME'] || ''}`
      : `🆕 Υποψήφιος για Βήμα-2: ${session.answers['NAME'] || ''}`;
    
    console.log(`[DEBUG] Admin notification - sending to admin group: ${adminGroupId}`);
    console.log(`[DEBUG] Admin notification - text: ${notifyText}`);
    
    try {
      // First, let's try to get chat info to verify the group exists
      const chatId = parseInt(adminGroupId, 10);
      console.log(`[DEBUG] Attempting to get chat info for group ID: ${chatId}`);
      
      try {
        const chatInfo = await this.bot.getChat(chatId);
        console.log(`[DEBUG] Chat info retrieved successfully:`, {
          id: chatInfo.id,
          type: chatInfo.type,
          title: chatInfo.title || 'No title'
        });
      } catch (chatError) {
        console.error(`[DEBUG] Failed to get chat info for ${chatId}:`, chatError);
        console.error(`[DEBUG] This means the bot is not a member of the group or the group ID is incorrect`);
        return;
      }
      
      // Now try to send the message
      await this.bot.sendMessage(chatId, notifyText, { reply_markup: { inline_keyboard: [[inlineBtn]] } });
      console.log(`[DEBUG] Admin notification - sent successfully to admin group ${adminGroupId}`);
    } catch (error) { 
      console.error(`[DEBUG] Admin notification - failed to send to admin group ${adminGroupId}:`, error);
      console.error(`[DEBUG] Error details:`, {
        message: (error as any)?.message,
        code: (error as any)?.code,
        response: (error as any)?.response?.body
      });
    }

    // --- Send interview & document instructions to candidate ---
    if (session.lang === 'gr') {
      const grMsg = `Συγχαρητήρια! Περάσατε με επιτυχία το πρώτο στάδιο.\n` +
        `Στο δεύτερο στάδιο θα περάσετε από συνέντευξη με τη Newrest.\n` +
        `Για την ημέρα και ώρα της συνέντευξης θα ενημερωθείτε από έναν συνάδελφό μας.`;
      await this.bot.sendMessage(chatId, grMsg);
      await this.bot.sendMessage(chatId, '📍 Τοποθεσία Newrest', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Άνοιγμα στο Google Maps', url: NEWREST_MAP_URL }]]
        }
      });
    } else {
      const enMsg = `Congratulations! You have successfully passed the first stage.\n` +
        `In the second stage you will have an interview with Newrest.\n` +
        `You will be informed by one of our colleagues about the date and time of the interview.`;
      await this.bot.sendMessage(chatId, enMsg);
      await this.bot.sendMessage(chatId, '📍 Newrest Location', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Open in Google Maps', url: NEWREST_MAP_URL }]]
        }
      });
    }

    // Document requirements – full detailed text
    const docInstructions = session.lang === 'gr'
      ? `Έγγραφα για εργασία.\n\n` +
        `- Έγχρωμη φωτογραφία ταυτότητας μπροστά και πίσω όψη.\n\n` +
        `- Αντίγραφο ποινικού μητρώου.\n` +
        `Πληκτρολογούμε στο Google: αντίγραφο ποινικού μητρώου, επιλέγουμε το πρώτο, ακολουθούμε τα βήματα, συνδεόμαστε με τους κωδικούς taxisnet, επιλέγουμε ΝΑΙ κάτω κάτω στις μπάρες, γίνεται η αίτηση και στέλνουμε φωτογραφία το QR code.\n` +
        `Ενημερώνουμε σε κάθε περίπτωση αν δεν μπορεί να βγει το αρχείο με αυτό τον τρόπο.\n\n` +
        `- Πιστοποιητικό υγείας.\n` +
        `Εάν δεν έχουμε κάνει ποτέ ή έχουμε κάνει και έχουν περάσει πέντε χρόνια, τότε το βγάζουμε εμείς.\n\n` +
        `- Υπεύθυνη δήλωση ποινικού μητρώου.\n  Το αρχείο που σας έχει αποσταλεί, το επικυρώνουμε με Ψηφιακή βεβαίωση εγγράφου στο gov.gr (υπηρεσία: "Ψηφιακή βεβαίωση εγγράφου"). Μπορείτε να πάτε απευθείας εδώ: https://www.gov.gr/ipiresies/polites-kai-kathemerinoteta/psephiaka-eggrapha-gov-gr/psephiake-bebaiose-eggraphou\n  Πληκτρολογούμε στο Google: Ψηφιακή βεβαίωση εγγράφου, επιλέγουμε το πρώτο, ακολουθούμε τα βήματα, συνδεόμαστε, ανεβάζουμε το αρχείο στο αντίστοιχο πεδίο, επιλέγουμε υπογραφή στα ελληνικά και ολοκληρώνουμε με τον κωδικό SMS. Βγάζουμε καλή φωτογραφία το QR code και το στέλνουμε.\n\n` +
        `- ΑΦΜ, ΑΜΑ, ΑΜΚΑ και μία διεύθυνση.`
      : `Documents for work.\n\n` +
        `- Color ID photo front and back.\n\n` +
        `- Copy of criminal record.\n` +
        `We type in Google: copy of criminal record, select the first one, follow the steps, connect with the TAXISnet codes, select YES at the bottom of the bars; when the application is made please send a photo of the QR code. Please let us know in case you cannot get the file in this way.\n\n` +
        `- Health certificate.\n` +
        `If you have never done it or if you have done it but it has been five years, we will get it for you.\n\n` +
        `- Criminal record certificate.\n` +
        `The file that has been sent to you can be validated using the gov.gr service "Digital document certification". Direct link: https://www.gov.gr/en/ipiresies/polites-kai-kathemerinoteta/psephiaka-eggrapha-gov-gr/psephiake-bebaiose-eggraphou\n  Follow the steps: connect with TAXISnet, upload the file, choose signature in Greek, request SMS code, enter it and download the certified document. Then send us a clear photo of the QR code.\n\n` +
        `- AFM, AMA, AMKA and your home address.`;

    await this.bot.sendMessage(chatId, docInstructions);

    // PDF attachment
    try {
      const pdfBuffer = await this.generatePdf(docInstructions.replace(/\n/g, '\n\n'));
      const pdfName = session.lang === 'gr' ? 'Οδηγίες_Εγγράφων.pdf' : 'Document_Instructions.pdf';
      await this.bot.sendDocument(chatId, pdfBuffer, {}, { filename: pdfName, contentType: 'application/pdf' });
    } catch (_) {/* ignore */}

    // Optional declaration file (Greek pdf)
    const declPath = 'ΥΠ ΔΗΛΩΣΗ ΠΟΙΝΙΚΟΥ.pdf';
    if (fs.existsSync(declPath)) {
      try {
        await this.bot.sendDocument(chatId, fs.createReadStream(declPath), {}, { filename: 'ΥΠ_ΔΗΛΩΣΗ_ΠΟΙΝΙΚΟΥ.pdf' });
      } catch (_) { /* ignore */ }
    }

    // --- Final thank you ---
    const thankYou = session.lang === 'en'
      ? 'Thank you! Please come to the next step as instructed.'
      : 'Ευχαριστούμε! Παρακαλώ προχωρήστε στο επόμενο βήμα όπως σας ενημερώσαμε.';
    await this.bot.sendMessage(chatId, thankYou);
    this.sessions.delete(userId);
  }

  /**
   * Generate a simple PDF from provided text and return as Buffer.
   */
  private async generatePdf(text: string): Promise<Buffer> {
    const doc = new PDFDocument({ margin: 40 });
    doc.fontSize(12).text(text, { align: 'left' });
    doc.end();
    
    // Dynamic import for ES Module compatibility
    if (!getStream) {
      getStream = await import('get-stream');
    }
    
    // pdfkit emits readable stream; convert to buffer
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – .buffer exists at runtime although not in typings
    const buffer = await getStream.default.buffer(doc);
    return buffer;
  }

  /**
   * Sends a summary of all collected answers and provides inline options to
   * either confirm or edit individual fields.
   */
  private async sendReview(userId: number, chatId: number) {
    const session = this.sessions.get(userId);
    if (!session) return;

    // Friendly field labels for edit buttons
    const LABELS: Record<'en' | 'gr', Record<string, string>> = {
      en: {
        NAME: 'Full Name',
        AGE: 'Age',
        ADRESS: 'Address',
        PHONE: 'Phone',
        EMAIL: 'Email',
        BANK: 'Bank',
        TRANSPORT: 'Transport',
        DRIVING_LICENSE: 'Driving licence'
      },
      gr: {
        NAME: 'Πλήρες Όνομα',
        AGE: 'Ηλικία',
        ADRESS: 'Διεύθυνση',
        PHONE: 'Τηλέφωνο',
        EMAIL: 'Email',
        BANK: 'Τράπεζα',
        TRANSPORT: 'Μεταφορά',
        DRIVING_LICENSE: 'Δίπλωμα'
      }
    };

    const lines = QUESTIONS[session.lang].map(q => {
      const value = session.answers[q.key] || '-';
      return `• ${q.text} \n   → ${value}`;
    }).join('\n\n');

    const reviewMsg = session.lang === 'en'
      ? `Please review your information:\n\n${lines}\n\nIf everything is correct, press Confirm. Otherwise, choose the item you want to edit.`
      : `Παρακαλώ ελέγξτε τις πληροφορίες σας:\n\n${lines}\n\nΑν όλα είναι σωστά, πατήστε Επιβεβαίωση. Διαφορετικά, επιλέξτε το πεδίο που θέλετε να διορθώσετε.`;

    // Build inline keyboard: one row per field for editing + confirm at bottom
    const editButtons = QUESTIONS[session.lang].map(q => ([{ text: `✏️ ${LABELS[session.lang][q.key] || q.key}`, callback_data: `review_edit_${q.key}` }]));

    const keyboard = {
      inline_keyboard: [
        ...editButtons,
        [{ text: session.lang === 'en' ? '✅ Confirm' : '✅ Επιβεβαίωση', callback_data: 'review_confirm' }]
      ]
    } as TelegramBot.SendMessageOptions['reply_markup'];

    await this.bot.sendMessage(chatId, reviewMsg, { reply_markup: keyboard });
  }

  /**
   * Ask the user to re-enter a specific answer (editing flow).
   */
  private async askEdit(userId: number, chatId: number, key: string) {
    const session = this.sessions.get(userId);
    if (!session) return;

    const q = QUESTIONS[session.lang].find(question => question.key === key);
    if (!q) return;

    if (q.options) {
      await this.bot.sendMessage(chatId, q.text, {
        reply_markup: {
          inline_keyboard: [
            ...q.options.map(option => [
              { text: option, callback_data: `ans_${q.key}_${option.replace(/\s/g, '_')}` }
            ])
          ]
        }
      });
    } else {
      await this.bot.sendMessage(chatId, q.text);
    }
  }

  private async handleEditResponse(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const session = this.sessions.get(userId)!;
    const currentQ = QUESTIONS[session.lang][session.step];
    
    if (!currentQ) return;
    
    session.answers[currentQ.key] = msg.text!.trim();
    delete session.editingKey;
    session.reviewing = true;
    await this.sendReview(userId, msg.chat.id);
  }

  private async handleReviewResponse(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const session = this.sessions.get(userId)!;
    
    if (msg.text?.toLowerCase() === 'yes' || msg.text?.toLowerCase() === 'ναι') {
      await this.saveAndFinish(userId, msg.chat.id);
    } else if (msg.text?.toLowerCase() === 'no' || msg.text?.toLowerCase() === 'όχι') {
      session.reviewing = false;
      session.step = 0;
      await this.askNext(userId, msg.chat.id);
    }
  }

  private async handleCustomDateResponse(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const session = this.sessions.get(userId)!;
    
    session.answers['COURSEDATE'] = msg.text!.trim();
    session.awaitingCustomDate = false;
    session.reviewing = true;
    await this.sendReview(userId, msg.chat.id);
  }

  private async handleTextResponse(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const session = this.sessions.get(userId)!;
    const currentQ = QUESTIONS[session.lang][session.step];
    
    if (!currentQ) return;
    
    // Update last activity
    session.lastActivity = Date.now();
    
    session.answers[currentQ.key] = msg.text!.trim();
    session.step++;
    
    if (session.step < QUESTIONS[session.lang].length) {
      await this.askNext(userId, msg.chat.id);
    } else {
      session.reviewing = true;
      await this.sendReview(userId, msg.chat.id);
    }
  }
}