import TelegramBot from 'node-telegram-bot-api';
import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';
import { UserService } from '../services/UserService';

export class CallbackQueryHandler {
  private bot: TelegramBot;
  private database: Database;
  private logger: Logger;
  private userService: UserService;

  constructor(bot: TelegramBot, database: Database, logger: Logger) {
    this.bot = bot;
    this.database = database;
    this.logger = logger;
    this.userService = new UserService(database);
  }

  async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    if (!query.data || !query.from) return;

    const chatId = query.message?.chat.id;
    const userId = query.from.id;
    const callbackData = query.data;

    this.logger.info(`Callback query received: ${callbackData} from user ${userId}`);

    try {
      // Answer the callback query to remove loading state
      await this.bot.answerCallbackQuery(query.id);

      if (!chatId) {
        this.logger.error('No chat ID found in callback query');
        return;
      }

      // Process the callback data
      await this.processCallbackData(chatId, userId, callbackData);

    } catch (error) {
      this.logger.error(`Error handling callback query ${callbackData}:`, error);
      await this.bot.answerCallbackQuery(query.id, { text: 'Error processing request' });
    }
  }

  private async processCallbackData(chatId: number, userId: number, callbackData: string): Promise<void> {
    // Split callback data to handle parameters
    const [action, ...params] = callbackData.split('_');

    switch (action) {
      case 'settings':
        await this.handleSettingsCallback(chatId, userId, params);
        break;
      case 'admin':
        await this.handleAdminCallback(chatId, userId, params);
        break;
      case 'help':
        await this.handleHelpCallback(chatId, userId, params);
        break;
      case 'stats':
        await this.handleStatsCallback(chatId, userId, params);
        break;
      // Language selection is handled by CandidateStep1Flow; ignore here to avoid duplicate "Unknown action" replies
      case 'lang':
      case 'ans':
      case 'review':
      case 'step2':
      case 'a2':
      case 'cdate':
      case 'course':
      case 'alt':
      case 'decline':
      case 'rej':
      case 'reply':
        // Handled elsewhere (CandidateStep1Flow or AdminStep2Flow)
        break;
      default:
        // Silently ignore callbacks that are handled by other modules but not explicitly listed above.
        return;
    }
  }

  private async handleSettingsCallback(chatId: number, userId: number, params: string[]): Promise<void> {
    if (params.length === 0) {
      await this.bot.sendMessage(chatId, 'Invalid settings action.');
      return;
    }

    const setting = params[0];

    switch (setting) {
      case 'notifications':
        await this.handleNotificationSettings(chatId, userId);
        break;
      case 'language':
        await this.handleLanguageSettings(chatId, userId);
        break;
      case 'reset_stats':
        await this.handleResetStats(chatId, userId);
        break;
      case 'delete_data':
        await this.handleDeleteData(chatId, userId);
        break;
      case 'close':
        await this.handleCloseSettings(chatId);
        break;
      default:
        await this.bot.sendMessage(chatId, 'Unknown setting option.');
    }
  }

  private async handleNotificationSettings(chatId: number, userId: number): Promise<void> {
    const user = await this.userService.getUser(userId);
    if (!user) {
      await this.bot.sendMessage(chatId, 'User not found. Please use /start first.');
      return;
    }

    const message = `
🔔 Notification Settings

Current settings:
• Daily reminders: ${user.notifications?.dailyReminders ? '✅' : '❌'}
• Weekly reports: ${user.notifications?.weeklyReports ? '✅' : '❌'}
• Updates: ${user.notifications?.updates ? '✅' : '❌'}

Choose what you'd like to change:
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { 
            text: `${user.notifications?.dailyReminders ? '🔕' : '🔔'} Daily Reminders`, 
            callback_data: 'settings_notifications_daily' 
          }
        ],
        [
          { 
            text: `${user.notifications?.weeklyReports ? '🔕' : '🔔'} Weekly Reports`, 
            callback_data: 'settings_notifications_weekly' 
          }
        ],
        [
          { 
            text: `${user.notifications?.updates ? '🔕' : '🔔'} Updates`, 
            callback_data: 'settings_notifications_updates' 
          }
        ],
        [
          { text: '⬅️ Back', callback_data: 'settings_back' },
          { text: '❌ Close', callback_data: 'settings_close' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }

  private async handleLanguageSettings(chatId: number, userId: number): Promise<void> {
    const message = `
🌍 Language Settings

Choose your preferred language:

Note: Language support is coming soon!
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🇺🇸 English', callback_data: 'settings_language_en' },
          { text: '🇪🇸 Español', callback_data: 'settings_language_es' }
        ],
        [
          { text: '🇫🇷 Français', callback_data: 'settings_language_fr' },
          { text: '🇩🇪 Deutsch', callback_data: 'settings_language_de' }
        ],
        [
          { text: '🇷🇺 Русский', callback_data: 'settings_language_ru' },
          { text: '🇨🇳 中文', callback_data: 'settings_language_zh' }
        ],
        [
          { text: '⬅️ Back', callback_data: 'settings_back' },
          { text: '❌ Close', callback_data: 'settings_close' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }

  private async handleResetStats(chatId: number, userId: number): Promise<void> {
    const message = `
📊 Reset Statistics

⚠️ Warning: This action will permanently delete your usage statistics.

Are you sure you want to reset your stats?

This will reset:
• Message count
• Command count
• Usage history
• Activity data
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Yes, Reset', callback_data: 'settings_reset_stats_confirm' },
          { text: '❌ Cancel', callback_data: 'settings_back' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }

  private async handleDeleteData(chatId: number, userId: number): Promise<void> {
    const message = `
🗑️ Delete All Data

⚠️ DANGER: This action will permanently delete ALL your data from the bot.

This includes:
• User profile
• All statistics
• Settings
• Activity history
• Everything else

This action cannot be undone!

Are you absolutely sure?
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🚨 YES, DELETE EVERYTHING', callback_data: 'settings_delete_data_confirm' }
        ],
        [
          { text: '❌ Cancel', callback_data: 'settings_back' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }

  private async handleCloseSettings(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 'Settings closed. Use /settings to open again.');
  }

  private async handleAdminCallback(chatId: number, userId: number, params: string[]): Promise<void> {
    // This would handle admin-specific callback queries
    // Implementation depends on admin features
    await this.bot.sendMessage(chatId, 'Admin callback received. Feature coming soon!');
  }

  private async handleHelpCallback(chatId: number, userId: number, params: string[]): Promise<void> {
    if (params.length === 0) {
      await this.bot.sendMessage(chatId, 'Help callback received. Use /help for assistance.');
      return;
    }

    const helpTopic = params[0];

    switch (helpTopic) {
      case 'commands':
        await this.showCommandsHelp(chatId);
        break;
      case 'features':
        await this.showFeaturesHelp(chatId);
        break;
      case 'troubleshooting':
        await this.showTroubleshootingHelp(chatId);
        break;
      default:
        await this.bot.sendMessage(chatId, 'Unknown help topic. Use /help for general assistance.');
    }
  }

  private async showCommandsHelp(chatId: number): Promise<void> {
    const message = `
📋 Commands Help

Available commands:

🔹 /start - Initialize the bot and register your account
🔹 /help - Show this help information
🔹 /settings - Manage your preferences and account settings
🔹 /stats - View your usage statistics and activity
🔹 /admin - Access admin panel (admin users only)

💡 Tip: Commands are case-insensitive and can be used anywhere in the chat.
    `.trim();

    await this.bot.sendMessage(chatId, message);
  }

  private async showFeaturesHelp(chatId: number): Promise<void> {
    const message = `
🚀 Features Help

What this bot can do:

💬 Chat Features:
• Respond to greetings and questions
• Provide time and date information
• Tell jokes and entertain
• Handle various message types

⚙️ Management:
• User registration and profiles
• Settings customization
• Statistics tracking
• Activity monitoring

🔧 Technical:
• Inline keyboards for easy interaction
• Callback query handling
• Error recovery
• Logging and monitoring

💡 Tip: Try sending different types of messages to explore features!
    `.trim();

    await this.bot.sendMessage(chatId, message);
  }

  private async showTroubleshootingHelp(chatId: number): Promise<void> {
    const message = `
🔧 Troubleshooting Help

Common issues and solutions:

❓ Bot not responding:
• Make sure you've used /start first
• Check your internet connection
• Try restarting the conversation

❓ Commands not working:
• Ensure you're typing commands correctly
• Check if you have the required permissions
• Try using /help for command list

❓ Settings not saving:
• Make sure you're registered (/start)
• Check your internet connection
• Contact admin if problem persists

❓ Error messages:
• Note the error code if shown
• Try the action again
• Contact support if repeated

💡 Need more help? Contact the bot administrator.
    `.trim();

    await this.bot.sendMessage(chatId, message);
  }

  private async handleStatsCallback(chatId: number, userId: number, params: string[]): Promise<void> {
    // This would handle stats-related callback queries
    await this.bot.sendMessage(chatId, 'Stats callback received. Use /stats for your statistics.');
  }
} 