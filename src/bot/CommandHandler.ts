import TelegramBot from 'node-telegram-bot-api';
import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
import { UserService } from '../services/UserService';
import { AdminService } from '../services/AdminService';
import { MessageHandler } from './MessageHandler';

export class CommandHandler {
  private bot: TelegramBot;
  private database: Database;
  private logger: Logger;
  private sheets: GoogleSheetsClient | undefined;
  private userService: UserService;
  private adminService: AdminService;
  private messageHandler: any; // Assuming MessageHandler is imported and available

  constructor(bot: TelegramBot, database: Database, logger: Logger, sheets?: GoogleSheetsClient) {
    this.bot = bot;
    this.database = database;
    this.logger = logger;
    this.sheets = sheets;
    this.userService = new UserService(database);
    this.adminService = new AdminService(database);
    this.messageHandler = new MessageHandler(bot, database, logger, sheets);
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
    const chatType = msg.chat.type;
    
    this.logger.info(`Command received: ${command} from user ${userId} in ${chatType} chat`);
    
    try {
      // Check if user has working status first
      const userStatus = await this.messageHandler.getUserStatus(userId);
      const isWorkingUser = userStatus && userStatus.status.toLowerCase() === 'working';
      
      switch (command) {
        case '/start':
          // Handle /start based on chat type
          if (chatType === 'private') {
            // Private chat: Let CandidateStep1Flow handle it completely
            // We don't do anything here to avoid duplication
            return;
          } else if (chatType === 'group' || chatType === 'supergroup') {
            // Group chat: Handle admin start command
            await this.handleAdminStart(msg);
            return;
          }
          break;
        case '/contact':
          await this.handleContact(msg);
          break;
        case '/help':
          if (isWorkingUser) {
            await this.handleWorkingUserHelp(msg);
          } else {
            await this.handleHelp(msg);
          }
          break;
        case '/settings':
          if (isWorkingUser) {
            await this.handleWorkingUserSettings(msg);
          } else {
            await this.handleSettings(msg);
          }
          break;
        case '/stats':
          if (isWorkingUser) {
            await this.handleWorkingUserStats(msg);
          } else {
            await this.handleStats(msg);
          }
          break;
        case '/admin':
          await this.handleAdmin(msg, args);
          break;
        case '/addadmin':
          await this.handleAddAdmin(msg, args);
          break;
        case '/makeadmin':
          await this.handleMakeAdmin(msg, args);
          break;
        default:
          // Allow other flows to handle step2-related commands
          if (command === '/pending2' || command.startsWith('/step2_')) {
            return;
          }
          if (isWorkingUser) {
            await this.handleWorkingUserUnknownCommand(msg);
          } else {
            await this.bot.sendMessage(chatId, 'Unknown command. Use /help to see available commands.');
          }
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

  private async handleAdminStart(msg: TelegramBot.Message): Promise<void> {
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
🎉 Welcome to the Admin Panel!

This is the admin group where you can:
• Review candidate applications
• Manage evaluations
• Access admin commands

📋 Available Commands:
• /admin - Admin panel
• /help - Show help information
• /stats - View statistics

💡 Use /admin to access admin features.
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

👤 User Info:
• ID: ${user.id}
• Username: ${user.username || 'Not set'}
• Name: ${user.firstName} ${user.lastName || ''}
• Language: ${user.languageCode || 'Not set'}

📈 Activity:
• Messages sent: ${user.messageCount || 0}
• Commands used: ${user.commandCount || 0}
• Last active: ${user.lastActive ? new Date(user.lastActive).toLocaleString() : 'Never'}

🎯 Most Used Command: ${user.mostUsedCommand || 'None'}
    `.trim();

    await this.bot.sendMessage(chatId, statsMessage);
  }

  private async handleContact(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    // Check if user is registered
    const user = await this.userService.getUser(userId);
    if (!user) {
      await this.bot.sendMessage(chatId, 'Please use /start first to register.');
      return;
    }

    // Start contact flow using MessageHandler
    await this.messageHandler.startContactFlow(chatId, userId);
  }

  private async handleWorkingUserHelp(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userLang = await this.messageHandler.getUserLanguage(msg.from!.id);
    
    const helpMessage = userLang === 'gr'
      ? `👋 Γεια σας! Είστε εγγεγραμμένος εργαζόμενος.

📋 Διαθέσιμες εντολές:
• /start - Επιστροφή στην αρχική σελίδα
• /contact - Επικοινωνία με την ομάδα

💡 Συμβουλή: Απλά στείλτε ένα μήνυμα για να κάνετε check-in!`
      : `👋 Hello! You are a registered employee.

📋 Available commands:
• /start - Return to main page
• /contact - Contact the team

💡 Tip: Just send a message to check in!`;
    
    await this.bot.sendMessage(chatId, helpMessage);
  }

  private async handleWorkingUserSettings(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userLang = await this.messageHandler.getUserLanguage(msg.from!.id);
    
    const settingsMessage = userLang === 'gr'
      ? `⚙️ Ρυθμίσεις για εργαζόμενους

🔒 Οι ρυθμίσεις σας διατηρούνται από την ομάδα HR.
📞 Για αλλαγές, επικοινωνήστε με την ομάδα μέσω /contact.`
      : `⚙️ Settings for employees

🔒 Your settings are maintained by the HR team.
📞 For changes, contact the team via /contact.`;
    
    await this.bot.sendMessage(chatId, settingsMessage);
  }

  private async handleWorkingUserStats(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userLang = await this.messageHandler.getUserLanguage(msg.from!.id);
    
    const statsMessage = userLang === 'gr'
      ? `📊 Στατιστικά εργαζόμενου

✅ Κατάσταση: Εργαζόμενος
📅 Ημερομηνία εγγραφής: Διατηρείται από HR
📞 Επικοινωνία: /contact`
      : `📊 Employee statistics

✅ Status: Employee
📅 Registration date: Maintained by HR
📞 Contact: /contact`;
    
    await this.bot.sendMessage(chatId, statsMessage);
  }

  private async handleWorkingUserUnknownCommand(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userLang = await this.messageHandler.getUserLanguage(msg.from!.id);
    
    const unknownMessage = userLang === 'gr'
      ? `❓ Άγνωστη εντολή.

📋 Διαθέσιμες εντολές:
• /start - Επιστροφή στην αρχική σελίδα
• /contact - Επικοινωνία με την ομάδα

💡 Συμβουλή: Απλά στείλτε ένα μήνυμα για να κάνετε check-in!`
      : `❓ Unknown command.

📋 Available commands:
• /start - Return to main page
• /contact - Contact the team

💡 Tip: Just send a message to check in!`;
    
    await this.bot.sendMessage(chatId, unknownMessage);
  }

  private async handleAdmin(msg: TelegramBot.Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    // Only allow admin commands in group chats, not private chats
    if (msg.chat.type === 'private') {
      await this.bot.sendMessage(chatId, '❌ Admin commands can only be used in group chats.');
      return;
    }

    // Check if user is admin
    const isAdmin = await this.adminService.isAdmin(userId, chatId, this.bot);
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

  private async handleAddAdmin(msg: TelegramBot.Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    // Only allow in group chats
    if (msg.chat.type === 'private') {
      await this.bot.sendMessage(chatId, '❌ This command can only be used in group chats.');
      return;
    }

    // Check if user is already admin (first admin can add others)
    const isAdmin = await this.adminService.isAdmin(userId, chatId, this.bot);
    if (!isAdmin) {
      // Check if there are any admins at all
      const admins = await this.adminService.getAdmins();
      if (admins.length === 0) {
        // No admins exist, allow this user to become the first admin
        await this.adminService.addAdmin(userId, ['owner']);
        await this.bot.sendMessage(chatId, `✅ You have been added as the first admin (owner).`);
        return;
      } else {
        await this.bot.sendMessage(chatId, '❌ Access denied. Admin privileges required.');
        return;
      }
    }

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, 'Usage: /addadmin <user_id>');
      return;
    }

    const targetUserId = parseInt(args[0] || '0', 10);
    if (isNaN(targetUserId)) {
      await this.bot.sendMessage(chatId, 'Invalid user ID. Please provide a valid number.');
      return;
    }

    try {
      await this.adminService.addAdmin(targetUserId, ['admin']);
      await this.bot.sendMessage(chatId, `✅ User ${targetUserId} has been added as an admin.`);
    } catch (error) {
      this.logger.error('Error adding admin:', error);
      await this.bot.sendMessage(chatId, 'Error adding admin user.');
    }
  }

  private async handleMakeAdmin(msg: TelegramBot.Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    // Check if there are any admins at all
    const admins = await this.adminService.getAdmins();
    if (admins.length === 0) {
      // No admins exist, allow this user to become the first admin
      await this.adminService.addAdmin(userId, ['owner']);
      await this.bot.sendMessage(chatId, `✅ You have been added as the first admin (owner). You can now test admin features!`);
      return;
    } else {
      await this.bot.sendMessage(chatId, `❌ Admins already exist. Use /addadmin in a group chat instead.`);
      return;
    }
  }
} 