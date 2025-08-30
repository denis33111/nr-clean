import dotenv from 'dotenv';
import { Bot } from './bot/Bot';
import { Logger } from './utils/Logger';
import { GoogleSheetsClient } from './utils/GoogleSheetsClient';

// Load environment variables
dotenv.config();

async function main() {
  try {
    // Initialize logger
    const logger = new Logger();
    logger.info('Starting Newrest Worker Bot...');

    // Initialize Google Sheets client
    const sheetsClient = new GoogleSheetsClient();
    await sheetsClient.initialize();

    // Initialize and start bot
    const bot = new Bot(logger, sheetsClient);
    await bot.start();

    logger.info('Bot started successfully!');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down bot...');
      await bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down bot...');
      await bot.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main().catch(console.error);
