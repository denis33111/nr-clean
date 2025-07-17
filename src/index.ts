import dotenv from 'dotenv';
import express from 'express';
import { Bot } from './bot/Bot';
import { Logger } from './utils/Logger';
import { Database } from './database/Database';
import { GoogleSheetsClient } from './utils/GoogleSheetsClient';
import { CandidateStep1Flow } from './bot/CandidateStep1Flow';
import { AdminStep2Flow } from './bot/AdminStep2Flow';
import { CandidateCourseFlow } from './bot/CandidateCourseFlow';
import { ReminderService } from './services/ReminderService';
import { AdminService } from './services/AdminService';
import { ChatRelay } from './bot/ChatRelay';

// Load environment variables
dotenv.config();

// Log and ignore unhandled promise rejections so transient network errors don't crash the bot
process.on('unhandledRejection', (reason) => {
  console.error('[warn] Unhandled promise rejection:', reason);
});

async function main() {
  try {
    // Initialize Express server to satisfy Render's port requirement
    const app = express();
    const port = process.env.PORT || 3000;
    
    // Simple health check endpoint
    app.get('/', (req, res) => {
      res.json({ 
        status: 'ok', 
        service: 'Telegram Candidate Bot',
        timestamp: new Date().toISOString()
      });
    });
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy' });
    });
    
    // Start the Express server
    app.listen(port, () => {
      console.log(`Express server listening on port ${port}`);
    });

    // Initialize logger
    const logger = new Logger();
    logger.info('Starting Telegram Bot...');

    // Initialize database
    const database = new Database();
    await database.initialize();
    logger.info('Database initialized successfully');

    // Initialize and start bot
    const bot = new Bot(database, logger);
    await bot.start();
    logger.info('Bot started successfully');

    // Initialize Google Sheets client
    const spreadsheetId = process.env.SHEET_ID || 'YOUR_SHEET_ID_HERE';
    const keyFilePath = process.env.SHEET_KEY_PATH || './secrets/google-service-account.json';
    const sheetsClient = new GoogleSheetsClient(spreadsheetId, keyFilePath);

    // Initialize candidate Step 1 flow
    new CandidateStep1Flow((bot as any).bot, sheetsClient);

    // Initialize admin Step 2 flow
    new AdminStep2Flow((bot as any).bot, sheetsClient, database);

    // Initialize candidate course answer flow (Step 3 interactions)
    new CandidateCourseFlow((bot as any).bot, sheetsClient);

    // Forward user DMs to admin group with reply support
    // Requires ADMIN_GROUP_ID env variable
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    new ChatRelay((bot as any).bot, new AdminService(database));

    // Daily reminder scheduler (day-before course)
    new ReminderService((bot as any).bot, sheetsClient);

  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

main(); 