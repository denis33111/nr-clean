import TelegramBot from 'node-telegram-bot-api';
import { RegistrationFlow } from './flows/RegistrationFlow';
import { CheckInOutFlow } from './flows/CheckInOutFlow';
import { UserRecognitionService } from '../services/UserRecognitionService';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
import { Logger } from '../utils/Logger';
import { AdminNotificationService } from '../services/AdminNotificationService';
import { AdminStep2Flow } from './flows/AdminStep2Flow';
import { ReminderService } from '../services/ReminderService';

import { WorkingUserService } from '../services/WorkingUserService';


export class Bot {
  private bot: TelegramBot;
  private logger: Logger;

  private userRecognition: UserRecognitionService;
  private registrationFlow: RegistrationFlow;
  private checkInOutFlow: CheckInOutFlow;
  private adminNotificationService: AdminNotificationService;
  private adminStep2Flow: AdminStep2Flow;
  private reminderService: ReminderService;

  private workingUserService: WorkingUserService;

  constructor(logger: Logger, sheetsClient: GoogleSheetsClient) {
    const token = process.env['BOT_TOKEN'];
    if (!token) {
      throw new Error('BOT_TOKEN environment variable is required');
    }

    this.logger = logger;
    
    // Check if webhook URL is configured
    const webhookUrl = process.env['WEBHOOK_URL'];
    
    if (webhookUrl) {
      // Production: Use webhook mode
      this.bot = new TelegramBot(token, { polling: false });
      this.logger.info(`Bot configured for webhook mode with URL: ${webhookUrl}`);
    } else {
      // Local development: Use polling mode
      this.bot = new TelegramBot(token, { polling: true });
      this.logger.info('Bot configured for polling mode (local development)');
    }
    
    // Initialize services
    this.userRecognition = new UserRecognitionService(sheetsClient);
    this.adminNotificationService = new AdminNotificationService(this.bot);
    this.registrationFlow = new RegistrationFlow(this.bot, sheetsClient, logger, this.adminNotificationService);
    this.checkInOutFlow = new CheckInOutFlow(this.bot, sheetsClient, logger);
    this.adminStep2Flow = new AdminStep2Flow(this.bot, sheetsClient, logger);
    this.reminderService = new ReminderService(this.bot, sheetsClient, logger);

    this.workingUserService = new WorkingUserService(this.bot, sheetsClient, logger);
    
    this.setupEventHandlers();
    
    // Start the reminder scheduler
    this.reminderService.start();
    

  }

  private setupEventHandlers(): void {
    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      try {
        await this.handleStartCommand(msg);
      } catch (error) {
        this.logger.error('Error handling /start command:', error);
      }
    });

    // Handle admin commands
    this.bot.onText(/\/pending2/, async (msg) => {
      try {
        await this.adminStep2Flow.handlePending2Command(msg);
      } catch (error) {
        this.logger.error('Error handling /pending2 command:', error);
      }
    });

    // Handle test reminder command
    this.bot.onText(/\/testreminder/, async (msg) => {
      try {
        this.logger.info('[Bot] Test reminder command triggered');
        await this.bot.sendMessage(msg.chat.id, '✅ Test reminder command received. Reminders are now handled automatically every 5 minutes.');
      } catch (error) {
        this.logger.error('Error handling /testreminder command:', error);
        await this.bot.sendMessage(msg.chat.id, '❌ Error processing test reminder. Check logs for details.');
      }
    });

    // Handle force reminder command - immediately trigger all reminder checks
    this.bot.onText(/\/forcereminder/, async (msg) => {
      try {
        this.logger.info('[Bot] Force reminder command triggered by user', msg.from?.id);
        await this.bot.sendMessage(msg.chat.id, '🔄 Force checking all reminders now...');
        
        // Force immediate reminder check
        await this.reminderService.forceReminderCheck();
        
        await this.bot.sendMessage(msg.chat.id, '✅ Force reminder check completed! Check your messages for any reminders.');
      } catch (error) {
        this.logger.error('Error handling /forcereminder command:', error);
        await this.bot.sendMessage(msg.chat.id, '❌ Error processing force reminder. Check logs for details.');
      }
    });

    // Handle test course day command
    this.bot.onText(/\/testcourseday/, async (msg) => {
      try {
        this.logger.info('[Bot] Test course day command triggered');
        await this.bot.sendMessage(msg.chat.id, '✅ Test course day command received. Course day reminders are handled automatically.');
      } catch (error) {
        this.logger.error('Error handling /testcourseday command:', error);
        await this.bot.sendMessage(msg.chat.id, '❌ Error processing test course day. Check logs for details.');
      }
    });

    // Handle contact button
    this.bot.onText(/📱 Contact Support|📱 Επικοινωνία Υποστήριξης/, async (msg) => {
      try {
        await this.handleContactButton(msg);
      } catch (error) {
        this.logger.error('Error handling contact button:', error);
      }
    });

    // Handle callback queries for admin flows
    this.bot.on('callback_query', async (query) => {
      try {
        if (query.data?.startsWith('step2_')) {
          await this.adminStep2Flow.handleStep2Callback(query);
        } else if (query.data?.startsWith('a2_')) {
          await this.adminStep2Flow.handleAnswerCallback(query);
        } else if (query.data?.startsWith('cdate_')) {
          await this.adminStep2Flow.handleCourseDateCallback(query);
        } else if (query.data?.startsWith('reminder_')) {
          await this.reminderService.handleReminderCallback(query);
        } else if (query.data?.startsWith('course_')) {
          await this.reminderService.handleCourseDayCallback(query);
        } else if (query.data?.startsWith('working_')) {
          await this.workingUserService.handleWorkingUserCallback(query);
        }
      } catch (error) {
        this.logger.error('Error handling admin callback query:', error);
      }
    });

    // Handle errors
    this.bot.on('error', (error) => {
      this.logger.error('Bot error:', error);
    });

    // Handle messages for admin flows, location sharing, and check-in/out
    this.bot.on('message', async (msg) => {
      try {
        // Handle location messages for working users
        if (msg.location) {
          await this.handleLocationMessage(msg);
        }
        // Handle check-in/out messages
        else if (msg.text && !msg.text.startsWith('/')) {
          if (msg.text === '📝 Check-in') {
            await this.checkInOutFlow.handleCheckIn(msg.chat.id, msg.from!.id);
          } else if (msg.text === '🚪 Check-out') {
            await this.checkInOutFlow.handleCheckOut(msg.chat.id, msg.from!.id);
          } else if (msg.text === '📱 Contact Support') {
            await this.checkInOutFlow.handleContactSupport(msg.chat.id, msg.from!.id);
          }
          // Check if this is an admin message that needs processing
          else {
            await this.adminStep2Flow.handleMessage(msg);
          }
        }
      } catch (error) {
        this.logger.error('Error handling message:', error);
      }
    });


  }

  private async handleStartCommand(msg: TelegramBot.Message): Promise<void> {
    if (!msg.from) return;
    
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    this.logger.info(`User ${userId} started bot`);

    try {
      // Check if user is a working employee first
      const isWorkingUser = await this.workingUserService.isWorkingUser(userId);
      
      // Check if user is already registered (in WORKERS sheet)
      const isRegistered = await this.userRecognition.isUserRegistered(userId);
      
      // Log the check results
      this.logger.info(`User ${userId} working user check: ${isWorkingUser}, registration check: ${isRegistered}`);
      
      if (isWorkingUser) {
        // User is a working employee, show working user menu
        await this.workingUserService.showWorkingUserMenu(userId);
      } else if (isRegistered) {
        // User is registered but not working, go to check-in/out flow
        await this.checkInOutFlow.start(chatId, userId);
      } else {
        // User is not registered, start registration flow
        await this.registrationFlow.start(chatId, userId);
      }
    } catch (error) {
      this.logger.error(`Error handling start command for user ${userId}:`, error);
      await this.bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
  }

  private async handleLocationMessage(msg: TelegramBot.Message): Promise<void> {
    if (!msg.from || !msg.location) return;
    
    const userId = msg.from.id;
    this.logger.info(`User ${userId} shared location: ${msg.location.latitude}, ${msg.location.longitude}`);
    
    try {
      // Check if user is a working user
      const isWorkingUser = await this.workingUserService.isWorkingUser(userId);
      if (!isWorkingUser) {
        await this.bot.sendMessage(msg.chat.id, '❌ Location sharing is only available for working employees.');
        return;
      }
      
      // Get the user's current action from WorkingUserService
      const currentAction = await this.workingUserService.getCurrentUserAction(userId);
      if (!currentAction) {
        await this.bot.sendMessage(msg.chat.id, '❌ Please select check-in or check-out first.');
        return;
      }
      
      // Process based on the user's selected action
      if (currentAction === 'CHECK_IN') {
        await this.workingUserService.processCheckIn(userId);
      } else if (currentAction === 'CHECK_OUT') {
        await this.workingUserService.processCheckOut(userId);
      }
    } catch (error) {
      this.logger.error(`Error handling location message for user ${userId}:`, error);
      await this.bot.sendMessage(msg.chat.id, '❌ Error processing location. Please try again.');
    }
  }

  private async handleContactButton(msg: TelegramBot.Message): Promise<void> {
    if (!msg.from) return;
    
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    this.logger.info(`User ${userId} clicked contact button`);

    // Send contact button that redirects to admin DM
    const contactMessage = 'Click the button below to contact support:';
    const keyboard = {
      inline_keyboard: [
        [
          { 
            text: '📱 Contact Support', 
            url: 'https://t.me/DenisZgl' // Replace with your actual Telegram username
          }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, contactMessage, { reply_markup: keyboard });
  }





  async start(): Promise<void> {
    try {
      // Google Sheets already initialized in index.ts, just log connection
      this.logger.info('Google Sheets connection established');
      
      const webhookUrl = process.env['WEBHOOK_URL'];
      
      if (webhookUrl) {
        // Production: Set webhook
        await this.bot.setWebHook(webhookUrl);
        this.logger.info(`Webhook set to: ${webhookUrl}`);
        this.logger.info('Bot started with webhook mode');
      } else {
        // Local development: Handle polling errors
        this.bot.on('polling_error', (error) => {
          this.logger.error('Polling error:', error);
        });
        this.logger.info('Bot started with polling mode');
      }
    } catch (error) {
      this.logger.error('Failed to start bot:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Bot stopped');
  }

  // Method to handle webhook updates from Express
  handleWebhookUpdate(update: any): void {
    try {
      if (update.message) {
        // Handle the message directly instead of emitting
        this.handleStartCommand(update.message);
      }
    } catch (error) {
      this.logger.error('Error handling webhook update:', error);
    }
  }

  public getAdminNotificationService(): AdminNotificationService {
    return this.adminNotificationService;
  }

  public getAdminStep2Flow(): AdminStep2Flow {
    return this.adminStep2Flow;
  }

  public getReminderService(): ReminderService {
    return this.reminderService;
  }

  public getWorkingUserService(): WorkingUserService {
    return this.workingUserService;
  }
}
