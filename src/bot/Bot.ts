import TelegramBot from 'node-telegram-bot-api';
import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';
import { CommandHandler } from './CommandHandler';
import { MessageHandler } from './MessageHandler';
import { CallbackQueryHandler } from './CallbackQueryHandler';

export class Bot {
  private bot: TelegramBot;
  private database: Database;
  private logger: Logger;
  private commandHandler: CommandHandler;
  private messageHandler: MessageHandler;
  private callbackQueryHandler: CallbackQueryHandler;
  private lastUserCommands: Map<number, { command: string; timestamp: number }> = new Map(); // Track last command per user

  constructor(database: Database, logger: Logger) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      throw new Error('BOT_TOKEN environment variable is required');
    }

    this.database = database;
    this.logger = logger;
    
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
    this.commandHandler = new CommandHandler(this.bot, this.database, this.logger);
    this.messageHandler = new MessageHandler(this.bot, this.database, this.logger);
    this.callbackQueryHandler = new CallbackQueryHandler(this.bot, this.database, this.logger);
    
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
    // Single message handler that routes to appropriate handler
    this.bot.on('message', async (msg) => {
      if (!msg.from) return;
      
      const text = msg.text?.trim() || '';
      const chatType = msg.chat.type;
      const userId = msg.from.id;
      
      // Check if this user sent the same command recently (within 3 seconds)
      const lastCommand = this.lastUserCommands.get(userId);
      const now = Date.now();
      
      if (lastCommand && lastCommand.command === text && (now - lastCommand.timestamp) < 3000) {
        console.log(`[Bot] Duplicate command from user ${userId} detected, skipping: ${text}`);
        return;
      }
      
      // Update last command for this user
      this.lastUserCommands.set(userId, { command: text, timestamp: now });
      
      // Clean up old entries (keep only last 100 users)
      if (this.lastUserCommands.size > 100) {
        const entries = Array.from(this.lastUserCommands.entries());
        const sortedEntries = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        this.lastUserCommands = new Map(sortedEntries.slice(0, 50));
      }
      
      console.log(`[Bot] Received message from user ${userId}:`, {
        hasText: !!msg.text,
        hasLocation: !!msg.location,
        text: text,
        location: msg.location
      });
      
      // Skip /start commands - let CandidateStep1Flow handle them directly
      if (text.startsWith('/start')) {
        console.log(`[Bot] Skipping /start command - CandidateStep1Flow will handle it`);
        return;
      }
      
      // Route commands to appropriate handler
      if (text.startsWith('/')) {
        await this.routeCommand(msg);
        return;
      }
      
      // Route non-command messages through centralized router
      await this.routeMessage(msg);
    });

    // Single callback query handler
    this.bot.on('callback_query', async (query) => {
      await this.callbackQueryHandler.handleCallbackQuery(query);
    });

    // Handle errors
    this.bot.on('error', (error) => {
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

    // Route based on chat type and content
    if (chatType === 'private') {
      // Private chat - handle candidate registration or general messages
      if (text.startsWith('/start')) {
        console.log(`[DEBUG] /start command in private chat, calling CandidateStep1Flow`);
        
        // Use the stored CandidateStep1Flow instance
        try {
          if ((this as any).candidateStep1Flow) {
            await (this as any).candidateStep1Flow.handleStartCommand(msg);
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
        // Let AdminStep2Flow handle admin commands
        return;
      }
      
      // General message in group chat
      this.messageHandler.handleMessage(msg);
    }
  }

  async start(): Promise<void> {
    try {
      const webhookUrl = `https://telegram-bot-5kmf.onrender.com/webhook`;
      await this.bot.setWebHook(webhookUrl);
      
      // Set a custom start command that's more appropriate for working users
      await this.bot.setMyCommands([
        { command: 'start', description: 'Log In / Contact Crew' }
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
      
      // Route callback query to appropriate flow
      if (isInCandidateFlow && (this as any).candidateStep1Flow) {
        console.log(`[DEBUG] Routing callback query to CandidateStep1Flow`);
        await (this as any).candidateStep1Flow.handleCallbackQuery(query);
        return;
      }
      
      if (isInAdminFlow && (this as any).adminStep2Flow) {
        console.log(`[DEBUG] Routing callback query to AdminStep2Flow`);
        // AdminStep2Flow handles its own callbacks through setupHandlers
        return;
      }
      
      if (isInCourseFlow && (this as any).candidateCourseFlow) {
        console.log(`[DEBUG] Routing callback query to CandidateCourseFlow`);
        // CandidateCourseFlow handles its own callbacks through setupHandlers
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