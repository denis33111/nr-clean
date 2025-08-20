import TelegramBot from 'node-telegram-bot-api';
import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';
import { UserService } from '../services/UserService';
import { AdminService } from '../services/AdminService';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
import { candidateSessions } from './CandidateStep1Flow';
import { adminSessions } from './AdminStep2Flow';
import { courseSessions } from './CandidateCourseFlow';

// Simple contact sessions for users who want to contact crew
export const contactSessions = new Map<number, { 
  awaitingMessage: boolean;
  lastActivity: number;
}>();

// Check-in sessions for working users
export const checkInSessions = new Map<number, { 
  awaitingLocation: boolean; 
  userName: string; 
  action: string; 
  messageId?: number | undefined;
  lastActivity: number;
}>();

export class MessageHandler {
  private bot: TelegramBot;
  private database: Database;
  private logger: Logger;
  private userService: UserService;
  private adminService: AdminService;
  private sheets: GoogleSheetsClient;

  constructor(bot: TelegramBot, database: Database, logger: Logger, sheets?: GoogleSheetsClient) {
    this.bot = bot;
    this.database = database;
    this.logger = logger;
    this.userService = new UserService(database);
    this.adminService = new AdminService(database);
    
    // Use the passed GoogleSheetsClient instance or create fallback
    if (sheets) {
      this.sheets = sheets;
    } else {
      // Fallback: create new instance only if none provided
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
      
      // Create proper Google credentials object
      const googleCredentials = {
        type: "service_account",
        project_id: process.env.GOOGLE_PROJECT_ID || "newrest-465515",
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || "06ff20aa633e299bf6a881c5459aaeb07ab6cc5f",
        private_key: process.env.GOOGLE_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCqW+8DfGLahsBQ\nzfsDUJDpIaVoEtar4MfUSPtl758enm09ZGRlNk1gFxb5tugYUARMFJCKEqeEqUdN\nRNKv3kBZoT2i4PdYkWN/PqWCyRCwoX6NbC9YtHON3Or+96QgUWik/63O5DLOI6uJ\n04cJva0x7ET/Wtv7mFGEVqoJ3sM38nxolr7S6WZ8LKZkDMnj8X+XuY96m4xCQjYu\nNcGE8xadhU70IrPtE4v8o6QzQeAMVIWgMFGSnqQTamPwjD8JrEZ+vPYBP9H25JZP\n7GA6PW5GjxLT8uvEzH5JMBfe0hO5AfAIJbuFNBKOkAv5S9u7hzrDF4mjUeYQJuaD\ni94tliq9AgMBAAECggEAGdT14afvT2aGa9pH+SEyz/73l1ff8FEVy/VDFZpnnNt2\nAgyigoxg4DSwGa5n9CPR+v1VS3J3r1CBzNAmSF+hj1W5RGTrbKUjGqzTqQi2/KmI\nSIaCiWdXbEf25DGF1Ba0EOzqHIiSwZo8DRqji9EUnZDPh47t83ENz0za3MNIA8gE\nL3vLAVZhzCLgUXnBlBIxzv/gtnqViKNOj7CcSYDWFYGH1YR3Tg2tFfc81vZEKbo0\nQHBsZPD7RswGlK9bmhqqX+22pBNzvIAvaevzow08ohb75hY5gjOFtuuj1iFX/QS9\n4LQBjRwH0kF7n/xgSwKgYqJLJYOL8Brr/ON75AcWQQKBgQDdYSW7qr2xUwiNVGtW\nljunbzBJlGXLNfg60H5uHNBfzL7oXu5pc4S3cI6H8QSStP+yhiUb+JrdjA1TKouG\nW08bTHVqV132C/8vSsrBvKMztpmqoInjSMGcTTbm2MH56Okg9uEW/b1t6PFKRgCW\nT0T86qi2anMYR319W6q+ysDeoQKBgQDFADQCs+a98dp5X1VTQuWEqXPPBBJ8qOGh\nvl3y1rYnrbYZHkVWHkmERbHvfm1lCpsJakWdJsate10vQZR3XXRhRC5cxWfO6NMJ\neqTEUhHRyK5sQaCO/BLsH2lSkgfasGeqfP2jiM0I0vo5YwXP9KO8nxwtMoqAj7Hl\niOiwa5RinQKBgA8RpszgcWsZmNJt9aR+M29RPTs087ziXpQ6TvDV20U6HaCZnabl\n6xnFep48RLBry5/uS6ZcxMXh26JWmgq6OmdETBXB/q5Z4LPqZmTLn1xMyKb5qIkl\nEbC+/Ma36HRHa18IDwhOm09Y9Nu2aiHRIYQJwRQxqMX1T9Bxpey4xmohAoGAXmMC\niGj5nPhL3Os4TnQ206D8w6sH0IJ52K0FBlypWcl4/f/q6KAKST27Sywf7dFvBsvM\nHsd9WZFJzGJ3Z9l28UNhk0Fhw1j6BAim+Qj5ULH+IBAxhVBxIIDMTat55+WtRZot\nTDU3R4sOKICxQDnOWYlCTsVwZrhyW6+FDUH+DmECgYEAxB9+AYI8DnKTRoSt9PKl\nr+eE8cDWvwq2x2AWWupXmYWiBvruDNjmShlsPa5r9UEFZLl4uiTBExcJWSJm8Jwd\nbZ6F5TtyLyTKs77TWxwFQe1uInuuBYzXk0h4hAZlxK6Hv+T2sW9Idt0pVx6wESc4\nHtkkHOv/tYIKHVpFTVD6kEA=\n-----END PRIVATE KEY-----",
        client_email: process.env.GOOGLE_CLIENT_EMAIL || "newresttelegrambotservice@newrest-465515.iam.gserviceaccount.com",
        client_id: process.env.GOOGLE_CLIENT_ID || "110694577902197703065",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/newresttelegrambotservice%40newrest-465515.iam.gserviceaccount.com",
        universe_domain: "googleapis.com"
      };
      
      this.sheets = new GoogleSheetsClient(spreadsheetId!, googleCredentials);
    }
    
    this.setupSessionCleanup();
  }

  // Setup session cleanup to prevent memory leaks
  private setupSessionCleanup(): void {
    // Clean up expired sessions every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const sessionTTL = 15 * 60 * 1000; // 15 minutes TTL for check-in sessions
      let cleanedCount = 0;
      
      // Clean up checkInSessions
      for (const [userId, session] of checkInSessions) {
        if (now - (session.lastActivity || 0) > sessionTTL) {
          checkInSessions.delete(userId);
          cleanedCount++;
        }
      }
      
      // Clean up contactSessions
      for (const [userId, session] of contactSessions) {
        if (now - (session.lastActivity || 0) > sessionTTL) {
          contactSessions.delete(userId);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`[MessageHandler] Memory cleanup: Removed ${cleanedCount} expired sessions`);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  // Get language for working users (no sheet reading needed)
  public async getWorkingUserLanguage(userId: number): Promise<'en' | 'gr'> {
    // Working users default to Greek (most likely in Greece)
    // No need to read main sheet for this
    return 'gr';
  }

  // Helper method to get user's language from Google Sheets
  public async getUserLanguage(userId: number): Promise<'en' | 'gr'> {
    try {
      // Try to get from main sheet first
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
      console.error('[MessageHandler] Error getting user language from main sheet:', error);
      
      // Fallback: try to get from WORKERS sheet
      try {
        const worker = await this.sheets.getWorkerById(userId);
        if (worker) {
          // Default to Greek for working users (most likely in Greece)
          return 'gr';
        }
      } catch (workerError) {
        console.error('[MessageHandler] Error getting worker info for language fallback:', workerError);
      }
      
      // Final fallback: return English
      return 'en';
    }
  }

  // Helper method to check if user has "working" status
  public async getUserStatus(userId: number): Promise<{ status: string; name: string } | null> {
    try {
      // Use WORKERS sheet as the main source of truth
      const worker = await this.sheets.getWorkerById(userId);
      
      if (worker) {
        return {
          status: worker.status,
          name: worker.name
        };
      }
      
      // Fallback to old method if not found in WORKERS sheet
      const header = await this.sheets.getHeaderRow("'Φύλλο1'!A2:Z2");
      const rows = await this.sheets.getRows("'Φύλλο1'!A3:Z1000");
      
      const statusColumnIndex = header.findIndex(h => h === 'STATUS');
      
      if (statusColumnIndex === -1) {
        return null;
      }
      
      for (const row of rows) {
        if (row.length > statusColumnIndex && row[1] === userId.toString()) {
          const status = row[statusColumnIndex] || '';
          const name = row[3] || ''; // NAME column
          return { status, name };
        }
      }
      
      return null;
      
    } catch (error) {
      console.error('[MessageHandler] Error getting user status:', error);
      return null;
    }
  }

  // Cached user status to avoid repeated sheet calls
  private userStatusCache = new Map<number, { status: string; name: string; timestamp: number }>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Helper method to get cached user status
  public async getCachedUserStatus(userId: number): Promise<{ status: string; name: string } | null> {
    const now = Date.now();
    const cached = this.userStatusCache.get(userId);
    
    // Return cached data if still valid
    if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
      console.log(`[MessageHandler] Using cached user status for ${userId}: ${cached.status}`);
      return { status: cached.status, name: cached.name };
    }
    
    // Cache expired - get fresh data from sheets
    console.log(`[MessageHandler] Cache expired for ${userId}, getting fresh data from sheets`);
    const status = await this.getUserStatus(userId);
    if (status) {
      // Cache the result
      this.userStatusCache.set(userId, {
        ...status,
        timestamp: now
      });
      console.log(`[MessageHandler] Cached user status for ${userId}: ${status.status}`);
    }
    
    return status;
  }

  // Clear user status cache (call when user status changes)
  public clearUserStatusCache(userId?: number): void {
    if (userId) {
      this.userStatusCache.delete(userId);
      console.log(`[MessageHandler] Cleared cache for user ${userId}`);
    } else {
      this.userStatusCache.clear();
      console.log('[MessageHandler] Cleared all user status cache');
    }
  }

  // Helper method to get current month sheet name
  public getCurrentMonthSheetName(): string {
    const now = new Date();
    const month = now.getMonth() + 1; // getMonth() returns 0-11
    return `month_${month}`;
  }

  // Helper method to get current date in DD/MM/YYYY format
  public getCurrentDate(): string {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // Helper method to find user row in month sheet
  public async findUserRowInMonthSheet(sheetName: string, userName: string): Promise<number | null> {
    try {
      const rowsRaw = await this.sheets.getRows(`${sheetName}!A2:Z1000`);
      if (!rowsRaw || !rowsRaw.length) {
        return null;
      }
      
      const rows = rowsRaw as string[][];
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue; // Skip empty rows
        
        const rowName = row[0].trim(); // Column A contains names
        
        // Try exact match first
        if (rowName.toLowerCase() === userName.toLowerCase()) {
          return i + 2; // Return 1-indexed row number (add 2 because we start from A2)
        }
        
        // Try partial match (in case of extra spaces or slight differences)
        if (rowName.toLowerCase().includes(userName.toLowerCase()) || 
            userName.toLowerCase().includes(rowName.toLowerCase())) {
          return i + 2;
        }
      }
      
      return null;
    } catch (error) {
      console.error('[MessageHandler] Error finding user row in month sheet:', error);
      return null;
    }
  }

  // Helper method to write "enter" in the current date column
  public async writeEnterInMonthSheet(sheetName: string, rowNumber: number, dateColumn: string): Promise<boolean> {
    try {
      const cellRange = `${sheetName}!${dateColumn}${rowNumber}`;
      await this.sheets.updateCell(cellRange, 'enter');
      return true;
    } catch (error) {
      console.error('[MessageHandler] Error writing enter in month sheet:', error);
      return false;
    }
  }

  async handleMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text || '';
    const user = msg.from;

    if (!userId || !user) {
      this.logger.error('Message received without user information');
      return;
    }



    // Skip if this is a group chat and user is not admin
    if (msg.chat.type !== 'private') {
              const isAdmin = await this.adminService.isAdmin(userId, msg.chat.id, this.bot);
      if (!isAdmin) {
        return;
      }
    }

    // Check if user is in contact mode
    const contactSession = contactSessions.get(userId);
    if (contactSession?.awaitingMessage) {
      await this.handleContactMessage(msg);
      return;
    }

    // Check if user is awaiting location validation
    const checkInSession = checkInSessions.get(userId);
    if (checkInSession?.awaitingLocation && msg.location) {
      await this.handleLocationValidation(msg);
      return;
    }

    this.logger.info(`Message received from user ${userId}: ${text}`);

    try {
      // Update user's last activity and message count
      await this.userService.updateUserActivity(userId);

      // Check if user is registered
      const user = await this.userService.getUser(userId);
      if (!user) {
        await this.bot.sendMessage(chatId, 'Please use /start first to register with the bot.');
        return;
      }

      // Check if user has "working" status and show check-in
      // For working users, we don't need to read sheets here
      // They should use the /start command which already checks their status
      // This prevents unnecessary month sheet reading during regular messages
      
      // Process the message based on content
      await this.processMessage(chatId, userId, text, user);

    } catch (error) {
      this.logger.error(`Error handling message from user ${userId}:`, error);
      await this.bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
  }

  private async processMessage(chatId: number, userId: number, text: string, user: any): Promise<void> {
    // Convert to lowercase for easier matching
    const lowerText = text.toLowerCase();

    // Check for help requests
    if (lowerText.includes('help') || lowerText.includes('support')) {
      await this.handleHelpRequest(chatId);
      return;
    }

    // Default response for unknown messages
    await this.handleDefaultMessage(chatId, text, user);
  }



  private async handleHelpRequest(chatId: number): Promise<void> {
    const helpMessage = `
🤝 Need Help?

I'm your hiring assistant for Newrest. Here's what I can help with:

📋 Commands:
• /start - Begin your job application
• /help - Show this help information

💬 Features:
• Job application process
• Course scheduling
• Check-in/check-out for workers
• Contact support team

💡 Tips:
• Use /start to begin your application
• Follow the step-by-step process
• Contact support if you need help

Is there something specific about the hiring process you need help with?
    `.trim();

    await this.bot.sendMessage(chatId, helpMessage);
  }



  private async handleDefaultMessage(chatId: number, text: string, user: any): Promise<void> {
    const responses = [
      `Thanks for your message, ${user.firstName}! 💬 I'm here to help.`,
      `Got it, ${user.firstName}! 👍 What would you like to do next?`,
      `Interesting, ${user.firstName}! 🤔 Tell me more about that.`,
      `I see, ${user.firstName}! 📝 How can I assist you with that?`,
      `Noted, ${user.firstName}! ✨ Is there anything specific you need help with?`,
      `I understand, ${user.firstName}! 💭 How can I help you today?`,
      `Thanks for sharing that, ${user.firstName}! 🎯 What can I do for you?`,
      `Got your message, ${user.firstName}! 🌟 How may I assist you?`
    ];

    const randomResponse = responses[Math.floor(Math.random() * responses.length)] || 'Thank you!';
    
    // Send a single, natural response without suggestions
    await this.bot.sendMessage(chatId, randomResponse);
  }

  private async handleContactMessage(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const message = msg.text!;

    // Clear contact session
    contactSessions.delete(userId);

    // Get user's language
    const userLang = await this.getUserLanguage(userId);

    // Forward message to admin group
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (adminGroupId) {
      try {
        const user = await this.userService.getUser(userId);
        const userName = user ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Unknown User';
        
        const forwardText = `📱 Contact from ${userName} (ID: ${userId})\n💬 Message: ${message}`;
        
        await this.bot.sendMessage(parseInt(adminGroupId), forwardText);
        
        // Confirm to user in their language
        const confirmMessage = userLang === 'gr' 
          ? '✅ Το μήνυμά σας έχει σταλεί στην ομάδα. Θα επικοινωνήσουν μαζί σας σύντομα!'
          : '✅ Your message has been sent to the crew. They will get back to you soon!';
        
        await this.bot.sendMessage(chatId, confirmMessage);
        
      } catch (error) {
        console.error('[MessageHandler] Error forwarding contact message:', error);
        const errorMessage = userLang === 'gr'
          ? '❌ Συγγνώμη, υπήρξε σφάλμα στην αποστολή του μηνύματός σας. Παρακαλώ δοκιμάστε ξανά αργότερα.'
          : '❌ Sorry, there was an error sending your message. Please try again later.';
        await this.bot.sendMessage(chatId, errorMessage);
      }
    } else {
      const errorMessage = userLang === 'gr'
        ? '❌ Η λειτουργία επικοινωνίας δεν είναι ρυθμισμένη. Παρακαλώ επικοινωνήστε απευθείας με την υποστήριξη.'
        : '❌ Contact feature is not configured. Please contact support directly.';
      await this.bot.sendMessage(chatId, errorMessage);
    }
  }

  // Public method to start contact flow
  public async startContactFlow(chatId: number, userId: number): Promise<void> {
    contactSessions.set(userId, { awaitingMessage: true, lastActivity: Date.now() });
    
    // Get user's language
    const userLang = await this.getUserLanguage(userId);
    
    const message = userLang === 'gr'
      ? '📞 Παρακαλώ πληκτρολογήστε το μήνυμά σας και θα το προωθήσω στην ομάδα. Θα επικοινωνήσουν μαζί σας το συντομότερο δυνατό.'
      : '📞 Please type your message and I\'ll forward it to the crew. They will get back to you as soon as possible.';
    
    await this.bot.sendMessage(chatId, message, { reply_markup: { force_reply: true } });
  }

  // Handle working user check-in
  public async handleWorkingUserCheckIn(chatId: number, userId: number, userName: string, messageId?: number): Promise<void> {
    try {
      // Use working user language (no sheet reading needed)
      const userLang = await this.getWorkingUserLanguage(userId);
      
      // First, request location validation
      const locationMsg = userLang === 'gr'
        ? `📍 Παρακαλώ μοιραστείτε την τοποθεσία σας:`
        : `📍 Please share your location:`;
      
      const locationKeyboard = {
        keyboard: [
          [{ text: userLang === 'gr' ? '📍 Μοιραστείτε την τοποθεσία' : '📍 Share Location', request_location: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      } as TelegramBot.SendMessageOptions['reply_markup'];
      
      // Send the location request message
      await this.bot.sendMessage(chatId, locationMsg, { reply_markup: locationKeyboard });
      
      // Store check-in session for location validation
      checkInSessions.set(userId, {
        awaitingLocation: true,
        userName,
        action: 'checkin',
        messageId: messageId || undefined,
        lastActivity: Date.now()
      });
      
    } catch (error) {
      console.error('[MessageHandler] Error handling working user check-in:', error);
      // Use working user language (no sheet reading needed)
      const userLang = await this.getWorkingUserLanguage(userId);
      const errorMsg = userLang === 'gr'
        ? '❌ Σφάλμα κατά την επεξεργασία του check-in. Παρακαλώ δοκιμάστε ξανά.'
        : '❌ Error processing check-in. Please try again.';
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  // Handle working user check-out
  public async handleWorkingUserCheckOut(chatId: number, userId: number, userName: string, messageId?: number): Promise<void> {
    try {
      // Use working user language (no sheet reading needed)
      const userLang = await this.getWorkingUserLanguage(userId);
      
      // First, request location validation
      const locationMsg = userLang === 'gr'
        ? `📍 Παρακαλώ μοιραστείτε την τοποθεσία σας:`
        : `📍 Please share your location:`;
      
      const locationKeyboard = {
        keyboard: [
          [{ text: userLang === 'gr' ? '📍 Μοιραστείτε την τοποθεσία' : '📍 Share Location', request_location: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      } as TelegramBot.SendMessageOptions['reply_markup'];
      
      // Send the location request message
      await this.bot.sendMessage(chatId, locationMsg, { reply_markup: locationKeyboard });
      
      // Store check-out session for location validation
      checkInSessions.set(userId, {
        awaitingLocation: true,
        userName,
        action: 'checkout',
        messageId: messageId || undefined,
        lastActivity: Date.now()
      });
      
    } catch (error) {
      console.error('[MessageHandler] Error handling working user check-out:', error);
      // Use working user language (no sheet reading needed)
      const userLang = await this.getWorkingUserLanguage(userId);
      const errorMsg = userLang === 'gr'
        ? '❌ Σφάλμα κατά την επεξεργασία του check-out. Παρακαλώ δοκιμάστε ξανά.'
        : '❌ Error processing check-out. Please try again.';
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  // Handle location validation for check-in/check-out
  private async handleLocationValidation(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const location = msg.location!;
    
    const session = checkInSessions.get(userId);
    if (!session) {
      return;
    }
    
    // Clear session
    checkInSessions.delete(userId);
    
    // Remove the location keyboard after location is received
    // Use working user language (no sheet reading needed)
    const userLang = await this.getWorkingUserLanguage(userId);
    const processingMsg = userLang === 'gr'
      ? '⏳ Επεξεργασία τοποθεσίας...'
      : '⏳ Processing location...';
    
    await this.bot.sendMessage(chatId, processingMsg, { reply_markup: { remove_keyboard: true } });
    
    // Get user's language (already got it above)
    
    // Define office location (you can adjust these coordinates)
    const officeLat = 37.909170; // TEMPORARY TESTING coordinates - REMEMBER TO REVERT!
    const officeLng = 23.873056; // TEMPORARY TESTING coordinates - REMEMBER TO REVERT!
    const maxDistance = 0.5; // 500 meters radius
    
    // Calculate distance between user and office
    const distance = this.calculateDistance(
      location.latitude, location.longitude,
      officeLat, officeLng
    );
    
    if (distance <= maxDistance) {
      // Location is valid, proceed with action
      if (session.action === 'checkin') {
        await this.processCheckIn(chatId, userId, session.userName, session.messageId);
      } else if (session.action === 'checkout') {
        await this.processCheckOut(chatId, userId, session.userName, session.messageId);
      }
    } else {
      // Location is invalid
      const errorMsg = userLang === 'gr'
        ? `❌ Δεν είστε στο γραφείο. Απόσταση: ${distance.toFixed(2)} km\n\n📍 Παρακαλώ μετακινηθείτε στο γραφείο και δοκιμάστε ξανά.`
        : `❌ You are not at the office. Distance: ${distance.toFixed(2)} km\n\n📍 Please move to the office and try again.`;
      
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  // Calculate distance between two points using Haversine formula
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI/180);
  }

  // Process check-in after location validation
  private async processCheckIn(chatId: number, userId: number, userName: string, messageId?: number): Promise<void> {
    try {
      // Use working user language (no sheet reading needed)
      const userLang = await this.getWorkingUserLanguage(userId);
      
      // First, ensure user exists in WORKERS sheet
      let worker = await this.sheets.getWorkerById(userId);
      
      if (!worker) {
        // Create worker in WORKERS sheet if not exists
        await this.sheets.addWorker(userName, userId, 'WORKING');
        worker = { name: userName, id: userId.toString(), status: 'WORKING' };
      }
      
      // Get current month sheet name
      const sheetName = this.getCurrentMonthSheetName();
      const currentDate = this.getCurrentDate();
      
      // Find user row in month sheet using worker name
      let rowNumber = await this.findUserRowInMonthSheet(sheetName, worker.name);
      
      // If user not found, create a new row
      if (!rowNumber) {
        // Get the next available row
        const rowsRaw = await this.sheets.getRows(`${sheetName}!A2:Z1000`);
        const rows = rowsRaw as string[][];
        const nextRow = rows.length + 2; // +2 because we start from A2
        
        // Add user name to the new row
        try {
          await this.sheets.updateCell(`${sheetName}!A${nextRow}`, worker.name);
          rowNumber = nextRow;
          
          // Clear cache for this month sheet to ensure fresh data for check-out
          if (this.sheets.clearCacheForMonthSheet) {
            this.sheets.clearCacheForMonthSheet(sheetName);
          }
        } catch (error) {
          console.error('[MessageHandler] Error creating new row:', error);
          // Use working user language (no sheet reading needed)
          const userLang = await this.getWorkingUserLanguage(userId);
          const errorMsg = userLang === 'gr'
            ? '❌ Σφάλμα κατά τη δημιουργία νέας γραμμής. Παρακαλώ επικοινωνήστε με την ομάδα.'
            : '❌ Error creating new row. Please contact the team.';
          await this.bot.sendMessage(chatId, errorMsg);
          return;
        }
      }
      
      // Find current date column
      const header = await this.sheets.getHeaderRow(`${sheetName}!A2:Z2`);
      const dateColumnIndex = header.findIndex(h => h === currentDate);
      if (dateColumnIndex === -1) {
        // Use working user language (no sheet reading needed)
        const userLang = await this.getWorkingUserLanguage(userId);
        const errorMsg = userLang === 'gr'
          ? '❌ Δεν βρέθηκε η στήλη της σημερινής ημερομηνίας. Παρακαλώ επικοινωνήστε με την ομάδα.'
          : '❌ Today\'s date column was not found. Please contact the team.';
        await this.bot.sendMessage(chatId, errorMsg);
        return;
      }
      
      // Convert column index to letter (A=0, B=1, etc.)
      const dateColumn = String.fromCharCode(65 + dateColumnIndex); // A=65 in ASCII
      
      // Get current time in Greece timezone
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/Athens' 
      });
      
      // Write the check-in time
      try {
        const cellRange = `${sheetName}!${dateColumn}${rowNumber}`;
        await this.sheets.updateCell(cellRange, timeString);
        
        // Show success message
        const successMsg = userLang === 'gr'
          ? `✅ Η παρουσία σας έχει καταγραφεί στις ${timeString}!\n\n👋 Καλή δουλειά! 💪`
          : `✅ Your attendance has been recorded at ${timeString}!\n\n👋 Have a great day! 💪`;
        
        // Always send a new message (don't edit previous)
        await this.bot.sendMessage(chatId, successMsg);
        
        // Send second message with Check Out button
        const checkOutMsg = userLang === 'gr'
          ? `📋 Επιλέξτε την επόμενη ενέργεια:`
          : `📋 Choose your next action:`;
        
        const keyboard = {
          inline_keyboard: [
            [{ text: userLang === 'gr' ? '🚪 Check Out' : '🚪 Check Out', callback_data: 'working_checkout' }],
            [{ text: userLang === 'gr' ? '📞 Επικοινωνία' : '📞 Contact', callback_data: 'working_contact' }]
          ]
        };
        
        await this.bot.sendMessage(chatId, checkOutMsg, { reply_markup: keyboard });
        
      } catch (error) {
        console.error('[MessageHandler] Error writing check-in time:', error);
        // Use working user language (no sheet reading needed)
        const userLang = await this.getWorkingUserLanguage(userId);
        const errorMsg = userLang === 'gr'
          ? '❌ Σφάλμα κατά την καταγραφή της παρουσίας σας. Παρακαλώ επικοινωνήστε με την ομάδα.'
          : '❌ Error recording your attendance. Please contact the team.';
        await this.bot.sendMessage(chatId, errorMsg);
      }
      
    } catch (error) {
      console.error('[MessageHandler] Error processing check-in:', error);
      const userLang = await this.getUserLanguage(userId);
      const errorMsg = userLang === 'gr'
        ? '❌ Σφάλμα κατά την επεξεργασία του check-in. Παρακαλώ δοκιμάστε ξανά.'
        : '❌ Error processing check-in. Please try again.';
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  // Process check-out after location validation
  private async processCheckOut(chatId: number, userId: number, userName: string, messageId?: number): Promise<void> {
    try {
      // Use working user language (no sheet reading needed)
      const userLang = await this.getWorkingUserLanguage(userId);
      
      // Get worker data from WORKERS sheet
      let worker = await this.sheets.getWorkerById(userId);
      
      if (!worker) {
        // Try to get worker by name as fallback
        worker = await this.sheets.getWorkerByName(userName);
        
        if (!worker) {
          console.log(`[MessageHandler] Worker not found in WORKERS sheet for user ${userId}, creating new worker`);
          // Create worker in WORKERS sheet if not exists
          await this.sheets.addWorker(userName, userId, 'WORKING');
          worker = { name: userName, id: userId.toString(), status: 'WORKING' };
        }
      }
      
      // Get current month sheet name
      const sheetName = this.getCurrentMonthSheetName();
      const currentDate = this.getCurrentDate();
      
      // Find user row in month sheet using worker name
      const rowNumber = await this.findUserRowInMonthSheet(sheetName, worker.name);
      
      if (!rowNumber) {
        console.log(`[MessageHandler] User "${worker.name}" not found in month sheet ${sheetName}`);
        // Use working user language (no sheet reading needed)
        const userLang = await this.getWorkingUserLanguage(userId);
        const errorMsg = userLang === 'gr'
          ? '❌ Δεν βρέθηκε η γραμμή σας στο φύλλο του μήνα. Παρακαλώ επικοινωνήστε με την ομάδα.'
          : '❌ Your row was not found in the month sheet. Please contact the team.';
        await this.bot.sendMessage(chatId, errorMsg);
        return;
      }
      
      // Find current date column
      const header = await this.sheets.getHeaderRow(`${sheetName}!A2:Z2`);
      const dateColumnIndex = header.findIndex(h => h === currentDate);
      if (dateColumnIndex === -1) {
        // Use working user language (no sheet reading needed)
        const userLang = await this.getWorkingUserLanguage(userId);
        const errorMsg = userLang === 'gr'
          ? '❌ Δεν βρέθηκε η στήλη της σημερινής ημερομηνίας. Παρακαλώ επικοινωνήστε με την ομάδα.'
          : '❌ Today\'s date column was not found. Please contact the team.';
        await this.bot.sendMessage(chatId, errorMsg);
        return;
      }
      
      // Convert column index to letter (A=0, B=1, etc.)
      const dateColumn = String.fromCharCode(65 + dateColumnIndex); // A=65 in ASCII
      
      // Get current time in Greece timezone
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/Athens' 
      });
      
      // Write the check-out time (append to existing check-in time)
      try {
        const cellRange = `${sheetName}!${dateColumn}${rowNumber}`;
        const currentValue = await this.sheets.getCellValue(cellRange);
        
        // Check if there's already a check-in time and append check-out time
        let newValue;
        if (currentValue && currentValue.includes(' - ')) {
          // Already has both check-in and check-out, replace the check-out part
          const parts = currentValue.split(' - ');
          newValue = `${parts[0]} - ${timeString}`;
        } else if (currentValue) {
          // Has only check-in time, append check-out
          newValue = `${currentValue} - ${timeString}`;
        } else {
          // No existing value, just write check-out time
          newValue = timeString;
        }
        await this.sheets.updateCell(cellRange, newValue);
        
        // Show success message
        const successMsg = userLang === 'gr'
          ? `✅ Η αποχώρηση σας έχει καταγραφεί στις ${timeString}!\n\n👋 Καλή συνέχεια! 🚪`
          : `✅ Your check-out has been recorded at ${timeString}!\n\n👋 Take care! 🚪`;
        
        // Always send a new message for check-out success (don't edit the location request)
        await this.bot.sendMessage(chatId, successMsg);
        
      } catch (error) {
        console.error('[MessageHandler] Error writing check-out time:', error);
        // Use working user language (no sheet reading needed)
        const userLang = await this.getWorkingUserLanguage(userId);
        const errorMsg = userLang === 'gr'
          ? '❌ Σφάλμα κατά την καταγραφή της αποχώρησης σας. Παρακαλώ επικοινωνήστε με την ομάδα.'
          : '❌ Error recording your check-out. Please contact the team.';
        await this.bot.sendMessage(chatId, errorMsg);
      }
      
    } catch (error) {
      console.error('[MessageHandler] Error processing check-out:', error);
      // Use working user language (no sheet reading needed)
      const userLang = await this.getWorkingUserLanguage(userId);
      const errorMsg = userLang === 'gr'
        ? '❌ Σφάλμα κατά την επεξεργασία του check-out. Παρακαλώ δοκιμάστε ξανά.'
        : '❌ Error processing check-out. Please try again.';
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  // Show main menu for working users
  public async showWorkingUserMainMenu(chatId: number, userId: number, userName: string): Promise<void> {
    // Use working user language (no sheet reading needed)
    const userLang = await this.getWorkingUserLanguage(userId);
    
    const messageText = userLang === 'gr' 
      ? `Γεια σας ${userName}! 🎉\n\nΕπιλέξτε μια ενέργεια:`
      : `Hello ${userName}! 🎉\n\nChoose an action:`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: userLang === 'gr' ? '📝 Σύνδεση' : '📝 Log In', callback_data: 'working_checkin' }],
        [{ text: userLang === 'gr' ? '📞 Επικοινωνία' : '📞 Contact', callback_data: 'working_contact' }]
      ]
    };
    
    await this.bot.sendMessage(chatId, messageText, { reply_markup: keyboard });
  }

  // Check if user has ongoing check-out session
  public async hasOngoingCheckoutSession(userId: number): Promise<boolean> {
    try {
      // Check if user has any active check-out session
      // This would check for pending location requests or active check-out flows
      // For now, we'll return false as a safe default
      // You can implement more sophisticated session tracking later
      
      console.log(`[MessageHandler] Checking ongoing checkout session for user ${userId}`);
      
      // TODO: Implement proper session tracking
      // This could check:
      // - Pending location requests
      // - Active check-out flows
      // - Uncompleted check-out processes
      
      return false; // Safe default - assume no ongoing checkout
      
    } catch (error) {
      console.error(`[MessageHandler] Error checking ongoing checkout session for user ${userId}:`, error);
      return false; // Safe default on error
    }
  }
} 