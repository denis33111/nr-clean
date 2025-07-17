import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
// @ts-ignore - pdfkit types added separately
import PDFDocument from 'pdfkit';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – get-stream default export with .buffer helper
import getStream from 'get-stream';
import fs from 'fs';

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
}

// Export the singleton sessions map so other parts of the bot (e.g., MessageHandler)
// can check whether a user is currently inside the Step-1 hiring flow.
export const candidateSessions: Map<number, CandidateSession> = new Map();

export class CandidateStep1Flow {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;
  // Re-use the shared map reference above
  private sessions = candidateSessions;

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient) {
    this.bot = bot;
    this.sheets = sheets;
    this.setupHandlers();
  }

  private setupHandlers() {
    this.bot.onText(/\/start/, async (msg) => {
      this.sessions.set(msg.from!.id, { lang: 'en', answers: {}, step: -1 });
      await this.askLanguage(msg.chat.id);
    });

    this.bot.on('callback_query', async (query) => {
      if (!query.data || !query.from) return;
      const userId = query.from.id;
      if (query.data === 'lang_en' || query.data === 'lang_gr') {
        const lang = query.data === 'lang_en' ? 'en' : 'gr';
        this.sessions.set(userId, { lang, answers: {}, step: 0 });
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
      if (!msg.from || !this.sessions.has(msg.from.id)) return;
      const session = this.sessions.get(msg.from.id)!;
      // Ignore /start and callback_query
      if (msg.text && !msg.text.startsWith('/')) {
        const currentQ = QUESTIONS[session.lang][session.step];
        if (!currentQ) return; // Guard for undefined
        session.answers[currentQ.key] = msg.text.trim();
        // If editing, go back to review directly
        if (session.editingKey) {
          delete session.editingKey;
          session.reviewing = true;
          await this.sendReview(msg.from.id, msg.chat.id);
          return;
        }

        session.step++;
        if (session.step < QUESTIONS[session.lang].length) {
          await this.askNext(msg.from.id, msg.chat.id);
        } else {
          session.reviewing = true;
          await this.sendReview(msg.from.id, msg.chat.id);
        }
      }
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
    const adminIds = (process.env.ADMIN_IDS || '')
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((n) => !isNaN(n));
    const inlineBtn = { text: session.lang === 'en' ? 'Start evaluation' : 'Ξεκινήστε αξιολόγηση', callback_data: `step2_${rowIndex}` };
    const notifyText = session.lang === 'en'
      ? `🆕 Candidate ready for Step-2: ${session.answers['NAME'] || ''}`
      : `🆕 Υποψήφιος για Βήμα-2: ${session.answers['NAME'] || ''}`;
    for (const adminId of adminIds) {
      try {
        await this.bot.sendMessage(adminId, notifyText, { reply_markup: { inline_keyboard: [[inlineBtn]] } });
      } catch (_) { /* ignore failures */ }
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
    // pdfkit emits readable stream; convert to buffer
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – .buffer exists at runtime although not in typings
    const buffer = await getStream.buffer(doc);
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
        NAME: 'Name',
        AGE: 'Age',
        ADRESS: 'Address',
        PHONE: 'Phone',
        EMAIL: 'Email',
        BANK: 'Bank',
        TRANSPORT: 'Transport',
        DRIVING_LICENSE: 'Driving licence'
      },
      gr: {
        NAME: 'Όνομα',
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
}