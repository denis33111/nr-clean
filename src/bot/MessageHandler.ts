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
      const keyFilePath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || 'secrets/google-service-account.json';
      this.sheets = new GoogleSheetsClient(spreadsheetId!, keyFilePath);
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
      
      // Log session counts for monitoring
      if (checkInSessions.size > 0 || contactSessions.size > 0) {
        console.log(`[MessageHandler] Active sessions - Check-in: ${checkInSessions.size}, Contact: ${contactSessions.size}`);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  // Helper method to get user's language from Google Sheets
  public async getUserLanguage(userId: number): Promise<'en' | 'gr'> {
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
      console.error('[MessageHandler] Error getting user language:', error);
      return 'en';
    }
  }

  // Helper method to check if user has "working" status
  public async getUserStatus(userId: number): Promise<{ status: string; name: string } | null> {
    const startTime = Date.now();
    console.log(`[MessageHandler] getUserStatus called for user ${userId} at ${new Date().toISOString()}`);
    
    try {
      // Use WORKERS sheet as the main source of truth
      const worker = await this.sheets.getWorkerById(userId);
      
      if (worker) {
        console.log(`[MessageHandler] Found worker: ${worker.name}, status: ${worker.status} at ${new Date().toISOString()}`);
        console.log(`[MessageHandler] getUserStatus completed in ${Date.now() - startTime}ms`);
        return {
          status: worker.status,
          name: worker.name
        };
      }
      
      // Fallback to old method if not found in WORKERS sheet
      console.log(`[MessageHandler] Worker not found in WORKERS sheet, checking main sheet...`);
      
      const header = await this.sheets.getHeaderRow("'Φύλλο1'!A2:Z2");
      console.log(`[MessageHandler] Header row retrieved at ${new Date().toISOString()}`);
      
      const rows = await this.sheets.getRows("'Φύλλο1'!A3:Z1000");
      console.log(`[MessageHandler] Rows retrieved at ${new Date().toISOString()}`);
      
      const statusColumnIndex = header.findIndex(h => h === 'STATUS');
      console.log(`[MessageHandler] Status column index: ${statusColumnIndex} at ${new Date().toISOString()}`);
      
      if (statusColumnIndex === -1) {
        console.log(`[MessageHandler] Status column not found`);
        return null;
      }
      
      for (const row of rows) {
        if (row.length > statusColumnIndex && row[1] === userId.toString()) {
          const status = row[statusColumnIndex] || '';
          const name = row[3] || ''; // NAME column
          console.log(`[MessageHandler] Found user status: ${status}, name: ${name} at ${new Date().toISOString()}`);
          console.log(`[MessageHandler] getUserStatus completed in ${Date.now() - startTime}ms`);
          return { status, name };
        }
      }
      
      console.log(`[MessageHandler] User not found in any sheet`);
      return null;
      
    } catch (error) {
      console.error('[MessageHandler] Error getting user status:', error);
      return null;
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
        console.log(`[MessageHandler] No rows found in sheet ${sheetName}`);
        return null;
      }
      
      const rows = rowsRaw as string[][];
      console.log(`[MessageHandler] Searching for user "${userName}" in sheet ${sheetName}`);
      console.log(`[MessageHandler] Found ${rows.length} rows in sheet`);
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue; // Skip empty rows
        
        const rowName = row[0].trim(); // Column A contains names
        console.log(`[MessageHandler] Row ${i + 2}: "${rowName}" vs "${userName}"`);
        
        // Try exact match first
        if (rowName.toLowerCase() === userName.toLowerCase()) {
          console.log(`[MessageHandler] Found exact match at row ${i + 2}`);
          return i + 2; // Return 1-indexed row number (add 2 because we start from A2)
        }
        
        // Try partial match (in case of extra spaces or slight differences)
        if (rowName.toLowerCase().includes(userName.toLowerCase()) || 
            userName.toLowerCase().includes(rowName.toLowerCase())) {
          console.log(`[MessageHandler] Found partial match at row ${i + 2}`);
          return i + 2;
        }
      }
      
      console.log(`[MessageHandler] User "${userName}" not found in sheet ${sheetName}`);
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

    console.log(`[MessageHandler] Received message from user ${userId}: ${text}`);
    console.log(`[MessageHandler] Message has location: ${!!msg.location}`);
    console.log(`[MessageHandler] Location data:`, msg.location);

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
      console.log(`[MessageHandler] User ${userId} is in contact mode`);
      await this.handleContactMessage(msg);
      return;
    }

    // Check if user is awaiting location validation
    const checkInSession = checkInSessions.get(userId);
    console.log(`[MessageHandler] Check-in session for user ${userId}:`, checkInSession);
    if (checkInSession?.awaitingLocation && msg.location) {
      console.log(`[MessageHandler] Processing location validation for user ${userId}`);
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
      const userStatus = await this.getUserStatus(userId);
      if (userStatus && userStatus.status.toLowerCase() === 'working') {
        await this.showWorkingUserMainMenu(chatId, userId, userStatus.name);
        return;
      }

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

    // Check for greetings
    if (this.isGreeting(lowerText)) {
      await this.handleGreeting(chatId, user);
      return;
    }

    // Check for questions
    if (this.isQuestion(lowerText)) {
      await this.handleQuestion(chatId, text);
      return;
    }

    // Check for specific keywords
    if (lowerText.includes('help') || lowerText.includes('support')) {
      await this.handleHelpRequest(chatId);
      return;
    }

    if (lowerText.includes('time') || lowerText.includes('date')) {
      await this.handleTimeRequest(chatId);
      return;
    }

    if (lowerText.includes('weather')) {
      await this.handleWeatherRequest(chatId);
      return;
    }

    if (lowerText.includes('joke') || lowerText.includes('funny')) {
      await this.handleJokeRequest(chatId);
      return;
    }

    // Default response
    await this.handleDefaultMessage(chatId, text, user);
  }

  private isGreeting(text: string): boolean {
    const greetings = [
      'hello', 'hi', 'hey', 'good morning', 'good afternoon', 
      'good evening', 'greetings', 'salutations', 'yo', 'sup'
    ];
    return greetings.some(greeting => text.includes(greeting));
  }

  private isQuestion(text: string): boolean {
    return text.includes('?') || 
           text.startsWith('what') || 
           text.startsWith('how') || 
           text.startsWith('why') || 
           text.startsWith('when') || 
           text.startsWith('where') || 
           text.startsWith('who') || 
           text.startsWith('which');
  }

  private async handleGreeting(chatId: number, user: any): Promise<void> {
    const greetings = [
      `Hello ${user.firstName}! 👋 How can I help you today?`,
      `Hi there ${user.firstName}! 😊 What would you like to do?`,
      `Hey ${user.firstName}! 🎉 Nice to see you!`,
      `Greetings ${user.firstName}! ✨ How's your day going?`
    ];

    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)] || 'Hello!';
    await this.bot.sendMessage(chatId, randomGreeting);
  }

  private async handleQuestion(chatId: number, text: string): Promise<void> {
    const responses = [
      "That's an interesting question! 🤔 I'm still learning, but I'll do my best to help.",
      "Great question! 💭 Let me think about that...",
      "I'm not sure I understand completely. Could you rephrase that? 🤷‍♂️",
      "That's a good point! 💡 What specifically would you like to know?",
      "I'm here to help! 🎯 Could you provide more details?"
    ];

    const randomResponse = responses[Math.floor(Math.random() * responses.length)] || 'Thank you!';
    await this.bot.sendMessage(chatId, randomResponse);
  }

  private async handleHelpRequest(chatId: number): Promise<void> {
    const helpMessage = `
🤝 Need Help?

I'm here to assist you! Here are some things I can help with:

📋 Commands:
• /start - Start the bot
• /help - Show help information  
• /settings - Manage your settings
• /stats - View your statistics

💬 Features:
• Answer questions
• Provide information
• Chat and interact
• Track your usage

💡 Tips:
• Use commands for specific actions
• Send regular messages to chat
• Ask questions naturally
• Use /help anytime for assistance

Is there something specific you'd like help with?
    `.trim();

    await this.bot.sendMessage(chatId, helpMessage);
  }

  private async handleTimeRequest(chatId: number): Promise<void> {
    const now = new Date();
    const timeMessage = `
🕐 Current Time Information

📅 Date: ${now.toLocaleDateString()}
⏰ Time: ${now.toLocaleTimeString()}
🌍 Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
📅 Day: ${now.toLocaleDateString('en-US', { weekday: 'long' })}
📆 Month: ${now.toLocaleDateString('en-US', { month: 'long' })}
    `.trim();

    await this.bot.sendMessage(chatId, timeMessage);
  }

  private async handleWeatherRequest(chatId: number): Promise<void> {
    const weatherMessage = `
🌤️ Weather Information

I'd love to help you with weather information! However, I need to know your location to provide accurate weather data.

📍 To get weather info, please:
1. Share your location, or
2. Tell me your city name

You can also try:
• "Weather in [city name]"
• "What's the weather like in [location]"

Would you like to share your location?
    `.trim();

    await this.bot.sendMessage(chatId, weatherMessage);
  }

  private async handleJokeRequest(chatId: number): Promise<void> {
    const jokes = [
      "Why don't scientists trust atoms? Because they make up everything! 😄",
      "Why did the scarecrow win an award? Because he was outstanding in his field! 🌾",
      "Why don't eggs tell jokes? They'd crack each other up! 🥚",
      "Why did the math book look so sad? Because it had too many problems! 📚",
      "What do you call a fake noodle? An impasta! 🍝",
      "Why did the bicycle fall over? Because it was two-tired! 🚲",
      "What do you call a bear with no teeth? A gummy bear! 🐻",
      "Why don't skeletons fight each other? They don't have the guts! 💀",
      "What do you call a fish wearing a bowtie? So-fish-ticated! 🐟",
      "Why did the cookie go to the doctor? Because it was feeling crumbly! 🍪"
    ];

    const randomJoke = jokes[Math.floor(Math.random() * jokes.length)] || 'No joke available.';
    await this.bot.sendMessage(chatId, randomJoke);
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
      // Get user's language
      const userLang = await this.getUserLanguage(userId);
      
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
      const userLang = await this.getUserLanguage(userId);
      const errorMsg = userLang === 'gr'
        ? '❌ Σφάλμα κατά την επεξεργασία του check-in. Παρακαλώ δοκιμάστε ξανά.'
        : '❌ Error processing check-in. Please try again.';
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  // Handle working user check-out
  public async handleWorkingUserCheckOut(chatId: number, userId: number, userName: string, messageId?: number): Promise<void> {
    try {
      // Get user's language
      const userLang = await this.getUserLanguage(userId);
      
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
      const userLang = await this.getUserLanguage(userId);
      const errorMsg = userLang === 'gr'
        ? '❌ Σφάλμα κατά την επεξεργασία του check-out. Παρακαλώ δοκιμάστε ξανά.'
        : '❌ Error processing check-out. Please try again.';
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  // Handle location validation for check-in/check-out
  private async handleLocationValidation(msg: TelegramBot.Message): Promise<void> {
    console.log(`[MessageHandler] handleLocationValidation called`);
    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const location = msg.location!;
    
    console.log(`[MessageHandler] User ${userId} location: ${location.latitude}, ${location.longitude}`);
    
    const session = checkInSessions.get(userId);
    console.log(`[MessageHandler] Session found:`, session);
    if (!session) {
      console.log(`[MessageHandler] No session found for user ${userId}`);
      return;
    }
    
    // Clear session
    checkInSessions.delete(userId);
    console.log(`[MessageHandler] Session cleared for user ${userId}`);
    
    // Get user's language
    const userLang = await this.getUserLanguage(userId);
    console.log(`[MessageHandler] User language: ${userLang}`);
    
    // Define office location (you can adjust these coordinates)
    const officeLat = 37.922504; // New office coordinates
    const officeLng = 23.932856;
    const maxDistance = 0.5; // 500 meters radius
    
    // Calculate distance between user and office
    const distance = this.calculateDistance(
      location.latitude, location.longitude,
      officeLat, officeLng
    );
    
    console.log(`[MessageHandler] User location: ${location.latitude}, ${location.longitude}`);
    console.log(`[MessageHandler] Office location: ${officeLat}, ${officeLng}`);
    console.log(`[MessageHandler] Distance: ${distance.toFixed(2)} km`);
    console.log(`[MessageHandler] Max distance: ${maxDistance} km`);
    console.log(`[MessageHandler] Is within range: ${distance <= maxDistance}`);
    
    if (distance <= maxDistance) {
      console.log(`[MessageHandler] Location valid, proceeding with action: ${session.action}`);
      // Location is valid, proceed with action
      if (session.action === 'checkin') {
        await this.processCheckIn(chatId, userId, session.userName, session.messageId);
      } else if (session.action === 'checkout') {
        await this.processCheckOut(chatId, userId, session.userName, session.messageId);
      }
    } else {
      console.log(`[MessageHandler] Location invalid, sending error message`);
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
      // Get user's language
      const userLang = await this.getUserLanguage(userId);
      
      // First, ensure user exists in WORKERS sheet
      let worker = await this.sheets.getWorkerById(userId);
      
      if (!worker) {
        // Create worker in WORKERS sheet if not exists
        console.log(`[MessageHandler] Creating new worker in WORKERS sheet for user ${userId}`);
        await this.sheets.addWorker(userName, userId, 'WORKING');
        worker = { name: userName, id: userId.toString(), status: 'WORKING' };
        console.log(`[MessageHandler] Worker created: ${worker.name}, ID: ${worker.id}, Status: ${worker.status}`);
      }
      
      // Get current month sheet name
      const sheetName = this.getCurrentMonthSheetName();
      const currentDate = this.getCurrentDate();
      
      // Find user row in month sheet using worker name
      let rowNumber = await this.findUserRowInMonthSheet(sheetName, worker.name);
      
      // If user not found, create a new row
      if (!rowNumber) {
        console.log(`[MessageHandler] User "${worker.name}" not found, creating new row in ${sheetName}`);
        
        // Get the next available row
        const rowsRaw = await this.sheets.getRows(`${sheetName}!A2:Z1000`);
        const rows = rowsRaw as string[][];
        const nextRow = rows.length + 2; // +2 because we start from A2
        
        // Add user name to the new row
        try {
          await this.sheets.updateCell(`${sheetName}!A${nextRow}`, worker.name);
          rowNumber = nextRow;
          console.log(`[MessageHandler] Created new row ${rowNumber} for user "${worker.name}"`);
        } catch (error) {
          console.error('[MessageHandler] Error creating new row:', error);
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
        const errorMsg = userLang === 'gr'
          ? '❌ Δεν βρέθηκε η στήλη της σημερινής ημερομηνίας. Παρακαλώ επικοινωνήστε με την ομάδα.'
          : '❌ Today\'s date column was not found. Please contact the team.';
        await this.bot.sendMessage(chatId, errorMsg);
        return;
      }
      
      // Convert column index to letter (A=0, B=1, etc.)
      const dateColumn = String.fromCharCode(65 + dateColumnIndex); // A=65 in ASCII
      
      // Get current time
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
      
      // Write the check-in time
      try {
        const cellRange = `${sheetName}!${dateColumn}${rowNumber}`;
        await this.sheets.updateCell(cellRange, timeString);
        
        // Show success message
        const successMsg = userLang === 'gr'
          ? `✅ Η παρουσία σας έχει καταγραφεί στις ${timeString}!\n\n👋 Καλή δουλειά! 💪`
          : `✅ Your attendance has been recorded at ${timeString}!\n\n👋 Have a great day! 💪`;
        
        // If messageId is provided, edit the original message
        if (messageId) {
          await this.bot.editMessageText(successMsg, {
            chat_id: chatId,
            message_id: messageId
          });
        } else {
          await this.bot.sendMessage(chatId, successMsg);
        }
        
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
        
        // Schedule reminder for 7.5 hours later
        const reminderTime = new Date(now.getTime() + (7.5 * 60 * 60 * 1000)); // 7.5 hours in milliseconds
        console.log(`[MessageHandler] Scheduling check-out reminder for ${reminderTime.toLocaleString()}`);
        
        // Store reminder info for later use
        setTimeout(async () => {
          try {
            const reminderMsg = userLang === 'gr'
              ? `⏰ Υπενθύμιση: Έχετε εργαστεί για 7.5 ώρες. Μήπως θέλετε να κάνετε check-out?`
              : `⏰ Reminder: You have been working for 7.5 hours. Would you like to check out?`;
            
            const reminderKeyboard = {
              inline_keyboard: [
                [{ text: userLang === 'gr' ? '🚪 Check Out' : '🚪 Check Out', callback_data: 'working_checkout' }],
                [{ text: userLang === 'gr' ? '⏰ Αργότερα' : '⏰ Later', callback_data: 'working_reminder_later' }]
              ]
            };
            
            await this.bot.sendMessage(chatId, reminderMsg, { reply_markup: reminderKeyboard });
          } catch (error) {
            console.error('[MessageHandler] Error sending reminder:', error);
          }
        }, 7.5 * 60 * 60 * 1000); // 7.5 hours delay
        
      } catch (error) {
        console.error('[MessageHandler] Error writing check-in time:', error);
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
      // Get user's language
      const userLang = await this.getUserLanguage(userId);
      
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
        const errorMsg = userLang === 'gr'
          ? '❌ Δεν βρέθηκε η στήλη της σημερινής ημερομηνίας. Παρακαλώ επικοινωνήστε με την ομάδα.'
          : '❌ Today\'s date column was not found. Please contact the team.';
        await this.bot.sendMessage(chatId, errorMsg);
        return;
      }
      
      // Convert column index to letter (A=0, B=1, etc.)
      const dateColumn = String.fromCharCode(65 + dateColumnIndex); // A=65 in ASCII
      
      // Get current time
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
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
        
        // If messageId is provided, edit the original message
        if (messageId) {
          await this.bot.editMessageText(successMsg, {
            chat_id: chatId,
            message_id: messageId
          });
        } else {
          await this.bot.sendMessage(chatId, successMsg);
        }
        
      } catch (error) {
        console.error('[MessageHandler] Error writing check-out time:', error);
        const errorMsg = userLang === 'gr'
          ? '❌ Σφάλμα κατά την καταγραφή της αποχώρησης σας. Παρακαλώ επικοινωνήστε με την ομάδα.'
          : '❌ Error recording your check-out. Please contact the team.';
        await this.bot.sendMessage(chatId, errorMsg);
      }
      
    } catch (error) {
      console.error('[MessageHandler] Error processing check-out:', error);
      const userLang = await this.getUserLanguage(userId);
      const errorMsg = userLang === 'gr'
        ? '❌ Σφάλμα κατά την επεξεργασία του check-out. Παρακαλώ δοκιμάστε ξανά.'
        : '❌ Error processing check-out. Please try again.';
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  // Show main menu for working users
  public async showWorkingUserMainMenu(chatId: number, userId: number, userName: string): Promise<void> {
    const startTime = Date.now();
    console.log(`[MessageHandler] showWorkingUserMainMenu called at ${new Date().toISOString()}`);
    
    const userLang = await this.getUserLanguage(userId);
    console.log(`[MessageHandler] User language: ${userLang} at ${new Date().toISOString()}`);
    
    const keyboard = {
      inline_keyboard: [
        [{ text: userLang === 'gr' ? '📝 Log In' : '📝 Log In', callback_data: 'working_checkin' },
         { text: userLang === 'gr' ? '📞 Επικοινωνία' : '📞 Contact', callback_data: 'working_contact' }]
      ]
    };
    
    await this.bot.sendMessage(chatId, 'Choose an action:', { reply_markup: keyboard });
    console.log(`[MessageHandler] Main menu sent at ${new Date().toISOString()}, total time: ${Date.now() - startTime}ms`);
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