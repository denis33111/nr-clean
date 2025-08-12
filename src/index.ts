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

// Load environment variables
dotenv.config();

// Log and ignore unhandled promise rejections so transient network errors don't crash the bot
process.on('unhandledRejection', (reason) => {
  console.error('[warn] Unhandled promise rejection:', reason);
});

// Log unhandled exceptions
process.on('uncaughtException', (error) => {
  console.error('[ERROR] Uncaught exception:', error);
  process.exit(1);
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
    console.log('[DEBUG] Creating Bot instance...');
    const bot = new Bot(database, logger);
    console.log('[DEBUG] Bot instance created successfully');
    console.log('[DEBUG] Starting bot...');
    await bot.start();
    console.log('[DEBUG] Bot started successfully');
    logger.info('Bot started successfully');

    // Initialize Google Sheets client
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID || process.env.SHEET_ID || 'YOUR_SHEET_ID_HERE';
    const keyFilePath = process.env.SHEET_KEY_PATH || './secrets/google-service-account.json';
    console.log(`[DEBUG] Initializing Google Sheets with ID: ${spreadsheetId}`);
    console.log(`[DEBUG] Using key file: ${keyFilePath}`);
    const sheetsClient = new GoogleSheetsClient(spreadsheetId, keyFilePath);
    console.log('[DEBUG] Google Sheets client initialized successfully');

    // Initialize candidate Step 1 flow
    console.log('[DEBUG] Initializing CandidateStep1Flow...');
    new CandidateStep1Flow((bot as any).bot, sheetsClient);
    console.log('[DEBUG] CandidateStep1Flow initialized successfully');

    // Initialize ReminderService ONCE
    const reminderService = new ReminderService((bot as any).bot, sheetsClient);

    // Initialize AdminStep2Flow ONCE
    const adminStep2Flow = new AdminStep2Flow((bot as any).bot, sheetsClient, database);
    adminStep2Flow.setReminderService(reminderService);
    adminStep2Flow.setupHandlers(); // Set up handlers after reminder service is set

    console.log('[DEBUG] AdminStep2Flow initialized with reminder service');

    // Initialize candidate course answer flow (Step 3 interactions)
    console.log('[DEBUG] Initializing CandidateCourseFlow...');
    new CandidateCourseFlow((bot as any).bot, sheetsClient);
    console.log('[DEBUG] CandidateCourseFlow initialized successfully');

    // AdminStep2Flow handles its own callbacks through setupHandlers()

    console.log('[DEBUG] All services initialized successfully!');

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