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
    console.log('🚀🚀🚀 FORCE REBUILD - NEW VERSION 🚀🚀🚀');

    // Initialize Google Sheets client
    console.log('🔥🔥🔥 ABOUT TO CREATE GoogleSheetsClient 🔥🔥🔥');
    const sheetsClient = new GoogleSheetsClient();
    console.log('🔥🔥🔥 ABOUT TO CALL initialize() 🔥🔥🔥');
    await sheetsClient.initialize();
    console.log('🔥🔥🔥 initialize() COMPLETED 🔥🔥🔥');

    // Initialize bot
    const bot = new Bot(logger, sheetsClient);
    
    // Check if webhook URL is configured
    const webhookUrl = process.env['WEBHOOK_URL'];
    logger.info(`WEBHOOK_URL environment variable: ${webhookUrl ? 'SET' : 'NOT SET'}`);
    logger.info(`WEBHOOK_URL value: ${webhookUrl}`);
    
    if (webhookUrl) {
      // Production: Set up Express server for webhook
      logger.info('Starting bot in WEBHOOK mode');
      const app = express();
      const PORT = parseInt(process.env['PORT'] || '10000', 10);
      
      // Middleware
      app.use(cors());
      app.use(express.json());
      
      // Health check endpoint
      app.get('/health', (_req, res) => {
        res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
      });
      
      // Debug endpoint to check environment variables
      app.get('/debug', (_req, res) => {
        res.status(200).json({ 
          webhookUrl: process.env['WEBHOOK_URL'],
          botToken: process.env['BOT_TOKEN'] ? 'SET' : 'NOT SET',
          googleSheetsId: process.env['GOOGLE_SHEETS_ID'] ? 'SET' : 'NOT SET',
          environment: process.env['NODE_ENV'] || 'development',
          port: process.env['PORT'],
          allEnvVars: Object.keys(process.env).filter(key => key.includes('GOOGLE') || key.includes('BOT') || key.includes('WEBHOOK'))
        });
      });
      
      // Test endpoint to verify webhook handling
      app.get('/test-webhook', (_req, res) => {
        res.status(200).json({ 
          message: 'Webhook endpoint is accessible',
          timestamp: new Date().toISOString(),
          webhookUrl: process.env['WEBHOOK_URL']
        });
      });
      
      // Webhook endpoint for Telegram
      app.post('/webhook', async (req, res) => {
        try {
          const update = req.body;
          logger.info('Webhook received:', JSON.stringify(update, null, 2));
          await bot.handleWebhookUpdate(update);
          logger.info('Webhook processed successfully');
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
      logger.info('Bot started with webhook mode - DEPLOYMENT CHECK v2');
    } else {
      // Local development: Start bot with polling
      logger.info('Starting bot in POLLING mode (local development)');
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
