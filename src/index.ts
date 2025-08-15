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

    // Keep-alive mechanism to prevent Render from sleeping
    setInterval(() => {
      fetch('https://telegram-bot-5kmf.onrender.com/health')
        .then(() => console.log('Keep-alive ping sent'))
        .catch(err => console.log('Keep-alive failed:', err));
    }, 10 * 60 * 1000); // Every 10 minutes

    // Initialize logger
    const logger = new Logger();
    logger.info('Starting Telegram Bot...');

    // Initialize database
    const database = new Database();
    await database.initialize();
    logger.info('Database initialized successfully');

    // Initialize Google Sheets client FIRST
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID || process.env.SHEET_ID || 'YOUR_SHEET_ID_HERE';
    
    // Use environment variables for Google service account
    const googleCredentials = {
      type: "service_account",
      project_id: process.env.GOOGLE_PROJECT_ID || "newrest-465515",
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || "523c08879a9d8929cc123a690636bf07088df0cc",
      private_key: process.env.GOOGLE_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCdVcWtYXFxXdhZ\ndmThGmm+UIFtSTxU4GCVSO63+0ban3P3r9jfVlfdkM/zhr88BiJ4zkMvA3w/UP52\nvG8RUuP5qvO58sxRJ3xXX0HIarEMDHK9YW6PFr7kl5S2SsqF2lywQ4NTVpnP/9o1\n/KGG+vObrshVIDlu5fZP5t9q9jGvTKAhZRgiR9Enodiehxe9Zmi7wKA6eA9dVlsj\nCouYiaKBFbOk1RarEx119j8tFxVmZQ10JBwiZeRJTDXXi0vERZVjFct1WcKwDXtK\nVsaLZwgtkayW5rGOV2v471loFuGFs3y1uIuxtsHTtJvjY5zX62iGXMzfIe8nCKqe\nmXbWyOpfAgMBAAECggEAIbd6W9wIgBdw4Ecnejf7Vj4RZnat17CX8hYFlmbiecJ3\nCyrjioUJ4mEAt3r2a2oTJBlru1z/WOBGD/L0yF0fnub8QSqfj3qrQlwXEFiQ5Xib\ndCs3krF4qiszwtcHTKUNfPaS456o6rK1NCGWCgOohgHwS5HSzQm5/ciHs3fcEOlA\nLOy2vw6pd9x8m6g79vUUiYhCrscOCp3UaDetmCz7I4tlGDW2psIVBkPYnGMzA5W\n34g8Sl+nOaqMidXfFHoWNNPrixUoeGPexArwsx1lzvpCX6bi5ygfdlVRUxuRWW1f\nw8w6o+pEkOroa/VQmdx18XlGiVwrejrEzk+d5oDcvQKBgQDV0XU1iyo52pfbzUO6\n46pRmVF+2UK1oa18dK85ex5iS7rlSRXXti+COnGn/dU6gsxK4irpgtwKYB4Qepm0\n9aY57aFfbDqrtVk8by2jFhdGnN/DUmZvKiLifxf7069l+ieYlkQ2U+VJf/5Ydyph\nnSltboP1OlWvwemAfKELPxymDQKBgQC8X7ltMHoGCxnRpsSYbK1YHU6CA3oSkZVK\n9AWQADnNX3p+FylgQU+kw2PKPZOMK6O3WnVxBiTGwbr4UweJcJdqbOT/xY54OT8a\nFUkKtDRoH7DNUSDMqqMKbdxLFHJ73TrreYJFDMwl2h/CcgiuPAYAWAzmlDTxG8ly\npC6SNwZDGwKBgCzd3vJ1WU76h5Mf5254B21H9snfXRgv7O+IrJwrMZz+tyEVzPeO\nyzlQejj+EphMigHMo6SMSRAES0q57zcBtPfC3XHgjA8r5qW/zpvCLvAqSun5iHUb\nKmbMtIOrT8reSyDBp16fDCX4La7yknoZOHA2GIqEyyYuUokbnc92VtShAoGAcna8\nRvQRAcEXFEUA6xoGjydnwCr6r3PVQvFau/DXLstYtGvAkaO+EIFGDusx0BfoaI7I\nFEDGchvgT+qsBsDq0RmQYTcbZkRq6p+Kfb2YprizB1/HzXXWkozFMr4e/tMkbVet\nZ+Xp2wpbCB2g1rbUcrsOQ8JFFUlsNIQ9ZE2ZOYcCgYEAndx1DuIap+hnVfQscfy/\nEXCEFxy3xMHwZ5kkPGP49h6/qlCDFDzpusrqJIcspQAgkheVqfZ44QE0F4CKarcA\nbBTdj8AMhBUcwGZywW+fiOtfFspVwFN/9xZPgzKE4Am1NOJyTe1f91SdForIZKz6\ngIgsQl7vnMbtl6yYoYqm1fE=\n-----END PRIVATE KEY-----\n",
      client_email: process.env.GOOGLE_CLIENT_EMAIL || "newresttelegrambotservice@newrest-465515.iam.gserviceaccount.com",
      client_id: process.env.GOOGLE_CLIENT_ID || "110694577902197703065",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/newresttelegrambotservice%40newrest-465515.iam.gserviceaccount.com",
      universe_domain: "googleapis.com"
    };
    
    console.log(`[DEBUG] Initializing Google Sheets with ID: ${spreadsheetId}`);
    console.log(`[DEBUG] Using Google service account: ${googleCredentials.client_email}`);
    const sheetsClient = new GoogleSheetsClient(spreadsheetId, googleCredentials);
    console.log('[DEBUG] Google Sheets client initialized successfully');

    // Initialize and start bot
    console.log('[DEBUG] Creating Bot instance...');
    const bot = new Bot(database, logger, sheetsClient);
    console.log('[DEBUG] Bot instance created successfully');
    console.log('[DEBUG] Starting bot...');
    await bot.start();
    console.log('[DEBUG] Bot started successfully');
    logger.info('Bot started successfully');

    // Update webhook endpoint to use bot handler
    app.post('/webhook', express.json(), (req, res) => {
      try {
        // Process the update through the bot
        bot.handleWebhookUpdate(req.body);
        res.sendStatus(200);
      } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(500);
      }
    });

    // Initialize candidate Step 1 flow
    console.log('[DEBUG] Initializing CandidateStep1Flow...');
    const candidateStep1Flow = new CandidateStep1Flow((bot as any).bot, sheetsClient);
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
    const candidateCourseFlow = new CandidateCourseFlow((bot as any).bot, sheetsClient);
    console.log('[DEBUG] CandidateCourseFlow initialized successfully');

    // Store flow instances in bot for webhook access
    (bot as any).candidateStep1Flow = candidateStep1Flow;
    (bot as any).adminStep2Flow = adminStep2Flow;
    (bot as any).candidateCourseFlow = candidateCourseFlow;

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