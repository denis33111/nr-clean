import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../../utils/GoogleSheetsClient';
import { Logger } from '../../utils/Logger';
import { SessionManager } from '../../services/SessionManager';
import { RegistrationStep } from '../../types/UserSession';
import { getMessage, getButtonText, getFieldName } from '../../utils/Messages';
import { AdminNotificationService } from '../../services/AdminNotificationService';

// Questions structure matching the old bot
const QUESTIONS = {
  en: [
    { key: 'NAME', text: 'What is your full name?' },
    { key: 'AGE', text: 'What is your age?' },
    { key: 'PHONE', text: 'What is your phone number?' },
    { key: 'EMAIL', text: 'What is your email address?' },
    { key: 'ADDRESS', text: 'In which area do you live?' },
    { key: 'TRANSPORT', text: 'How will you get to work?', options: ['MMM', 'VEHICLE', 'BOTH'] },
    { key: 'BANK', text: 'Select your bank:', options: ['EURO_BANK', 'ALPHA_BANK', 'PIRAEUS_BANK', 'NATION_ALBANK'] },
    { key: 'DRLICENCE', text: 'Do you have a driving license?', options: ['YES', 'NO'] },
  ],
  gr: [
    { key: 'NAME', text: 'Ποιο είναι το πλήρες όνομά σας;' },
    { key: 'AGE', text: 'Ποια είναι η ηλικία σας;' },
    { key: 'PHONE', text: 'Ποιος είναι ο αριθμός τηλεφώνου σας;' },
    { key: 'EMAIL', text: 'Ποιο είναι το email σας;' },
    { key: 'ADDRESS', text: 'Σε ποια περιοχή μένετε;' },
    { key: 'TRANSPORT', text: 'Πώς θα πηγαίνετε στη δουλειά;', options: ['MMM', 'VEHICLE', 'BOTH'] },
    { key: 'BANK', text: 'Επιλέξτε τράπεζα:', options: ['EURO_BANK', 'ALPHA_BANK', 'PIRAEUS_BANK', 'NATION_ALBANK'] },
    { key: 'DRLICENCE', text: 'Έχετε δίπλωμα οδήγησης;', options: ['YES', 'NO'] },
  ]
};

export class RegistrationFlow {
  private bot: TelegramBot;
  private sheetsClient: GoogleSheetsClient;
  private logger: Logger;
  private sessionManager: SessionManager;
  private adminNotificationService: AdminNotificationService;
  private callbackQueryHandler: (callbackQuery: any) => Promise<void>;
  private messageHandler: (msg: any) => Promise<void>;

  constructor(bot: TelegramBot, sheetsClient: GoogleSheetsClient, logger: Logger, adminNotificationService: AdminNotificationService) {
    this.bot = bot;
    this.sheetsClient = sheetsClient;
    this.logger = logger;
    this.sessionManager = new SessionManager();
    this.adminNotificationService = adminNotificationService;
    
    this.setupCallbacks();
  }

  private setupCallbacks(): void {
    // Store handlers so we can remove them later
    this.callbackQueryHandler = async (callbackQuery) => {
      if (!callbackQuery.data || !callbackQuery.message) return;
      
      const data = callbackQuery.data;
      const chatId = callbackQuery.message.chat.id;
      const userId = callbackQuery.from?.id;
      
      if (!userId) return;

      try {
        if (data.startsWith('lang_')) {
          await this.handleLanguageSelection(userId, chatId, data);
        } else if (data.startsWith('ans_')) {
          await this.handleAnswerSelection(userId, chatId, data);
        } else if (data.startsWith('review_edit_')) {
          await this.handleEditSelection(userId, chatId, data);
        } else if (data === 'review_confirm') {
          await this.handleConfirmRegistration(userId, chatId);
        }
        
        // Answer callback query
        await this.bot.answerCallbackQuery(callbackQuery.id);
      } catch (error) {
        this.logger.error(`Error handling callback ${data} for user ${userId}:`, error);
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Error occurred. Please try again.' });
        // Clean up session on critical errors to prevent user from getting stuck
        this.sessionManager.removeSession(userId);
      }
    };

    this.messageHandler = async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;
      
      const userId = msg.from?.id;
      const chatId = msg.chat.id;
      
      if (!userId) return;

      const session = this.sessionManager.getSession(userId);
      if (!session || session.currentStep === RegistrationStep.VALIDATION_COMPLETE) return;

      try {
        await this.handleTextInput(userId, chatId, msg.text);
      } catch (error) {
        this.logger.error(`Error handling text input for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, 'Error occurred. Please try again.');
        // Clean up session on critical errors to prevent user from getting stuck
        this.sessionManager.removeSession(userId);
      }
    };

    // Register the handlers
    this.bot.on('callback_query', this.callbackQueryHandler);
    this.bot.on('message', this.messageHandler);
  }

  async start(chatId: number, userId: number): Promise<void> {
    try {
      this.logger.info(`🚀 REGISTRATION FLOW START - User ${userId}: Starting registration flow`);
      
      // Check if user already exists in registration sheet
      const existingUser = await this.sheetsClient.getRegistrationSheet();
      const userExists = existingUser.some(row => row[1] === userId.toString());
      
      if (userExists) {
        this.logger.info(`⚠️ USER ALREADY EXISTS - User ${userId}: User already in registration process`);
        await this.bot.sendMessage(chatId, 'You are already in the registration process. Please wait for admin approval.');
        return;
      }
      
      // Create new session
      this.logger.info(`📝 SESSION CREATION - User ${userId}: Creating new session`);
      this.sessionManager.createSession(userId, chatId);
      
      // Start with language selection
      this.logger.info(`🌐 LANGUAGE SELECTION - User ${userId}: Sending language selection`);
      await this.askLanguage(chatId);
      
      this.logger.info(`✅ REGISTRATION FLOW STARTED - User ${userId}: Flow started successfully`);
    } catch (error) {
      this.logger.error(`❌ REGISTRATION FLOW ERROR - User ${userId}: Error starting flow:`, error);
      // Clean up any partial session on start error
      this.sessionManager.removeSession(userId);
      await this.bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
  }

  private async askLanguage(chatId: number): Promise<void> {
    const message = getMessage('LANGUAGE_SELECTION', 'en') + '\n\n' + getMessage('LANGUAGE_SELECTION', 'gr');
    
    // Only send inline keyboard for language selection
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: 'English', callback_data: 'lang_en' },
          { text: 'Ελληνικά', callback_data: 'lang_gr' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, message, { reply_markup: inlineKeyboard });
  }

  private async handleLanguageSelection(userId: number, chatId: number, data: string): Promise<void> {
    const language = data === 'lang_en' ? 'en' : 'gr';
    
    this.logger.info(`🌐 LANGUAGE SELECTED - User ${userId}: Selected language: ${language}, callback_data: "${data}"`);
    
    // Update session
    this.logger.info(`📝 SESSION UPDATE - User ${userId}: Updating session with language: ${language}, step: NAME_INPUT`);
    this.sessionManager.updateSession(userId, { language, currentStep: RegistrationStep.NAME_INPUT, step: 0 });
    
    // Ask for name
    this.logger.info(`❓ ASKING NEXT QUESTION - User ${userId}: Moving to askNext with language: ${language}`);
    await this.askNext(userId, chatId, language);
  }

  private async handleAnswerSelection(userId: number, chatId: number, data: string): Promise<void> {
    const session = this.sessionManager.getSession(userId);
    if (!session) return;

    this.logger.info(`🎯 ANSWER RECEIVED - User ${userId}: Received callback_data: "${data}"`);
    this.logger.info(`📊 SESSION STATE - User ${userId}: Current step: ${session.step}, Language: ${session.language}`);

    // Parse answer data: ans_<KEY>_<VALUE>
    // Handle underscores in question keys properly
    const parts = data.split('_');
    if (parts.length < 3) {
      this.logger.error(`❌ INVALID CALLBACK FORMAT - User ${userId}: Parts length ${parts.length}, data: "${data}"`);
      return;
    }
    
    // Find the question key by looking for known question keys
    let key: string;
    let value: string;
    
    // Check if the first part after 'ans' is a complete question key
    if (parts[1] === 'DRLICENCE') {
      key = 'DRLICENCE';
      value = parts.slice(2).join('_');
    } else if (parts[1] === 'TRANSPORT') {
      key = 'TRANSPORT';
      value = parts.slice(2).join('_');
    } else if (parts[1] === 'BANK') {
      key = 'BANK';
      value = parts.slice(2).join('_');
    } else {
      // Fallback to old logic for simple keys
      key = parts[1] || '';
      value = parts.slice(2).join('_');
    }
    
    if (!key) {
      this.logger.error(`❌ MISSING KEY - User ${userId}: No key found in parts: ${JSON.stringify(parts)}`);
      return;
    }
    
    this.logger.info(`🔍 PARSED ANSWER - User ${userId}: Key: "${key}", Value: "${value}", Parts: ${JSON.stringify(parts)}`);
    
    // Debug logging for driving license
    if (key === 'DRLICENCE') {
      this.logger.info(`🚗 DRIVING LICENSE DEBUG - User ${userId}: callback_data="${data}", parsed_key="${key}", parsed_value="${value}"`);
    }
    
    // Save answer using centralized method
    this.logger.info(`💾 SAVING ANSWER - User ${userId}: Saving ${key} = "${value}"`);
    this.updateUserDataField(session, key, value);
    
    this.logger.info(`📈 STEP INCREMENT - User ${userId}: Step ${session.step} → ${session.step + 1}`);
    session.step++;
    
    this.logger.info(`🔄 NEXT STEP LOGIC - User ${userId}: Current step ${session.step}, Total questions: ${QUESTIONS[session.language].length}`);
    
    if (session.step < QUESTIONS[session.language].length) {
      this.logger.info(`➡️ MORE QUESTIONS - User ${userId}: Moving to next question`);
      await this.askNext(userId, chatId, session.language);
    } else {
      this.logger.info(`🏁 ALL QUESTIONS DONE - User ${userId}: Moving to review mode`);
      session.reviewing = true;
      await this.sendReview(userId, chatId, session.language);
    }
  }

  private async handleTextInput(userId: number, chatId: number, text: string): Promise<void> {
    const session = this.sessionManager.getSession(userId);
    if (!session) return;
    
    this.logger.info(`📝 TEXT INPUT RECEIVED - User ${userId}: Text: "${text}", Current step: ${session.step}, Editing: ${session.editingKey || 'NO'}, Reviewing: ${session.reviewing}`);

    // Skip if user is editing a specific answer
    if (session.editingKey) {
      await this.handleEditResponse(userId, chatId, text, session.language);
      return;
    }

    // Skip if user is in review mode
    if (session.reviewing) {
      return; // Review mode handled by callback queries
    }

    // Regular question flow
    if (session.step < QUESTIONS[session.language].length) {
      const question = QUESTIONS[session.language][session.step];
      if (question && !question.options) {
        // Text question - save answer and move to next
        this.logger.info(`💾 SAVING TEXT INPUT - User ${userId}: Question: "${question.key}", Text: "${text.trim()}"`);
        this.updateUserDataField(session, question.key, text.trim());
        
        this.logger.info(`📈 TEXT INPUT STEP INCREMENT - User ${userId}: Step ${session.step} → ${session.step + 1}`);
        session.step++;
        
        this.logger.info(`🔄 TEXT INPUT NEXT STEP LOGIC - User ${userId}: Current step ${session.step}, Total questions: ${QUESTIONS[session.language].length}`);
        
        if (session.step < QUESTIONS[session.language].length) {
          this.logger.info(`➡️ TEXT INPUT MORE QUESTIONS - User ${userId}: Moving to next question`);
          await this.askNext(userId, chatId, session.language);
        } else {
          this.logger.info(`🏁 TEXT INPUT ALL QUESTIONS DONE - User ${userId}: Moving to review mode`);
          session.reviewing = true;
          await this.sendReview(userId, chatId, session.language);
        }
      }
    }
  }

  private async askNext(userId: number, chatId: number, language: 'en' | 'gr'): Promise<void> {
    const session = this.sessionManager.getSession(userId);
    if (!session) return;
    
    const question = QUESTIONS[language][session.step];
    if (!question) return;
    
    this.logger.info(`❓ ASKING QUESTION - User ${userId}: Step ${session.step}, Question: "${question.key}" - "${question.text}"`);
    this.logger.info(`📊 QUESTION DETAILS - User ${userId}: Has options: ${question.options ? 'YES' : 'NO'}, Options: ${question.options?.join(', ') || 'N/A'}`);

    if (question.options) {
      // Create a better layout for options
      let keyboard;
      
      if (question.key === 'TRANSPORT') {
        // Transport: 3 options in one row
        keyboard = {
          inline_keyboard: [
            question.options.map(option => ({
              text: getButtonText(option, language),
              callback_data: `ans_${question.key}_${option}`
            }))
          ]
        };
      } else if (question.key === 'BANK') {
        // Bank: 4 options in 2 rows of 2 (always in English)
        keyboard = {
          inline_keyboard: [
            [
              { text: question.options[0] || '', callback_data: `ans_${question.key}_${question.options[0] || ''}` },
              { text: question.options[1] || '', callback_data: `ans_${question.key}_${question.options[1] || ''}` }
            ],
            [
              { text: question.options[2] || '', callback_data: `ans_${question.key}_${question.options[2] || ''}` },
              { text: question.options[3] || '', callback_data: `ans_${question.key}_${question.options[3] || ''}` }
            ]
          ]
        };
      } else if (question.key === 'DRLICENCE') {
        // Driving license: 2 options side by side
        keyboard = {
          inline_keyboard: [
            [
              { text: getButtonText(question.options[0] || '', language), callback_data: `ans_${question.key}_${question.options[0] || ''}` },
              { text: getButtonText(question.options[1] || '', language), callback_data: `ans_${question.key}_${question.options[1] || ''}` }
            ]
          ]
        };
      } else {
        // Default: one option per row for better readability
        keyboard = {
          inline_keyboard: [
            ...question.options.map(option => [{
              text: getButtonText(option, language),
              callback_data: `ans_${question.key}_${option}`
            }])
          ]
        };
      }
      
      await this.bot.sendMessage(chatId, question.text, { reply_markup: keyboard });
    } else {
      await this.bot.sendMessage(chatId, question.text);
    }
  }

  private async sendReview(userId: number, chatId: number, language: 'en' | 'gr'): Promise<void> {
    const session = this.sessionManager.getSession(userId);
    if (!session) return;

    // Create clean inline edit layout - each field is clickable with localized field names
    const reviewLines = QUESTIONS[language].map(q => {
      // Map question keys to actual session field names
      let fieldKey: keyof typeof session.userData;
      switch (q.key) {
        case 'NAME': fieldKey = 'name'; break;
        case 'AGE': fieldKey = 'age'; break;
        case 'PHONE': fieldKey = 'phone'; break;
        case 'EMAIL': fieldKey = 'email'; break;
        case 'ADDRESS': fieldKey = 'address'; break;
        case 'TRANSPORT': fieldKey = 'transport'; break;
        case 'BANK': fieldKey = 'bank'; break;
        case 'DRLICENCE': fieldKey = 'drLicence'; break;
        default: fieldKey = 'name'; // fallback
      }
      
      const value = session.userData[fieldKey] || '-';
      const localizedFieldName = getFieldName(q.key, language);
      
      // Debug logging for driving license
      if (q.key === 'DRLICENCE') {
        this.logger.info(`DRIVING LICENSE REVIEW - User ${userId}: fieldKey="${fieldKey}", value="${value}", session.drLicence="${session.userData.drLicence}"`);
      }
      
      return `✏️ ${localizedFieldName}: ${value}`;
    });

    const reviewMsg = language === 'en'
      ? `📋 Review Your Information:\n\n${reviewLines.join('\n')}\n\n${getMessage('REVIEW_CLICK_TO_EDIT', language)}`
      : `📋 Επιθεώρηση Πληροφοριών:\n\n${reviewLines.join('\n')}\n\n${getMessage('REVIEW_CLICK_TO_EDIT', language)}`;

    // Create inline keyboard with edit buttons for each field and confirm button
    const editButtons = QUESTIONS[language].map(q => ([
      { text: `✏️ ${getFieldName(q.key, language)}`, callback_data: `review_edit_${q.key}` }
    ]));

    const keyboard = {
      inline_keyboard: [
        ...editButtons,
        [{ text: getMessage('CONFIRM_REGISTRATION', language), callback_data: 'review_confirm' }]
      ]
    };

    await this.bot.sendMessage(chatId, reviewMsg, { reply_markup: keyboard });
  }

  private async handleEditSelection(userId: number, chatId: number, data: string): Promise<void> {
    const session = this.sessionManager.getSession(userId);
    if (!session) return;

    const key = data.replace('review_edit_', '');
    const question = QUESTIONS[session.language].find(q => q.key === key);
    
    if (!question) return;

    // Set editing state
    session.editingKey = key;
    session.reviewing = false;
    
    // Send edit header message with proper language support
    const editHeader = `${getMessage('EDITING_HEADER', session.language)} ${question.text}`;
    
    // Ask the question again with improved layout
    if (question.options) {
      let keyboard;
      
      if (question.key === 'TRANSPORT') {
        // Transport: 3 options in one row
        keyboard = {
          inline_keyboard: [
            question.options.map(option => ({
              text: getButtonText(option, session.language),
              callback_data: `ans_${question.key}_${option}`
            }))
          ]
        };
      } else if (question.key === 'BANK') {
        // Bank: 4 options in 2 rows of 2 (always in English)
        keyboard = {
          inline_keyboard: [
            [
              { text: question.options[0] || '', callback_data: `ans_${question.key}_${question.options[0] || ''}` },
              { text: question.options[1] || '', callback_data: `ans_${question.key}_${question.options[1] || ''}` }
            ],
            [
              { text: question.options[2] || '', callback_data: `ans_${question.key}_${question.options[2] || ''}` },
              { text: question.options[3] || '', callback_data: `ans_${question.key}_${question.options[3] || ''}` }
            ]
          ]
        };
      } else if (question.key === 'DRLICENCE') {
        // Driving license: 2 options side by side
        this.logger.info(`DRIVING LICENSE QUESTION - User ${userId}: Asking driving license question, options: ${question.options?.join(', ')}`);
        keyboard = {
          inline_keyboard: [
            [
              { text: getButtonText(question.options[0] || '', session.language), callback_data: `ans_${question.key}_${question.options[0] || ''}` },
              { text: getButtonText(question.options[1] || '', session.language), callback_data: `ans_${question.key}_${question.options[1] || ''}` }
            ]
          ]
        };
      } else {
        // Default: one option per row
        keyboard = {
          inline_keyboard: [
            ...question.options.map(option => [{
              text: getButtonText(option, session.language),
              callback_data: `ans_${question.key}_${option}`
            }])
          ]
        };
      }
      
      await this.bot.sendMessage(chatId, editHeader, { reply_markup: keyboard });
    } else {
      await this.bot.sendMessage(chatId, editHeader);
    }
  }

  private async handleEditResponse(userId: number, chatId: number, text: string, language: 'en' | 'gr'): Promise<void> {
    const session = this.sessionManager.getSession(userId);
    if (!session || !session.editingKey) return;
    
    const editingKey = session.editingKey;
    const q = QUESTIONS[language].find(question => question.key === editingKey);
    
    if (!q) return;
    
    // Update the answer using centralized method
    this.updateUserDataField(session, editingKey, text.trim());
    
    // Clear editing state and return to review
    delete session.editingKey;
    session.reviewing = true;
    
    // Send confirmation and return to review
    const confirmMsg = getMessage('FIELD_UPDATED', language);
    
    await this.bot.sendMessage(chatId, confirmMsg);
    await this.sendReview(userId, chatId, language);
  }

  private async handleConfirmRegistration(userId: number, chatId: number): Promise<void> {
    const session = this.sessionManager.getSession(userId);
    if (!session) return;

    try {
      // Save to Google Sheets and get the row number
      const values = [
        session.language, // Column A - LANGUAGE
        userId.toString(), // Column B - USER_ID
        new Date().toLocaleDateString(), // Column C - DATE
        session.userData.name, // Column D - NAME
        session.userData.age, // Column E - AGE
        session.userData.phone, // Column F - PHONE
        session.userData.email, // Column G - EMAIL
        session.userData.address, // Column H - ADDRESS
        session.userData.transport, // Column I - TRANSPORT
        session.userData.bank, // Column J - BANK
        session.userData.drLicence, // Column K - DR LICENCE
        '', // Column L - CRIMINAL RECORD (empty for now)
        '', // Column M - HEALTH_CERT
        '', // Column N - AMKA
        '', // Column O - AMA
        '', // Column P - AFM
        'WAITING', // Column Q - STATUS (CORRECT!)
        '', // Column R - COURSE_DATE
      ];

      // Step 1: Save to registration sheet first (most critical)
      const rowIndex = await this.sheetsClient.appendToRegistrationSheet(values);
      this.logger.info(`User ${userId} saved to registration sheet at row ${rowIndex}`);
      
      // Step 2: Add to workers sheet (secondary)
      try {
        await this.sheetsClient.addToWorkersSheet(
          session.userData.name,
          userId,
          'WAITING', // Initial status - will become "WORKING" when user confirms course attendance
          session.language
        );
        this.logger.info(`User ${userId} added to WORKERS sheet with status WAITING`);
      } catch (workersError) {
        this.logger.error(`Failed to add user ${userId} to WORKERS sheet:`, workersError);
        // Registration is still successful even if workers sheet fails
      }
      
      // Step 3: Update session state
      this.sessionManager.updateSession(userId, { currentStep: RegistrationStep.VALIDATION_COMPLETE });
      
      // Step 4: Send admin notification (non-critical)
      try {
        await this.adminNotificationService.notifyAdminsOfNewCandidate(
          session.userData.name,
          userId,
          session.language,
          rowIndex
        );
        this.logger.info(`Admin notification sent for user ${userId} at row ${rowIndex}`);
      } catch (adminError) {
        this.logger.error(`Failed to send admin notification for user ${userId}:`, adminError);
        // Registration is still successful even if notification fails
      }
      
      // Send success message
      const successMessage = getMessage('SAVE_SUCCESS', session.language);
      await this.bot.sendMessage(chatId, successMessage);
      
      // --- Send interview & document instructions to candidate ---
      if (session.language === 'gr') {
        const grMsg = `Συγχαρητήρια! Περάσατε με επιτυχία το πρώτο στάδιο.\n` +
          `Στο δεύτερο στάδιο θα περάσετε από συνέντευξη με τη Newrest.\n` +
          `Για την ημέρα και ώρα της συνέντευξης θα ενημερωθείτε από έναν συνάδελφό μας.`;
        await this.bot.sendMessage(chatId, grMsg);
        await this.bot.sendMessage(chatId, '📍 Τοποθεσία Newrest', {
          reply_markup: {
            inline_keyboard: [[{ text: 'Άνοιγμα στο Google Maps', url: 'https://maps.app.goo.gl/f5ttxdDEyoU6TBi77' }]]
          }
        });
      } else {
        const enMsg = `Congratulations! You have successfully passed the first stage.\n` +
          `In the second stage you will have an interview with Newrest.\n` +
          `You will be informed by one of our colleagues about the date and time of the interview.`;
        await this.bot.sendMessage(chatId, enMsg);
        await this.bot.sendMessage(chatId, '📍 Newrest Location', {
          reply_markup: {
            inline_keyboard: [[{ text: 'Open in Google Maps', url: 'https://maps.app.goo.gl/f5ttxdDEyoU6TBi77' }]]
          }
        });
      }

      // Document requirements – full detailed text
      const docInstructions = session.language === 'gr'
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



      // Criminal record declaration file (Greek pdf)
      const declPath = 'ΥΠ_ΔΗΛΩΣΗ_ΠΟΙΝΙΚΟΥ (1).pdf';
      if (require('fs').existsSync(declPath)) {
        try {
          await this.bot.sendDocument(chatId, require('fs').createReadStream(declPath), {}, { filename: 'ΥΠ_ΔΗΛΩΣΗ_ΠΟΙΝΙΚΟΥ.pdf' });
          this.logger.info(`Criminal record PDF sent to user ${userId}`);
        } catch (error) { 
          this.logger.error(`Failed to send criminal record PDF to user ${userId}:`, error);
        }
      } else {
        this.logger.warn(`Criminal record PDF file not found at path: ${declPath}`);
      }

      // --- Final thank you ---
      const thankYou = session.language === 'en'
        ? 'Thank you! Please come to the next step as instructed.'
        : 'Ευχαριστούμε! Παρακαλώ προχωρήστε στο επόμενο βήμα όπως σας ενημερώσαμε.';
      await this.bot.sendMessage(chatId, thankYou);
      
      // Clean up session
      this.sessionManager.removeSession(userId);
      
      this.logger.info(`User ${userId} completed registration successfully`);
      
    } catch (error) {
      this.logger.error(`Error saving registration for user ${userId}:`, error);
      // Clean up session on error to prevent user from getting stuck
      this.sessionManager.removeSession(userId);
      await this.bot.sendMessage(chatId, 'Error saving registration. Please try again.');
    }
  }

  /**
   * Clean up event listeners to prevent memory leaks
   */
  public cleanup(): void {
    if (this.callbackQueryHandler) {
      this.bot.removeListener('callback_query', this.callbackQueryHandler);
    }
    if (this.messageHandler) {
      this.bot.removeListener('message', this.messageHandler);
    }
    this.logger.info('RegistrationFlow: Event listeners cleaned up');
  }

  /**
   * Clean up old sessions to prevent memory buildup
   */
  public cleanupOldSessions(maxAgeHours: number = 24): void {
    this.sessionManager.cleanupOldSessions(maxAgeHours);
  }

  /**
   * Update user data field - centralized method to avoid duplication
   */
  private updateUserDataField(session: any, key: string, value: string): void {
    const fieldMap: { [key: string]: keyof typeof session.userData } = {
      'NAME': 'name',
      'AGE': 'age', 
      'PHONE': 'phone',
      'EMAIL': 'email',
      'ADDRESS': 'address',
      'TRANSPORT': 'transport',
      'BANK': 'bank',
      'DRLICENCE': 'drLicence'
    };

    const fieldName = fieldMap[key];
    if (fieldName && session.userData[fieldName] !== undefined) {
      // Type-safe assignment with proper casting
      if (key === 'TRANSPORT') {
        session.userData[fieldName] = value as 'MMM' | 'VEHICLE' | 'BOTH';
      } else if (key === 'BANK') {
        session.userData[fieldName] = value as 'EURO_BANK' | 'ALPHA_BANK' | 'PIRAEUS_BANK' | 'NATION_ALBANK';
      } else if (key === 'DRLICENCE') {
        session.userData[fieldName] = value as 'YES' | 'NO';
      } else {
        session.userData[fieldName] = value;
      }
      this.logger.info(`✅ SAVED ${key} - User ${session.userId}: "${value}"`);
    } else {
      this.logger.warn(`⚠️ UNKNOWN FIELD - User ${session.userId}: Unknown field "${key}" with value "${value}"`);
    }
  }

}
