# Telegram Bot

A professional Telegram bot built with TypeScript, Node.js, and SQLite. This bot provides a comprehensive set of features including user management, statistics tracking, admin controls, and interactive messaging.

## 🚀 Features

### Core Features
- **User Management**: Registration, profile management, and activity tracking
- **Command System**: Built-in commands with argument parsing
- **Message Handling**: Intelligent message processing and responses
- **Inline Keyboards**: Interactive button-based navigation
- **Settings Management**: User preferences and customization
- **Statistics Tracking**: Detailed usage analytics and reporting

### Admin Features
- **Admin Panel**: Comprehensive bot management interface
- **User Management**: View, ban, and manage users
- **Broadcast Messages**: Send messages to all users
- **Bot Statistics**: Real-time performance and usage metrics
- **Database Management**: Monitor and maintain data integrity

### Technical Features
- **TypeScript**: Full type safety and modern development experience
- **SQLite Database**: Lightweight, reliable data storage
- **Logging System**: Comprehensive logging with Winston
- **Error Handling**: Robust error management and recovery
- **Modular Architecture**: Clean, maintainable code structure

## 📋 Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Telegram Bot Token (from @BotFather)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd telegram-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` file with your configuration:
   ```env
   BOT_TOKEN=your_telegram_bot_token_here
   BOT_USERNAME=your_bot_username
   DATABASE_URL=./data/bot.db
   PORT=3000
   NODE_ENV=development
   LOG_LEVEL=info
   ADMIN_USER_IDS=123456789,987654321
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

5. **Start the bot**
   ```bash
   npm start
   ```

## 🔧 Development

### Available Scripts

- `npm run dev` - Start in development mode with hot reload
- `npm run watch` - Watch for changes and restart automatically
- `npm run build` - Build the TypeScript code
- `npm run test` - Run tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

### Project Structure

```
src/
├── bot/                    # Bot core functionality
│   ├── Bot.ts             # Main bot class
│   ├── CommandHandler.ts  # Command processing
│   ├── MessageHandler.ts  # Message processing
│   └── CallbackQueryHandler.ts # Inline keyboard handling
├── database/              # Database layer
│   └── Database.ts        # SQLite database management
├── services/              # Business logic
│   ├── UserService.ts     # User management
│   └── AdminService.ts    # Admin functionality
├── utils/                 # Utilities
│   └── Logger.ts          # Logging system
└── index.ts              # Application entry point
```

## 🤖 Bot Commands

### User Commands
- `/start` - Initialize the bot and register
- `/help` - Show help information
- `/settings` - Manage your preferences
- `/stats` - View your usage statistics

### Admin Commands
- `/admin` - Access admin panel
- `/admin stats` - View bot statistics
- `/admin users` - List all users
- `/admin broadcast <message>` - Send message to all users
- `/admin user <id>` - Get user information

## 📊 Database Schema

### Users Table
- `id` - Telegram user ID (primary key)
- `username` - Telegram username
- `firstName` - User's first name
- `lastName` - User's last name
- `isBot` - Whether user is a bot
- `languageCode` - User's language preference
- `messageCount` - Total messages sent
- `commandCount` - Total commands used
- `mostUsedCommand` - Most frequently used command
- `lastActive` - Last activity timestamp
- `createdAt` - Registration timestamp
- `updatedAt` - Last update timestamp
- `notifications` - Notification preferences (JSON)
- `settings` - User settings (JSON)

### Messages Table
- `id` - Message ID (auto-increment)
- `userId` - User who sent the message
- `chatId` - Chat where message was sent
- `messageText` - Message content
- `messageType` - Type of message
- `timestamp` - Message timestamp

### Commands Table
- `id` - Command log ID (auto-increment)
- `userId` - User who used the command
- `command` - Command name
- `args` - Command arguments (JSON)
- `timestamp` - Command usage timestamp

### Admins Table
- `id` - Admin record ID (auto-increment)
- `userId` - Admin user ID
- `permissions` - Admin permissions (JSON)
- `createdAt` - Admin creation timestamp

### Stats Table
- `id` - Stats record ID (auto-increment)
- `date` - Date of statistics
- `totalUsers` - Total users count
- `activeUsers` - Active users count
- `totalMessages` - Total messages count
- `totalCommands` - Total commands count
- `createdAt` - Record creation timestamp

## 🔐 Security

### Admin Access
- Admin users are stored in the database
- Admin commands require proper authentication
- Sensitive operations are logged

### Data Protection
- User data is stored securely in SQLite
- Sensitive information is not logged
- Database access is properly controlled

## 📝 Logging

The bot uses Winston for comprehensive logging:

- **Console Logs**: Colored output for development
- **File Logs**: Persistent logs in `logs/` directory
- **Error Logs**: Separate error log file
- **Performance Logs**: Operation timing and metrics

### Log Levels
- `error` - Error messages
- `warn` - Warning messages
- `info` - General information
- `debug` - Debug information
- `verbose` - Detailed information
- `silly` - Very detailed information

## 🚀 Deployment

### Local Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### Docker (Optional)
```bash
docker build -t telegram-bot .
docker run -d --name telegram-bot telegram-bot
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BOT_TOKEN` | Telegram bot token | Required |
| `BOT_USERNAME` | Bot username | Required |
| `DATABASE_URL` | Database file path | `./data/bot.db` |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `LOG_LEVEL` | Logging level | `info` |
| `ADMIN_USER_IDS` | Admin user IDs | `[]` |

### Bot Configuration

The bot can be customized by modifying the configuration in the respective service files:

- **Command responses**: Edit `CommandHandler.ts`
- **Message handling**: Edit `MessageHandler.ts`
- **Database queries**: Edit service files
- **Logging**: Edit `Logger.ts`

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- --grep "UserService"
```

## 📈 Monitoring

### Health Checks
- Database connectivity
- Bot API connectivity
- Memory usage
- Error rates

### Metrics
- User registration rate
- Message volume
- Command usage
- Response times

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

If you encounter any issues:

1. Check the logs in `logs/` directory
2. Verify your environment variables
3. Ensure your bot token is valid
4. Check the database file permissions

For additional help, please open an issue on GitHub.

## 🔄 Updates

To update the bot:

1. Pull the latest changes
2. Install new dependencies: `npm install`
3. Rebuild: `npm run build`
4. Restart the bot: `npm start`

## 📚 Additional Resources

- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [Node.js Documentation](https://nodejs.org/docs)
- [TypeScript Documentation](https://www.typescriptlang.org/docs)
- [SQLite Documentation](https://www.sqlite.org/docs.html) 