import TelegramBot from 'node-telegram-bot-api';
import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';
import { UserService } from '../services/UserService';
import { AdminService } from '../services/AdminService';
import { candidateSessions } from './CandidateStep1Flow';
import { adminSessions } from './AdminStep2Flow';
import { courseSessions } from './CandidateCourseFlow';

export class MessageHandler {
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

  async handleMessage(msg: TelegramBot.Message): Promise<void> {
    if (!msg.text || !msg.from) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text.trim();

    // If user is in any structured flow OR answering a force-reply prompt, skip generic handler.
    if (
      candidateSessions.has(userId) ||
      adminSessions.has(userId) ||
      courseSessions.has(userId) ||
      msg.reply_to_message // responding to force_reply from another flow
    ) {
      return;
    }

    // Relay mode: if ADMIN_GROUP_ID is configured and this is a private chat from a non-admin user,
    // let ChatRelay handle it for ALL users (registered and unregistered)
    if (
      process.env.ADMIN_GROUP_ID &&
      msg.chat.type === 'private' &&
      !(await this.adminService.isAdmin(userId))
    ) {
      // Still record activity but do not respond - let ChatRelay handle the message
      await this.userService.updateUserActivity(userId).catch(() => {});
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
} 