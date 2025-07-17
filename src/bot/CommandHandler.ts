import TelegramBot from 'node-telegram-bot-api';
import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';
import { UserService } from '../services/UserService';
import { AdminService } from '../services/AdminService';

export class CommandHandler {
  private bot: TelegramBot;
  private database: Database;
  private logger: Logger;
  private userService: UserService;
  private adminService: AdminService;

  constructor(bot: TelegramBot, database: Database, logger: Logger) {
    this.bot = bot;
    this.database = database;
    this.logger = logger;
    this.userService = new UserService(database);
    this.adminService = new AdminService(database);
  }

  async handleCommand(msg: TelegramBot.Message | undefined): Promise<void> {
    if (!msg) return;
    if (!msg.text || !msg.from) return;
    // @ts-ignore text is guaranteed to be defined by guard above
    const text = msg.text as string;
    // @ts-ignore
    const command = text.split(' ')[0].toLowerCase();
    // @ts-ignore
    const args = text.split(' ').slice(1);
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    this.logger.info(`Command received: ${command} from user ${userId}`);
    try {
      switch (command) {
        case '/start':
          // The CandidateStep1Flow handles /start by itself (language selection etc.).
          // Suppress generic welcome message to avoid duplicate responses.
          return; // do nothing here
        case '/help':
          await this.handleHelp(msg);
          break;
        case '/settings':
          await this.handleSettings(msg);
          break;
        case '/stats':
          await this.handleStats(msg);
          break;
        case '/admin':
          await this.handleAdmin(msg, args);
          break;
        default:
          // Allow other flows to handle step2-related commands
          if (command === '/pending2' || command.startsWith('/step2_')) {
            return;
          }
          await this.bot.sendMessage(chatId, 'Unknown command. Use /help to see available commands.');
      }
    } catch (error) {
      this.logger.error(`Error handling command ${command}:`, error);
      await this.bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
  }

  private async handleStart(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const user = msg.from!;

    // Register or update user
    await this.userService.registerUser({
      id: user.id,
      username: user.username || '',
      firstName: user.first_name,
      lastName: user.last_name || '',
      isBot: user.is_bot,
      languageCode: user.language_code || ''
    });

    const welcomeMessage = `
🎉 Welcome to the Telegram Bot!

I'm here to help you with various tasks. Here's what I can do:

📋 Available Commands:
• /start - Start the bot
• /help - Show help information
• /settings - Manage your settings
• /stats - View your statistics
• /admin - Admin commands (admin only)

💡 Just send me a message or use any of the commands above to get started!

Need help? Use /help for more information.
    `.trim();

    await this.bot.sendMessage(chatId, welcomeMessage);
  }

  private async handleHelp(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;

    const helpMessage = `
🤖 Bot Help Guide

📋 Commands:
• /start - Start the bot and register
• /help - Show this help message
• /settings - Manage your preferences
• /stats - View your usage statistics
• /admin - Admin panel (admin only)

💬 Regular Messages:
• Send any text message to interact with the bot
• Use inline keyboards for quick actions

🔧 Features:
• User registration and management
• Settings customization
• Statistics tracking
• Admin controls

📞 Support:
If you need help, contact the bot administrator.
    `.trim();

    await this.bot.sendMessage(chatId, helpMessage);
  }

  private async handleSettings(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const user = await this.userService.getUser(userId);
    if (!user) {
      await this.bot.sendMessage(chatId, 'Please use /start first to register.');
      return;
    }

    const settingsMessage = `
⚙️ Your Settings

👤 User Info:
• ID: ${user.id}
• Username: ${user.username || 'Not set'}
• Name: ${user.firstName} ${user.lastName || ''}
• Language: ${user.languageCode || 'Not set'}

📊 Statistics:
• Messages sent: ${user.messageCount || 0}
• Commands used: ${user.commandCount || 0}
• Last active: ${user.lastActive ? new Date(user.lastActive).toLocaleString() : 'Never'}

🔧 Settings Options:
(Inline keyboard will be added here)
    `.trim();

    // Create inline keyboard for settings
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔔 Notifications', callback_data: 'settings_notifications' },
          { text: '🌍 Language', callback_data: 'settings_language' }
        ],
        [
          { text: '📊 Reset Stats', callback_data: 'settings_reset_stats' },
          { text: '🗑️ Delete Data', callback_data: 'settings_delete_data' }
        ],
        [
          { text: '❌ Close', callback_data: 'settings_close' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, settingsMessage, { reply_markup: keyboard });
  }

  private async handleStats(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const user = await this.userService.getUser(userId);
    if (!user) {
      await this.bot.sendMessage(chatId, 'Please use /start first to register.');
      return;
    }

    const statsMessage = `
📊 Your Statistics

👤 User Activity:
• Total messages: ${user.messageCount || 0}
• Commands used: ${user.commandCount || 0}
• Registration date: ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
• Last active: ${user.lastActive ? new Date(user.lastActive).toLocaleString() : 'Never'}

📈 Usage Summary:
• Most used command: ${user.mostUsedCommand || 'None'}
• Average messages per day: ${this.calculateAverageMessages(user) || 0}

🎯 Achievements:
• First message: ${user.messageCount && user.messageCount > 0 ? '✅' : '❌'}
• Regular user: ${user.messageCount && user.messageCount > 10 ? '✅' : '❌'}
• Power user: ${user.messageCount && user.messageCount > 50 ? '✅' : '❌'}
    `.trim();

    await this.bot.sendMessage(chatId, statsMessage);
  }

  private async handleAdmin(msg: TelegramBot.Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    // Check if user is admin
    const isAdmin = await this.adminService.isAdmin(userId);
    if (!isAdmin) {
      await this.bot.sendMessage(chatId, '❌ Access denied. Admin privileges required.');
      return;
    }

    if (args.length === 0) {
      const adminMessage = `
🔧 Admin Panel

Available admin commands:
• /admin stats - View bot statistics
• /admin users - List all users
• /admin broadcast <message> - Send message to all users
• /admin user <id> - Get user info
• /admin ban <id> - Ban user
• /admin unban <id> - Unban user

Usage: /admin <command> [arguments]
      `.trim();

      await this.bot.sendMessage(chatId, adminMessage);
      return;
    }

    const subCommand = (args[0] || '').toLowerCase();
    const subArgs = args.slice(1);

    switch (subCommand) {
      case 'stats':
        await this.handleAdminStats(chatId);
        break;
      case 'users':
        await this.handleAdminUsers(chatId);
        break;
      case 'broadcast':
        await this.handleAdminBroadcast(chatId, subArgs);
        break;
      case 'user':
        await this.handleAdminUser(chatId, subArgs);
        break;
      default:
        await this.bot.sendMessage(chatId, 'Unknown admin command. Use /admin for help.');
    }
  }

  private async handleAdminStats(chatId: number): Promise<void> {
    const stats = await this.adminService.getBotStats();
    
    const statsMessage = `
📊 Bot Statistics

👥 Users:
• Total users: ${stats.totalUsers}
• Active users (24h): ${stats.activeUsers24h}
• New users today: ${stats.newUsersToday}

💬 Messages:
• Total messages: ${stats.totalMessages}
• Messages today: ${stats.messagesToday}
• Average per user: ${stats.averageMessagesPerUser}

📈 System:
• Uptime: ${stats.uptime}
• Memory usage: ${stats.memoryUsage}
• Database size: ${stats.databaseSize}
    `.trim();

    await this.bot.sendMessage(chatId, statsMessage);
  }

  private async handleAdminUsers(chatId: number): Promise<void> {
    const users = await this.adminService.getAllUsers();
    
    if (users.length === 0) {
      await this.bot.sendMessage(chatId, 'No users found.');
      return;
    }

    const userList = users.slice(0, 10).map(user => 
      `• ${user.firstName} (@${user.username || 'no_username'}) - ID: ${user.id}`
    ).join('\n');

    const message = `
👥 Recent Users (showing first 10):

${userList}

${users.length > 10 ? `... and ${users.length - 10} more users` : ''}
    `.trim();

    await this.bot.sendMessage(chatId, message);
  }

  private async handleAdminBroadcast(chatId: number, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.bot.sendMessage(chatId, 'Usage: /admin broadcast <message>');
      return;
    }

    const message = args.join(' ');
    const result = await this.adminService.broadcastMessage(message);
    
    await this.bot.sendMessage(chatId, `Broadcast sent to ${result.successCount} users. ${result.failureCount} failed.`);
  }

  private async handleAdminUser(chatId: number, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.bot.sendMessage(chatId, 'Usage: /admin user <user_id>');
      return;
    }

    const userId = parseInt(args[0] || '0');
    if (isNaN(userId)) {
      await this.bot.sendMessage(chatId, 'Invalid user ID. Please provide a number.');
      return;
    }

    const user = await this.userService.getUser(userId);
    if (!user) {
      await this.bot.sendMessage(chatId, 'User not found.');
      return;
    }

    const userInfo = `
👤 User Information

ID: ${user.id}
Username: ${user.username || 'Not set'}
Name: ${user.firstName} ${user.lastName || ''}
Language: ${user.languageCode || 'Not set'}
Messages: ${user.messageCount || 0}
Commands: ${user.commandCount || 0}
Created: ${user.createdAt ? new Date(user.createdAt).toLocaleString() : 'Unknown'}
Last Active: ${user.lastActive ? new Date(user.lastActive).toLocaleString() : 'Never'}
    `.trim();

    await this.bot.sendMessage(chatId, userInfo);
  }

  private calculateAverageMessages(user: any): number {
    if (!user.messageCount || !user.createdAt) return 0;
    
    const daysSinceCreation = Math.max(1, (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    return Math.round((user.messageCount / daysSinceCreation) * 100) / 100;
  }
} 