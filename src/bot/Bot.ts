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

  constructor(database: Database, logger: Logger) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      throw new Error('BOT_TOKEN environment variable is required');
    }

    this.database = database;
    this.logger = logger;
    
    // Initialize bot with polling
    this.bot = new TelegramBot(token, { polling: true });

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
  }

  private setupEventHandlers(): void {
    // DEBUG: Log every incoming update
    this.bot.on('message', (msg) => {
      console.log('DEBUG MESSAGE RECEIVED:', msg.text);
      if (msg.text?.startsWith('/')) {
        this.commandHandler.handleCommand(msg);
      } else {
        // Only process non-command messages if ChatRelay is not configured
        // or if it's not a private chat from a non-admin user
        if (!process.env.ADMIN_GROUP_ID || msg.chat.type !== 'private') {
          this.messageHandler.handleMessage(msg);
        }
        // If ADMIN_GROUP_ID is set and it's a private chat, let ChatRelay handle it
      }
    });

    // DEBUG: Log callback queries
    this.bot.on('callback_query', (q) => {
      console.log('DEBUG CALLBACK RECEIVED:', q.data);
      this.callbackQueryHandler.handleCallbackQuery(q);
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

  async start(): Promise<void> {
    try {
      // Set bot commands
      await this.bot.setMyCommands([
        { command: 'start', description: 'Start the bot' },
        { command: 'help', description: 'Show help information' },
        { command: 'settings', description: 'Manage your settings' },
        { command: 'stats', description: 'View your statistics' },
        { command: 'admin', description: 'Admin commands (admin only)' }
      ]);

      this.logger.info('Bot commands set successfully');
    } catch (error) {
      this.logger.error('Failed to set bot commands:', error);
    }
  }

  async stop(): Promise<void> {
    await this.bot.stopPolling();
    this.logger.info('Bot stopped');
  }
} 