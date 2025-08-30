import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
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

    // Initialize bot
    const bot = new Bot(logger, sheetsClient);
    
    // Check if webhook URL is configured
    const webhookUrl = process.env['WEBHOOK_URL'];
    
    if (webhookUrl) {
      // Production: Set up Express server for webhook
      const app = express();
      const PORT = process.env['PORT'] || 10000;
      
      // Middleware
      app.use(cors());
      app.use(express.json());
      
      // Health check endpoint
      app.get('/health', (_req, res) => {
        res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
      });
      
      // Webhook endpoint for Telegram
      app.post('/webhook', (req, res) => {
        try {
          const update = req.body;
          bot.handleWebhookUpdate(update);
          res.status(200).send('OK');
        } catch (error) {
          logger.error('Error handling webhook:', error);
          res.status(500).send('Error');
        }
      });
      
      // Start Express server - MUST bind to 0.0.0.0 for Render
      app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Express server started on port ${PORT} (bound to 0.0.0.0)`);
      });
      
      // Start bot with webhook
      await bot.start();
      logger.info('Bot started with webhook mode');
    } else {
      // Local development: Start bot with polling
      await bot.start();
      logger.info('Bot started with polling mode (local development)');
    }

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
