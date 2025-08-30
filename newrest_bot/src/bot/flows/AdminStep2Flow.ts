import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../../utils/GoogleSheetsClient';
import { AdminService, AdminSession } from '../../services/AdminService';
import { Logger } from '../../utils/Logger';

const POSITION_OPTIONS = ['HL', 'Supervisor', 'EQ'];

const QUESTIONS_BASE = [
  { key: 'AGREED', text: 'Να συνεχίσουμε με τον υποψήφιο;', options: ['Ναι', 'Όχι'] },
  { key: 'POSITION', text: 'Θέση;', options: POSITION_OPTIONS },
  // COURSE_DATE will be asked with preset buttons after position
  { key: 'NOTES', text: 'Σημειώσεις; (προαιρετικά, "-" για παράλειψη)' }
];

export class AdminStep2Flow {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;
  private adminService: AdminService;
  private logger: Logger;
  private sessions = new Map<number, AdminSession>();

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient, logger: Logger) {
    this.bot = bot;
    this.sheets = sheets;
    this.adminService = new AdminService();
    this.logger = logger;
    
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
        this.logger.info(`[AdminStep2Flow] Memory cleanup: Removed ${cleanedCount} expired sessions`);
      }
      
      // Log session count for monitoring
      if (this.sessions.size > 0) {
        this.logger.info(`[AdminStep2Flow] Active sessions: ${this.sessions.size}`);
      }
    }, 10 * 60 * 1000); // Every 10 minutes
  }

  // Handle /pending2 command to show candidates waiting for Step 2
  public async handlePending2Command(msg: TelegramBot.Message): Promise<void> {
    if (!msg.from) return;
    
    // Only allow in group chats, not private chats
    if (msg.chat.type === 'private') return;
    
    // Check if user is admin
    const isAdmin = await this.adminService.isAdmin(msg.from.id, msg.chat.id, this.bot);
    if (!isAdmin) {
      this.logger.warn(`User ${msg.from.id} attempted to use admin command but is not admin`);
      return;
    }

    try {
      const header = await this.sheets.getHeaderRow();
      const dataRows = await this.sheets.getRows('A3:T1000');
      const rows: any[] = dataRows || [];
      
      const colStatus = header.findIndex((h: string) => h.toUpperCase().replace(/\s/g, '') === 'STATUS');
      const colName = header.findIndex((h: string) => h.toUpperCase().replace(/\s/g, '') === 'NAME');
      
      if (colStatus === -1 || colName === -1) {
        await this.bot.sendMessage(msg.chat.id, '❌ Error: Required columns not found in sheet.');
        return;
      }

      const pendingRows = rows
        .map((r, idx) => ({ r, idx }))
        .filter(({ r }) => r[colStatus] === 'WAITING');

      if (pendingRows.length === 0) {
        await this.bot.sendMessage(msg.chat.id, '✅ No candidates waiting for Step-2.');
        return;
      }

      const keyboardRows = pendingRows.map(({ r, idx }) => [{
        text: `${r[colName] || 'Unnamed'} (row ${idx + 3})`,
        callback_data: `step2_${idx + 3}`
      }]);

      await this.bot.sendMessage(msg.chat.id, 'Pending Step-2 candidates:', {
        reply_markup: { inline_keyboard: keyboardRows }
      });

    } catch (error) {
      this.logger.error('[AdminStep2Flow] Error handling pending2 command:', error);
      await this.bot.sendMessage(msg.chat.id, '❌ Error loading pending candidates.');
    }
  }

  // Handle step2 callback from admin
  public async handleStep2Callback(query: TelegramBot.CallbackQuery): Promise<void> {
    if (!query.from || !query.message) return;
    
    try {
      const parts = query.data!.split('_');
      if (parts.length < 2) return;
      
      const rowStr = parts[1];
      if (!rowStr) return;
      
      const row = parseInt(rowStr, 10);
      if (isNaN(row)) return;

      // Check if user is admin
      const isAdmin = await this.adminService.isAdmin(query.from.id, query.message.chat.id, this.bot);
      if (!isAdmin) {
        this.logger.warn(`User ${query.from.id} attempted to use admin callback but is not admin`);
        return;
      }

      // Get candidate data from the pending candidates list
      const header = await this.sheets.getHeaderRow();
      const dataRows = await this.sheets.getRows('A3:T1000');
      const rows: any[] = dataRows || [];
      
      const colName = header.findIndex((h: string) => h.toUpperCase().replace(/\s/g, '') === 'NAME');
      const colUserId = header.findIndex((h: string) => h.toUpperCase().replace(/\s/g, '') === 'USERID');
      const colLang = header.findIndex((h: string) => h.toUpperCase().replace(/\s/g, '') === 'LANGUAGE');
      const colStatus = header.findIndex((h: string) => h.toUpperCase().replace(/\s/g, '') === 'STATUS');
      const colCourseDate = header.findIndex((h: string) => h.toUpperCase().replace(/\s/g, '') === 'COURSE_DATE');
      
      // Find the specific row data
      const rowData = rows[row - 3]; // Convert sheet row to array index
      if (!rowData) {
        this.logger.error(`[AdminStep2Flow] Could not find data for row ${row}`);
        await this.bot.answerCallbackQuery(query.id, { text: '❌ Error: Could not find candidate data.' });
        return;
      }
      
      // Check if candidate is still pending (not already evaluated)
      if (colStatus !== -1 && colCourseDate !== -1) {
        const currentStatus = rowData[colStatus];
        const currentCourseDate = rowData[colCourseDate];
        
        if (currentStatus && currentStatus !== 'pending' && currentCourseDate && currentCourseDate.trim() !== '') {
          await this.bot.answerCallbackQuery(query.id, { text: '❌ This candidate has already been evaluated and has a course date.' });
          this.logger.warn(`[AdminStep2Flow] Admin ${query.from.id} attempted to evaluate already processed candidate at row ${row}`);
          return;
        }
      }

      // Create admin session with candidate data
      this.sessions.set(query.from.id, { 
        row, 
        step: 0, 
        answers: {}, 
        lastActivity: Date.now(),
        candidateName: rowData[colName] || 'Unknown',
        candidateUserId: colUserId !== -1 ? parseInt(rowData[colUserId] as string, 10) : undefined,
        candidateLanguage: colLang !== -1 ? (rowData[colLang] || 'en').toLowerCase() : 'en'
      });

      await this.bot.answerCallbackQuery(query.id);
      
      // Start the evaluation process
      await this.handleNextStep(query.from.id, query.message.chat.id);

    } catch (error) {
      this.logger.error('[AdminStep2Flow] Error handling step2 callback:', error);
      if (query.message) {
        await this.bot.answerCallbackQuery(query.id, { text: '❌ Error processing request.' });
      }
    }
  }

  // Handle next step in admin evaluation
  private async handleNextStep(userId: number, chatId: number): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session) return;

    // Update last activity
    session.lastActivity = Date.now();

    // If admin disagreed, immediately save and finish (reject candidate)
    if (session.agreed === false) {
      this.logger.info(`[AdminStep2Flow] Admin ${userId} disagreed, immediately rejecting candidate`);
      await this.saveAndFinish(userId, chatId);
      return;
    }

    // Step 0: AGREED, Step 1: POSITION, Step 2: COURSE_DATE (preset)
    if (session.step === 2 && session.agreed === true) {
      // Ask course date with preset options
      await this.askCourseDate(userId, chatId);
    } else if (session.step >= 3) {
      // All questions answered, save and finish
      await this.saveAndFinish(userId, chatId);
      return;
    } else {
      // Ask next question
      await this.askNext(userId, chatId);
    }
  }

  // Ask the next question to admin
  private async askNext(userId: number, chatId: number): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session) return;

    const question = QUESTIONS_BASE[session.step];
    if (!question) return;

    if (question.options) {
      const buttons = question.options.map((option: string) => {
        // For AGREED question translate labels but keep EN callback values
        if (question.key === 'AGREED') {
          const cb = option.toLowerCase().startsWith('ν') ? 'Yes' : option.toLowerCase().startsWith('ό') ? 'No' : option;
          return [{ text: option, callback_data: `a2_${cb}` }];
        }
        return [{ text: option, callback_data: `a2_${option}` }];
      });

      await this.bot.sendMessage(chatId, question.text, {
        reply_markup: { inline_keyboard: buttons },
      });
    } else {
      await this.bot.sendMessage(chatId, question.text);
    }
  }

  // Ask course date with preset options
  private async askCourseDate(userId: number, chatId: number): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session) return;

    const position = session.position || 'HL';
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

  // Helper method to calculate next date for specific day of week
  private getNextDateForDay(from: Date, targetDay: number): Date {
    const result = new Date(from);
    const currentDay = result.getDay();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7; // next week if today is same day or later
    result.setDate(result.getDate() + daysToAdd);
    return result;
  }



  // Handle admin answer callbacks
  public async handleAnswerCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    if (!query.from || !query.message) return;
    
    try {
      const parts = query.data!.split('_');
      if (parts.length < 2) return;
      
      const value = parts[1];
      if (!value) return;
      
      const session = this.sessions.get(query.from.id);
      
      if (!session) return;

      // Update last activity
      session.lastActivity = Date.now();

      const question = QUESTIONS_BASE[session.step];
      if (question) {
        const k = question.key.replace(/\s|_/g, '').toUpperCase();
        session.answers[k] = value;
        
        if (k === 'AGREED') session.agreed = /yes/i.test(value);
        if (k === 'POSITION') session.position = value;
        
        session.step++;
        
        this.logger.info(`[AdminStep2Flow] Updated session for user ${query.from.id}: step=${session.step}, agreed=${session.agreed}`);
      }

      await this.bot.answerCallbackQuery(query.id);
      await this.handleNextStep(query.from.id, query.message.chat.id);

    } catch (error) {
      this.logger.error('[AdminStep2Flow] Error handling answer callback:', error);
      if (query.message) {
        await this.bot.answerCallbackQuery(query.id, { text: '❌ Error processing answer.' });
      }
    }
  }

  // Handle course date callbacks
  public async handleCourseDateCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    if (!query.from || !query.message) return;
    
    try {
      const parts = query.data!.split('_');
      if (parts.length < 2) return;
      
      const dateValue = parts[1];
      if (!dateValue) return;
      
      const session = this.sessions.get(query.from.id);
      if (!session) return;

      // Update last activity
      session.lastActivity = Date.now();

      if (dateValue === 'custom') {
        // Admin wants to enter custom date
        session.awaitingCustomDate = true;
        await this.bot.sendMessage(query.message.chat.id, 'Please enter the custom date (YYYY-MM-DD format):');
      } else {
        // Preset date selected
        session.answers['COURSE_DATE'] = dateValue;
        session.step++;
        
        this.logger.info(`[AdminStep2Flow] Course date selected for user ${query.from.id}: ${dateValue}`);
        
        // AUTO-POPULATE REMINDER COLUMNS IMMEDIATELY FOR PRESET DATES TOO
        try {
          const header = await this.sheets.getHeaderRow();
          const preReminderCol = header.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'PRE_COURSE_REMINDER');
          const dayReminderCol = header.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'DAY_COURSE_REMINDER');
          
                      if (preReminderCol !== -1 && dayReminderCol !== -1) {
              // Find the candidate's row
              const dataRows = await this.sheets.getRows('A3:T1000');
              const rows: any[] = dataRows || [];
              const userIdCol = header.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'USERID');
            
            if (userIdCol !== -1) {
              // Get the candidate's user ID from the session, not the admin's
              const candidateUserId = session.candidateUserId;
              const candidateRowIndex = rows.findIndex(row => row[userIdCol] === candidateUserId?.toString());
              
              if (candidateRowIndex !== -1) {
                const actualRowNumber = candidateRowIndex + 3;
                
                // Calculate reminder dates
                const courseDateObj = new Date(dateValue);
                const dayBefore = new Date(courseDateObj);
                dayBefore.setDate(dayBefore.getDate() - 1);
                
                const dayBeforeStr = dayBefore.toISOString().split('T')[0];
                const courseDateStr = courseDateObj.toISOString().split('T')[0];
                
                // Update PRE_COURSE_REMINDER (day before course)
                const preReminderRange = `${String.fromCharCode(65 + preReminderCol)}${actualRowNumber}`;
                if (dayBeforeStr) {
                  await this.sheets.updateCell(preReminderRange, dayBeforeStr);
                }
                
                // Update DAY_COURSE_REMINDER (day of course)
                const dayReminderRange = `${String.fromCharCode(65 + dayReminderCol)}${actualRowNumber}`;
                if (courseDateStr) {
                  await this.sheets.updateCell(dayReminderRange, courseDateStr);
                }
                
                this.logger.info(`[AdminStep2Flow] Auto-populated reminder columns for preset date: PRE_REMINDER=${dayBeforeStr}, DAY_REMINDER=${courseDateStr}`);
              }
            }
          }
        } catch (reminderError) {
          this.logger.error(`[AdminStep2Flow] Failed to populate reminder columns for preset date:`, reminderError);
          // Don't fail the whole process if reminder columns fail
        }
        
        await this.bot.answerCallbackQuery(query.id, { text: `✅ Course date set to ${dateValue}` });
        // Go directly to save and finish since we don't need notes
        await this.saveAndFinish(query.from.id, query.message.chat.id);
      }

    } catch (error) {
      this.logger.error('[AdminStep2Flow] Error handling course date callback:', error);
      if (query.message) {
        await this.bot.answerCallbackQuery(query.id, { text: '❌ Error processing course date.' });
      }
    }
  }

  // Save admin evaluation and finish
  private async saveAndFinish(userId: number, chatId: number): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session) return;

    try {
      // Normalize agreed value
      const isAgreed = session.agreed === true || session.answers['AGREED'] === 'Yes';
      
      // Use candidate data from session (no need to read from Google Sheets)
      const candidateName = session.candidateName || 'Unknown';
      const candidateUserId = session.candidateUserId;
      const language = session.candidateLanguage || 'en';
      const isGreek = language.startsWith('gr');

      if (isAgreed) {
        // Candidate approved - send congratulations message
        const courseDate = session.answers['COURSE_DATE'] || 'TBA';
        const position = session.position || 'Unknown';
        
        if (candidateUserId && !isNaN(candidateUserId)) {
          const message = isGreek 
            ? `Συγχαρητήρια ${candidateName}! Έχετε επιλεγεί για τη θέση ${position}.\nΗ εισαγωγική εκπαίδευση θα πραγματοποιηθεί ${courseDate} στις 9:50-15:00.\n\nΠαρακαλούμε υποβάλετε όλα τα απαραίτητα έγγραφα όπως συζητήσαμε νωρίτερα.\n\nΕάν χρειάζεστε βοήθεια, μη διστάσετε να επικοινωνήσετε μαζί μας.`
            : `Congratulations ${candidateName}! You have been selected for the position of ${position}.\nThe introductory training will take place on ${courseDate} at 9:50-15:00.\n\nPlease submit all necessary documents as we discussed earlier.\n\nIf you need help, don't hesitate to contact us.`;

          try {
            await this.bot.sendMessage(candidateUserId, message);
            this.logger.info(`[AdminStep2Flow] Sent congratulatory message to candidate ${candidateName} (${candidateUserId})`);
          } catch (candidateError) {
            this.logger.error(`[AdminStep2Flow] Failed to send message to candidate ${candidateUserId}:`, candidateError);
          }
        }

        // Message to admin
        await this.bot.sendMessage(chatId, `✅ Ο/Η ${candidateName} εγκρίθηκε για τη θέση ${position}. Εκπαίδευση: ${courseDate} (STATUS → WAITING)`);
      } else {
        // Candidate rejected - send rejection message
        if (candidateUserId && !isNaN(candidateUserId)) {
          const rejectionMsg = isGreek
            ? `Δυστυχώς, δεν μπορούμε να προχωρήσουμε με την αίτησή σας αυτή τη στιγμή. Σας ευχαριστούμε για το ενδιαφέρον και σας ευχόμαστε καλή συνέχεια!`
            : `Unfortunately, we cannot proceed with your application at this time. Thank you for your interest and we wish you all the best!`;

          try {
            await this.bot.sendMessage(candidateUserId, rejectionMsg);
            this.logger.info(`[AdminStep2Flow] Sent rejection message to candidate ${candidateName} (${candidateUserId})`);
          } catch (candidateError) {
            this.logger.error(`[AdminStep2Flow] Failed to send message to candidate ${candidateUserId}:`, candidateError);
          }
        }

        // Message to admin
        await this.bot.sendMessage(chatId, `❌ Ο/Η ${candidateName} δεν εγκρίθηκε. STATUS → STOP.`);
      }

      // Update Google Sheets with admin decision
      try {
        const header = await this.sheets.getHeaderRow();
        const statusCol = header.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'STATUS');
        const courseDateCol = header.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'COURSE_DATE');
        const userIdCol = header.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'USERID');
        
        if (statusCol !== -1 && courseDateCol !== -1 && userIdCol !== -1 && candidateUserId) {
          // Find the actual row by searching for the candidate's USER ID
          const dataRows = await this.sheets.getRows('A3:T1000');
          const rows: any[] = dataRows || [];
          
          // Search for the row containing this candidate's USER ID
          const candidateRowIndex = rows.findIndex(row => row[userIdCol] === candidateUserId.toString());
          
          if (candidateRowIndex !== -1) {
            // Convert to actual sheet row number (add 3 because data starts at row 3)
            const actualRowNumber = candidateRowIndex + 3;
            
            // Update STATUS
            const status = isAgreed ? 'WAITING' : 'STOP';
            const statusRange = `${String.fromCharCode(65 + statusCol)}${actualRowNumber}`;
            
            await this.sheets.updateCell(statusRange, status);
            this.logger.info(`[AdminStep2Flow] Updated STATUS to ${status} in row ${actualRowNumber} for user ${candidateUserId}`);
            
            // Update COURSE_DATE if approved
            if (isAgreed) {
              const courseDate = session.answers['COURSE_DATE'] || 'TBA';
              const courseDateRange = `${String.fromCharCode(65 + courseDateCol)}${actualRowNumber}`;
              
              await this.sheets.updateCell(courseDateRange, courseDate);
              this.logger.info(`[AdminStep2Flow] Updated COURSE_DATE to ${courseDate} in row ${actualRowNumber} for user ${candidateUserId}`);
              
              // AUTO-POPULATE REMINDER COLUMNS
              try {
                this.logger.info(`[AdminStep2Flow] Starting auto-population for course date: ${courseDate}`);
                
                // Debug: Log all header names to see what we're actually reading
                this.logger.info(`[AdminStep2Flow] All headers: ${JSON.stringify(header)}`);
                
                const preReminderCol = header.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'PRE_COURSE_REMINDER');
                const dayReminderCol = header.findIndex(h => h.toUpperCase().replace(/\s/g, '') === 'DAY_COURSE_REMINDER');
                
                this.logger.info(`[AdminStep2Flow] Found columns: PRE_REMINDER=${preReminderCol}, DAY_REMINDER=${dayReminderCol}`);
                
                if (preReminderCol !== -1 && dayReminderCol !== -1) {
                  // Calculate reminder dates
                  const courseDateObj = new Date(courseDate);
                  const dayBefore = new Date(courseDateObj);
                  dayBefore.setDate(dayBefore.getDate() - 1);
                  
                  const dayBeforeStr = dayBefore.toISOString().split('T')[0];
                  const courseDateStr = courseDateObj.toISOString().split('T')[0];
                  
                  // Update PRE_COURSE_REMINDER (day before course)
                  const preReminderRange = `${String.fromCharCode(65 + preReminderCol)}${actualRowNumber}`;
                  if (dayBeforeStr) {
                    await this.sheets.updateCell(preReminderRange, dayBeforeStr);
                  }
                  
                  // Update DAY_COURSE_REMINDER (day of course)
                  const dayReminderRange = `${String.fromCharCode(65 + dayReminderCol)}${actualRowNumber}`;
                  if (courseDateStr) {
                    await this.sheets.updateCell(dayReminderRange, courseDateStr);
                  }
                  
                  this.logger.info(`[AdminStep2Flow] Auto-populated reminder columns: PRE_REMINDER=${dayBeforeStr}, DAY_REMINDER=${courseDateStr}`);
                }
              } catch (reminderError) {
                this.logger.error(`[AdminStep2Flow] Failed to populate reminder columns:`, reminderError);
                // Don't fail the whole process if reminder columns fail
              }
            }
          } else {
            this.logger.error(`[AdminStep2Flow] Could not find row for candidate with USER ID ${candidateUserId}`);
          }
        } else {
          this.logger.error(`[AdminStep2Flow] Required columns not found: STATUS=${statusCol}, COURSE_DATE=${courseDateCol}, USERID=${userIdCol}`);
        }
      } catch (sheetsError) {
        this.logger.error(`[AdminStep2Flow] Failed to update Google Sheets:`, sheetsError);
        // Don't fail the whole process if sheets update fails
      }

      // Clear session
      this.sessions.delete(userId);

    } catch (error) {
      this.logger.error('[AdminStep2Flow] Error saving admin evaluation:', error);
      await this.bot.sendMessage(chatId, '❌ Error saving evaluation. Please try again.');
    }
  }

  // Handle text messages from admin (for custom dates only)
  public async handleMessage(msg: TelegramBot.Message): Promise<void> {
    if (!msg.text || !msg.from) return;
    
    const userId = msg.from.id;
    const session = this.sessions.get(userId);
    
    if (!session) return;
    
    this.logger.info(`[AdminStep2Flow] Processing message from admin ${userId}: "${msg.text}"`);
    
    // Update last activity
    session.lastActivity = Date.now();

    // Handle custom date input
    if (session.awaitingCustomDate) {
      const dateText = msg.text.trim();
      
      // Simple date validation (YYYY-MM-DD format)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateRegex.test(dateText)) {
        // Validate that the date is in the future
        const inputDate = new Date(dateText);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today
        
        if (inputDate <= today) {
          await this.bot.sendMessage(msg.chat.id, '❌ Course date must be in the future. Please enter a future date (YYYY-MM-DD):');
          return;
        }
        
        session.answers['COURSE_DATE'] = dateText;
        session.awaitingCustomDate = false;
        session.step++;
        
        this.logger.info(`[AdminStep2Flow] Custom course date set for user ${userId}: ${dateText}`);
        await this.bot.sendMessage(msg.chat.id, `✅ Custom course date set to ${dateText}`);
        
        // Auto-population will happen in saveAndFinish() - no need for duplicate code here
        
        // Go directly to save and finish since we don't need notes
        // This will trigger the auto-population of reminder columns
        await this.saveAndFinish(userId, msg.chat.id);
      } else {
        await this.bot.sendMessage(msg.chat.id, '❌ Invalid date format. Please use YYYY-MM-DD (e.g., 2025-08-30):');
      }
      return;
    }
  }
}
