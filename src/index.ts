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
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development'
      });
    });
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // Detailed status endpoint
    app.get('/status', (req, res) => {
      const status = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development',
        reminderService: reminderService ? {
          pendingReminders: reminderService.getPendingRemindersCount(),
          details: reminderService.getPendingRemindersDetails()
        } : 'Not initialized'
      };
      res.json(status);
    });

    // Manual reminder check endpoint (for testing)
    app.post('/test-reminders', async (req, res) => {
      try {
        if (reminderService) {
          await reminderService.triggerReminderCheck();
          res.json({ 
            status: 'success', 
            message: 'Reminder check triggered',
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(500).json({ 
            status: 'error', 
            message: 'Reminder service not initialized' 
          });
        }
      } catch (error) {
        res.status(500).json({ 
          status: 'error', 
          message: 'Failed to trigger reminder check',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
    
    // Simple web dashboard
    app.get('/dashboard', (req, res) => {
      const uptime = process.uptime();
      const memUsage = process.memoryUsage();
      const uptimeHours = Math.floor(uptime / 3600);
      const uptimeMinutes = Math.floor((uptime % 3600) / 60);
      const uptimeSeconds = Math.floor(uptime % 60);
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Telegram Bot Dashboard</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; color: #333; border-bottom: 2px solid #007bff; padding-bottom: 20px; margin-bottom: 20px; }
            .status { padding: 15px; margin: 10px 0; border-radius: 5px; }
            .status.ok { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
            .status.info { background: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; }
            .metric { display: flex; justify-content: space-between; margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px; }
            .metric-label { font-weight: bold; }
            .metric-value { font-family: monospace; }
            .refresh-btn { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 20px 0; }
            .refresh-btn:hover { background: #0056b3; }
            .timestamp { text-align: center; color: #666; font-size: 0.9em; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🤖 Telegram Bot Dashboard</h1>
              <p>Real-time server status and monitoring</p>
            </div>
            
            <div class="status ok">
              <h3>✅ Server Status: ONLINE</h3>
              <p>Your bot is running and responding to requests</p>
            </div>
            
            <div class="metric">
              <span class="metric-label">Uptime:</span>
              <span class="metric-value">${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s</span>
            </div>
            
            <div class="metric">
              <span class="metric-label">Memory Used:</span>
              <span class="metric-value">${Math.round(memUsage.heapUsed / 1024 / 1024)} MB</span>
            </div>
            
            <div class="metric">
              <span class="metric-label">Memory Total:</span>
              <span class="metric-value">${Math.round(memUsage.heapTotal / 1024 / 1024)} MB</span>
            </div>
            
            <div class="metric">
              <span class="metric-label">Environment:</span>
              <span class="metric-value">${process.env.NODE_ENV || 'development'}</span>
            </div>
            
            <div class="status info">
              <h3>📊 Health Check Endpoints</h3>
              <ul>
                <li><strong>/health</strong> - Basic health status</li>
                <li><strong>/status</strong> - Detailed server status</li>
                <li><strong>/test-reminders</strong> - Test reminder system (POST)</li>
              </ul>
            </div>
            
            <button class="refresh-btn" onclick="location.reload()">🔄 Refresh Dashboard</button>
            
            <div class="timestamp">
              Last updated: ${new Date().toLocaleString()}
            </div>
          </div>
        </body>
        </html>
      `;
      
      res.send(html);
    });
    

    
    // Start the Express server
    app.listen(port, () => {
      console.log(`Express server listening on port ${port}`);
    });

    // Keep-alive mechanism to prevent Render from sleeping
    let keepAliveCount = 0;
    const keepAliveInterval = setInterval(() => {
      keepAliveCount++;
      const timestamp = new Date().toISOString();
      
      fetch('https://telegram-bot-5kmf.onrender.com/health')
        .then(async (response) => {
          const responseTime = Date.now();
          const responseData = await response.json() as { status: string; uptime: number };
          console.log(`[${timestamp}] Keep-alive #${keepAliveCount} - Status: ${response.status}, Response: ${responseTime}ms, Uptime: ${Math.round(responseData.uptime / 60)} minutes`);
        })
        .catch(err => {
          console.error(`[${timestamp}] Keep-alive #${keepAliveCount} failed:`, err.message);
        });
    }, 10 * 60 * 1000); // Every 10 minutes

    // Log server startup
    console.log(`[${new Date().toISOString()}] Server started with keep-alive every 10 minutes`);
    console.log(`[${new Date().toISOString()}] Health check endpoints available:`);
    console.log(`  - GET / - Basic status`);
    console.log(`  - GET /health - Health check`);
    console.log(`  - GET /status - Detailed status with reminders`);
    console.log(`  - POST /test-reminders - Manual reminder test`);

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
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || "06ff20aa633e299bf6a881c5459aaeb07ab6cc5f",
      private_key: process.env.GOOGLE_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCqW+8DfGLahsBQ\nzfsDUJDpIaVoEtar4MfUSPtl758enm09ZGRlNk1gFxb5tugYUARMFJCKEqeEqUdN\nRNKv3kBZoT2i4PdYkWN/PqWCyRCwoX6NbC9YtHON3Or+96QgUWik/63O5DLOI6uJ\n04cJva0x7ET/Wtv7mFGEVqoJ3sM38nxolr7S6WZ8LKZkDMnj8X+XuY96m4xCQjYu\nNcGE8xadhU70IrPtE4v8o6QzQeAMVIWgMFGSnqQTamPwjD8JrEZ+vPYBP9H25JZP\n7GA6PW5GjxLT8uvEzH5JMBfe0hO5AfAIJbuFNBKOkAv5S9u7hzrDF4mjUeYQJuaD\ni94tliq9AgMBAAECggEAGdT14afvT2aGa9pH+SEyz/73l1ff8FEVy/VDFZpnnNt2\nAgyigoxg4DSwGa5n9CPR+v1VS3J3r1CBzNAmSF+hj1W5RGTrbKUjGqzTqQi2/KmI\nSIaCiWdXbEf25DGF1Ba0EOzqHIiSwZo8DRqji9EUnZDPh47t83ENz0za3MNIA8gE\nL3vLAVZhzCLgUXnBlBIxzv/gtnqViKNOj7CcSYDWFYGH1YR3Tg2tFfc81vZEKbo0\nQHBsZPD7RswGlK9bmhqqX+22pBNzvIAvaevzow08ohb75hY5gjOFtuuj1iFX/QS9\n4LQBjRwH0kF7n/xgSwKgYqJLJYOL8Brr/ON75AcWQQKBgQDdYSW7qr2xUwiNVGtW\nljunbzBJlGXLNfg60H5uHNBfzL7oXu5pc4S3cI6H8QSStP+yhiUb+JrdjA1TKouG\nW08bTHVqV132C/8vSsrBvKMztpmqoInjSMGcTTbm2MH56Okg9uEW/b1t6PFKRgCW\nT0T86qi2anMYR319W6q+ysDeoQKBgQDFADQCs+a98dp5X1VTQuWEqXPPBBJ8qOGh\nvl3y1rYnrbYZHkVWHkmERbHvfm1lCpsJakWdJsate10vQZR3XXRhRC5cxWfO6NMJ\neqTEUhHRyK5sQaCO/BLsH2lSkgfasGeqfP2jiM0I0vo5YwXP9KO8nxwtMoqAj7Hl\niOiwa5RinQKBgA8RpszgcWsZmNJt9aR+M29RPTs087ziXpQ6TvDV20U6HaCZnabl\n6xnFep48RLBry5/uS6ZcxMXh26JWmgq6OmdETBXB/q5Z4LPqZmTLn1xMyKb5qIkl\nEbC+/Ma36HRHa18IDwhOm09Y9Nu2aiHRIYQJwRQxqMX1T9Bxpey4xmohAoGAXmMC\niGj5nPhL3Os4TnQ206D8w6sH0IJ52K0FBlypWcl4/f/q6KAKST27Sywf7dFvBsvM\nHsd9WZFJzGJ3Z9l28UNhk0Fhw1j6BAim+Qj5ULH+IBAxhVBxIIDMTat55+WtRZot\nTDU3R4sOKICxQDnOWYlCTsVwZrhyW6+FDUH+DmECgYEAxB9+AYI8DnKTRoSt9PKl\nr+eE8cDWvwq2x2AWWupXmYWiBvruDNjmShlsPa5r9UEFZLl4uiTBExcJWSJm8Jwd\nbZ6F5TtyLyTKs77TWxwFQe1uInuuBYzXk0h4hAZlxK6Hv+T2sW9Idt0pVx6wESc4\nHtkkHOv/tYIKHVpFTVD6kEA=\n-----END PRIVATE KEY-----",
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

    // Process monitoring
    const monitorInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const uptime = process.uptime();
      const timestamp = new Date().toISOString();
      
      // Log memory usage every 30 minutes
      console.log(`[${timestamp}] Process Monitor - Uptime: ${Math.round(uptime / 60)} minutes, Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB used, ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB total`);
      
      // Alert if memory usage is high (>500MB)
      if (memUsage.heapUsed > 500 * 1024 * 1024) {
        console.warn(`[${timestamp}] WARNING: High memory usage detected: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
      }
      
      // Alert if uptime is very long (potential memory leaks)
      if (uptime > 24 * 60 * 60) { // More than 24 hours
        console.log(`[${timestamp}] INFO: Server running for ${Math.round(uptime / 60 / 60)} hours`);
      }
    }, 30 * 60 * 1000); // Every 30 minutes

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n[${new Date().toISOString()}] Received ${signal}, shutting down gracefully...`);
      
      // Clear intervals
      clearInterval(keepAliveInterval);
      clearInterval(monitorInterval);
      
      // Close database connections if needed
      try {
        await database.close?.();
        console.log('[Shutdown] Database connections closed');
      } catch (error) {
        console.error('[Shutdown] Error closing database:', error);
      }
      
      console.log(`[${new Date().toISOString()}] Graceful shutdown completed`);
      process.exit(0);
    };

    // Handle graceful shutdown
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown is now handled in the main function

main(); 