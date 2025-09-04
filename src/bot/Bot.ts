// @ts-ignore
import TelegramBot from 'node-telegram-bot-api';
import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
import { CommandHandler } from './CommandHandler';
import { MessageHandler } from './MessageHandler';
import { CallbackQueryHandler } from './CallbackQueryHandler';

// Node.js globals
declare const process: any;
declare const console: any;
declare const setInterval: any;

export class Bot {
  private bot: TelegramBot;
  private database: Database;
  private logger: Logger;
  private sheetsClient: GoogleSheetsClient | undefined;
  private commandHandler: CommandHandler;
  private messageHandler: MessageHandler;
  private callbackQueryHandler: CallbackQueryHandler;
  private lastUserCommands: Map<number, { command: string; timestamp: number }> = new Map(); // Track last command per user
  
  // Persistent contact button keyboard
  private readonly persistentContactKeyboard = {
    keyboard: [[
      { text: "📱 Contact @DenisZgl", request_contact: false }
    ]],
    resize_keyboard: true,
    persistent: true,
    one_time_keyboard: false
  } as TelegramBot.SendMessageOptions['reply_markup'];

  constructor(database: Database, logger: Logger, sheetsClient?: GoogleSheetsClient) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      throw new Error('BOT_TOKEN environment variable is required');
    }

    this.database = database;
    this.logger = logger;
    this.sheetsClient = sheetsClient;
    
    // Initialize bot with webhook for Render.com
    this.bot = new TelegramBot(token, { webHook: { port: 3000 } });

    // Patch answerCallbackQuery globally to ignore "query is too old" errors
    const originalAnswer = this.bot.answerCallbackQuery.bind(this.bot);
    this.bot.answerCallbackQuery = ((callbackId: string, options?: TelegramBot.AnswerCallbackQueryOptions) => {
      return originalAnswer(callbackId, options).catch((err: any) => {
        if (err?.code === 'ETELEGRAM' && /query is too old/i.test(err.message)) {
          // ignore silently
          return undefined as any;
        }
        throw err;
      });
    }) as any;
    
    // Initialize handlers
    this.commandHandler = new CommandHandler(this.bot, this.database, this.logger, this.sheetsClient);
    this.messageHandler = new MessageHandler(this.bot, this.database, this.logger, this.sheetsClient);
    this.callbackQueryHandler = new CallbackQueryHandler(this.bot, this.database, this.logger, this.sheetsClient);
    
    this.setupEventHandlers();
    this.setupMemoryCleanup();
  }

  // Setup memory cleanup to prevent leaks
  private setupMemoryCleanup(): void {
    // Clean up lastUserCommands every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const ttl = 10 * 60 * 1000; // 10 minutes TTL
      let cleanedCount = 0;
      
      for (const [userId, data] of this.lastUserCommands) {
        if (now - data.timestamp > ttl) {
          this.lastUserCommands.delete(userId);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`[Bot] Memory cleanup: Removed ${cleanedCount} expired command entries`);
      }
      
      // Also enforce size limit
      if (this.lastUserCommands.size > 200) {
        const entries = Array.from(this.lastUserCommands.entries());
        const sortedEntries = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        this.lastUserCommands = new Map(sortedEntries.slice(0, 100));
        console.log(`[Bot] Memory cleanup: Reduced command cache from ${entries.length} to 100 entries`);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private setupEventHandlers(): void {
    // Remove all event handlers - they don't work in webhook mode
    // Instead, we handle everything through the webhook system

    // Handle errors
    this.bot.on('error', (error: any) => {
      this.logger.error('Bot error:', error);
    });

    // Handle polling errors
    this.bot.on('polling_error', (error: any) => {
      this.logger.error('Polling error:', error);

      // Gracefully shut down if another instance is already polling (Telegram error 409)
      const statusCode = (error as any)?.response?.statusCode ?? (error as any)?.response?.body?.error_code;
      if ((error as any)?.code === 'ETELEGRAM' && statusCode === 409) {
        this.logger.warn('Another bot instance detected. Shutting down this instance.');
        // Exit without error so orchestrators (e.g. nodemon, pm2) don't restart immediately
        process.exit(0);
      }
    });
  }

  private async routeCommand(msg: TelegramBot.Message): Promise<void> {
    const chatType = msg.chat.type;
    const text = msg.text;
    if (!text) return;
    
    const command = text.split(' ')[0]?.toLowerCase();
    if (!command) return;
    
    // Special handling for /start command
    if (command === '/start') {
      if (chatType === 'private') {
        // Private chat: Handle new candidate registration
        console.log(`[DEBUG] /start command from new candidate, handling registration`);
        await this.routeMessage(msg);
        return;
      } else if (chatType === 'group' || chatType === 'supergroup') {
        // Group chat: Handle admin start command
        await this.commandHandler.handleCommand(msg);
        return;
      }
    }
    
    // Handle all other commands
    await this.commandHandler.handleCommand(msg);
  }

  // Get the bot instance for other services to use
  public getBotInstance(): TelegramBot {
    return this.bot;
  }

  // Send persistent contact button to user
  private async sendPersistentContactButton(chatId: number): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, "📱 Need help? Contact me anytime! Tap the button below to open a chat with @DenisZgl", {
        reply_markup: this.persistentContactKeyboard
      });
    } catch (error) {
      console.error('[Bot] Error sending persistent contact button:', error);
    }
  }

  private async routeMessage(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || '';
    const chatType = msg.chat.type;

    console.log(`[DEBUG] Routing message from user ${userId} in ${chatType} chat: ${text}`);

    // Check if user is in any active flow
    const { candidateSessions } = await import('./CandidateStep1Flow');
    const { adminSessions } = await import('./AdminStep2Flow');
    const { courseSessions } = await import('./CandidateCourseFlow');
    const isInCandidateFlow = candidateSessions.has(userId);
    const isInAdminFlow = adminSessions.has(userId);
    const isInCourseFlow = courseSessions.has(userId);

    console.log(`[DEBUG] User ${userId} in candidate flow: ${isInCandidateFlow}, admin flow: ${isInAdminFlow}, course flow: ${isInCourseFlow}`);

    // If user is in any active flow, let that flow handle the message
    if (isInCandidateFlow || isInAdminFlow || isInCourseFlow) {
      console.log(`[DEBUG] User ${userId} is in active flow, routing message to flow handler`);
      
      if (isInCandidateFlow && (this as any).candidateStep1Flow) {
        console.log(`[DEBUG] Routing message to CandidateStep1Flow`);
        await (this as any).candidateStep1Flow.handleMessage(msg);
        return;
      }
      
      if (isInAdminFlow && (this as any).adminStep2Flow) {
        console.log(`[DEBUG] Routing message to AdminStep2Flow`);
        await (this as any).adminStep2Flow.handleMessage(msg);
        return;
      }
      
      if (isInCourseFlow && (this as any).candidateCourseFlow) {
        console.log(`[DEBUG] Routing message to CandidateCourseFlow`);
        await (this as any).candidateCourseFlow.handleMessage(msg);
        return;
      }
    }

    // Route based on chat type and content
    if (chatType === 'private') {
      // Private chat - handle candidate registration or general messages
      if (text.startsWith('/start')) {
        console.log(`[DEBUG] /start command in private chat, calling CandidateStep1Flow`);
        
        // Use the stored CandidateStep1Flow instance
        try {
          if ((this as any).candidateStep1Flow) {
            await (this as any).candidateStep1Flow.handleStartCommand(msg);
            // Send persistent contact button after starting the flow
            await this.sendPersistentContactButton(chatId);
            return;
          } else {
            console.error('[DEBUG] CandidateStep1Flow not initialized');
            this.messageHandler.handleMessage(msg);
            return;
          }
        } catch (error) {
          console.error('[DEBUG] Error calling CandidateStep1Flow:', error);
          // Fallback to MessageHandler
          this.messageHandler.handleMessage(msg);
        }
        return;
      }
      
      // General message in private chat
      this.messageHandler.handleMessage(msg);
    } else if (chatType === 'supergroup' || chatType === 'group') {
      // Group chat - handle admin commands
      if (text.startsWith('/')) {
        console.log(`[DEBUG] Group chat with command: ${text}`);
        
        // Route admin commands to AdminStep2Flow
        if ((this as any).adminStep2Flow) {
          if (text === '/pending2') {
            await (this as any).adminStep2Flow.handlePending2Command(msg);
            return;
          } else if (text === '/reschedule') {
            await (this as any).adminStep2Flow.handleRescheduleCommand(msg);
            return;
          } else if (text.match(/^\/step2_(\d+)$/)) {
            const match = text.match(/^\/step2_(\d+)$/);
            if (match && match[1]) {
              const row = parseInt(match[1], 10);
              await (this as any).adminStep2Flow.handleStep2RowCommand(msg, row);
              return;
            }
          }
        }
        
        // If no admin command matched, let MessageHandler handle it
        this.messageHandler.handleMessage(msg);
        return;
      }
      
      // General message in group chat
      this.messageHandler.handleMessage(msg);
    }
  }

  async start(): Promise<void> {
    try {
      const webhookUrl = process.env.WEBHOOK_URL;
      if (!webhookUrl) {
        throw new Error('WEBHOOK_URL environment variable is required');
      }
      
      // Delete webhook first
      await this.bot.deleteWebHook();
      
      // Set webhook
      await this.bot.setWebHook(webhookUrl);
      
      // Set commands for both working users and admins
      await this.bot.setMyCommands([
        { command: 'start', description: 'Log In / Contact Crew' },
        { command: 'reschedule', description: 'Handle course reschedule requests' },
        { command: 'pending2', description: 'View pending candidates' }
      ]);
      
      this.logger.info('Bot started with webhook at: ' + webhookUrl);
    } catch (error) {
      this.logger.error('Failed to start bot:', error);
    }
  }

  // Method to handle webhook updates from Express
  handleWebhookUpdate(update: any): void {
    try {
      if (update.message) {
        // Route all messages through the normal flow
        this.routeMessage(update.message);
      } else if (update.callback_query) {
        // Route callback queries to appropriate flow handlers
        this.routeCallbackQuery(update.callback_query);
      }
    } catch (error) {
      this.logger.error('Error handling webhook update:', error);
    }
  }

  // Route callback queries to appropriate flow handlers
  private async routeCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    try {
      if (!query.from) return;
      
      const userId = query.from.id;
      console.log(`[DEBUG] Routing callback query: ${query.data} from user ${userId}`);
      
      // Check if user is in any active flow
      const { candidateSessions } = await import('./CandidateStep1Flow');
      const { adminSessions } = await import('./AdminStep2Flow');
      const { courseSessions } = await import('./CandidateCourseFlow');
      
      const isInCandidateFlow = candidateSessions.has(userId);
      const isInAdminFlow = adminSessions.has(userId);
      const isInCourseFlow = courseSessions.has(userId);
      
      console.log(`[DEBUG] User ${userId} in candidate flow: ${isInCandidateFlow}, admin flow: ${isInAdminFlow}, course flow: ${isInCourseFlow}`);
      
      // Check if this is an admin-related callback that should go to AdminStep2Flow
      const isAdminCallback = query.data && (
        query.data.startsWith('step2_') || 
        query.data.startsWith('a2_') || 
        query.data.startsWith('cdate_') || 
        query.data === 'rej_only' || 
        query.data === 'rej_alt' ||
        query.data.startsWith('reschedule_')
      );
      
      // Check if this is a course-related callback that should go to CandidateCourseFlow
      const isCourseCallback = query.data && (
        query.data.startsWith('course_') || 
        query.data.startsWith('alt_')
      );
      
      // Route callback query to appropriate flow
      if (isInCandidateFlow && (this as any).candidateStep1Flow) {
        console.log(`[DEBUG] Routing callback query to CandidateStep1Flow`);
        await (this as any).candidateStep1Flow.handleCallbackQuery(query);
        return;
      }
      
      if ((isInAdminFlow || isAdminCallback) && (this as any).adminStep2Flow) {
        console.log(`[DEBUG] Routing callback query to AdminStep2Flow (admin flow: ${isInAdminFlow}, admin callback: ${isAdminCallback})`);
        await (this as any).adminStep2Flow.handleCallbackQuery(query);
        return;
      }
      
      if ((isInCourseFlow || isCourseCallback) && (this as any).candidateCourseFlow) {
        console.log(`[DEBUG] Routing callback query to CandidateCourseFlow (course flow: ${isInCourseFlow}, course callback: ${isCourseCallback})`);
        await (this as any).candidateCourseFlow.handleCallbackQuery(query);
        return;
      }
      
      // If not in any flow, use the default callback query handler
      console.log(`[DEBUG] No active flow, using default callback query handler`);
      this.callbackQueryHandler.handleCallbackQuery(query);
      
    } catch (error) {
      console.error('[DEBUG] Error routing callback query:', error);
      // Fallback to default handler
      this.callbackQueryHandler.handleCallbackQuery(query);
    }
  }

  async stop(): Promise<void> {
    await this.bot.stopPolling();
    this.logger.info('Bot stopped');
  }
} 