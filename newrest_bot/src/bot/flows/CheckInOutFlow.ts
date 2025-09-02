import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../../utils/GoogleSheetsClient';
import { Logger } from '../../utils/Logger';

export class CheckInOutFlow {
  private bot: TelegramBot;
  private sheetsClient: GoogleSheetsClient;
  private logger: Logger;

  constructor(bot: TelegramBot, sheetsClient: GoogleSheetsClient, logger: Logger) {
    this.bot = bot;
    this.sheetsClient = sheetsClient;
    this.logger = logger;
  }

  async start(chatId: number, userId: number): Promise<void> {
    try {
      this.logger.info(`Starting check-in/out flow for user ${userId}`);
      
      // Show working user main menu
      await this.showMainMenu(chatId, userId);
      
    } catch (error) {
      this.logger.error(`Error starting check-in/out flow for user ${userId}:`, error);
      await this.bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
  }

  private async showMainMenu(chatId: number, userId: number): Promise<void> {
    // Get user info from sheets
    const userInfo = await this.sheetsClient.getWorkersSheet();
    const userRow = userInfo.find(row => row[1] === userId.toString());
    const userName = userRow ? userRow[0] : 'Worker';
    
    const message = `Welcome back, ${userName}! What would you like to do?`;
    const keyboard = {
      keyboard: [
        [
          { text: '📝 Check-in' },
          { text: '🚪 Check-out' }
        ],
        [
          { text: '📱 Contact Support' }
        ]
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: false
    };

    await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }

  public async handleCheckIn(chatId: number, _userId: number): Promise<void> {
    await this.bot.sendMessage(chatId, '📝 Check-in functionality coming soon...');
  }

  public async handleCheckOut(chatId: number, _userId: number): Promise<void> {
    await this.bot.sendMessage(chatId, '🚪 Check-out functionality coming soon...');
  }

  public async handleContactSupport(chatId: number, _userId: number): Promise<void> {
    const keyboard = {
      inline_keyboard: [
        [
          { 
            text: '📱 Contact Support', 
            url: 'https://t.me/DenisZgl'
          }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, 'Click the button below to contact support:', { 
      reply_markup: keyboard 
    });
  }
}
