import winston from 'winston';
import path from 'path';

export class Logger {
  private logger: winston.Logger;

  constructor() {
    // Create logs directory if it doesn't exist
    const fs = require('fs');
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Define log format
    const logFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    // Define console format for development
    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: 'HH:mm:ss'
      }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let metaStr = '';
        if (Object.keys(meta).length > 0) {
          metaStr = ` ${JSON.stringify(meta)}`;
        }
        return `${timestamp} [${level}]: ${message}${metaStr}`;
      })
    );

    // Create logger instance
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      defaultMeta: { service: 'telegram-bot' },
      transports: [
        // Console transport for development
        new winston.transports.Console({
          format: consoleFormat
        }),
        
        // File transport for all logs
        new winston.transports.File({
          filename: path.join(logsDir, 'combined.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
          tailable: true
        }),
        
        // File transport for error logs
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
          tailable: true
        })
      ]
    });

    // Handle uncaught exceptions
    this.logger.exceptions.handle(
      new winston.transports.File({
        filename: path.join(logsDir, 'exceptions.log')
      })
    );

    // Handle unhandled promise rejections
    this.logger.rejections.handle(
      new winston.transports.File({
        filename: path.join(logsDir, 'rejections.log')
      })
    );
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  error(message: string, meta?: any): void {
    this.logger.error(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  verbose(message: string, meta?: any): void {
    this.logger.verbose(message, meta);
  }

  silly(message: string, meta?: any): void {
    this.logger.silly(message, meta);
  }

  // Log bot-specific events
  botEvent(event: string, userId?: number, chatId?: number, meta?: any): void {
    this.info(`Bot Event: ${event}`, {
      userId,
      chatId,
      ...meta
    });
  }

  // Log user actions
  userAction(action: string, userId: number, meta?: any): void {
    this.info(`User Action: ${action}`, {
      userId,
      ...meta
    });
  }

  // Log command usage
  commandUsed(command: string, userId: number, args?: string[], meta?: any): void {
    this.info(`Command Used: ${command}`, {
      userId,
      args,
      ...meta
    });
  }

  // Log message received
  messageReceived(userId: number, chatId: number, messageType: string, meta?: any): void {
    this.info(`Message Received`, {
      userId,
      chatId,
      messageType,
      ...meta
    });
  }

  // Log callback query
  callbackQuery(userId: number, chatId: number, callbackData: string, meta?: any): void {
    this.info(`Callback Query`, {
      userId,
      chatId,
      callbackData,
      ...meta
    });
  }

  // Log database operations
  dbOperation(operation: string, table: string, meta?: any): void {
    this.debug(`Database Operation: ${operation}`, {
      table,
      ...meta
    });
  }

  // Log API calls
  apiCall(method: string, endpoint: string, statusCode?: number, meta?: any): void {
    this.info(`API Call: ${method} ${endpoint}`, {
      statusCode,
      ...meta
    });
  }

  // Log performance metrics
  performance(operation: string, duration: number, meta?: any): void {
    this.info(`Performance: ${operation}`, {
      duration: `${duration}ms`,
      ...meta
    });
  }

  // Log security events
  security(event: string, userId?: number, meta?: any): void {
    this.warn(`Security Event: ${event}`, {
      userId,
      ...meta
    });
  }

  // Log startup/shutdown events
  lifecycle(event: string, meta?: any): void {
    this.info(`Lifecycle Event: ${event}`, meta);
  }
} 