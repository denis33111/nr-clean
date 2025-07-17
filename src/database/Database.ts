import sqlite3 from 'sqlite3';
import { Logger } from '../utils/Logger';

export class Database {
  private db!: sqlite3.Database;
  private logger: Logger;

  constructor() {
    this.logger = new Logger();
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const dbPath = process.env.DATABASE_URL || './data/bot.db';
      
      // Ensure data directory exists
      const path = require('path');
      const fs = require('fs');
      const dir = path.dirname(dbPath);
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          this.logger.error('Error opening database:', err);
          reject(err);
          return;
        }

        this.logger.info('Database connected successfully');
        this.createTables()
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  private async createTables(): Promise<void> {
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        firstName TEXT NOT NULL,
        lastName TEXT,
        isBot BOOLEAN DEFAULT FALSE,
        languageCode TEXT,
        messageCount INTEGER DEFAULT 0,
        commandCount INTEGER DEFAULT 0,
        mostUsedCommand TEXT,
        lastActive DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        notifications TEXT DEFAULT '{}',
        settings TEXT DEFAULT '{}'
      )
    `;

    const createMessagesTable = `
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        chatId INTEGER NOT NULL,
        messageText TEXT,
        messageType TEXT DEFAULT 'text',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id)
      )
    `;

    const createCommandsTable = `
      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        command TEXT NOT NULL,
        args TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id)
      )
    `;

    const createAdminsTable = `
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY,
        userId INTEGER NOT NULL,
        permissions TEXT DEFAULT '[]',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id)
      )
    `;

    const createStatsTable = `
      CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        totalUsers INTEGER DEFAULT 0,
        activeUsers INTEGER DEFAULT 0,
        totalMessages INTEGER DEFAULT 0,
        totalCommands INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date)
      )
    `;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(createUsersTable, (err) => {
          if (err) {
            this.logger.error('Error creating users table:', err);
            reject(err);
            return;
          }
        });

        this.db.run(createMessagesTable, (err) => {
          if (err) {
            this.logger.error('Error creating messages table:', err);
            reject(err);
            return;
          }
        });

        this.db.run(createCommandsTable, (err) => {
          if (err) {
            this.logger.error('Error creating commands table:', err);
            reject(err);
            return;
          }
        });

        this.db.run(createAdminsTable, (err) => {
          if (err) {
            this.logger.error('Error creating admins table:', err);
            reject(err);
            return;
          }
        });

        this.db.run(createStatsTable, (err) => {
          if (err) {
            this.logger.error('Error creating stats table:', err);
            reject(err);
            return;
          }
          
          this.logger.info('All database tables created successfully');
          resolve();
        });
      });
    });
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          this.logger.error('Database query error:', err);
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  async run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          // Use console.error because 'this' is RunResult, not the class
          console.error('Database run error:', err);
          reject(err);
          return;
        }
        resolve(this);
      });
    });
  }

  async get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          this.logger.error('Database get error:', err);
          reject(err);
          return;
        }
        resolve(row);
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          this.logger.error('Error closing database:', err);
          reject(err);
          return;
        }
        this.logger.info('Database connection closed');
        resolve();
      });
    });
  }

  // Helper method to begin a transaction
  async beginTransaction(): Promise<void> {
    await this.run('BEGIN TRANSACTION');
  }

  // Helper method to commit a transaction
  async commitTransaction(): Promise<void> {
    await this.run('COMMIT');
  }

  // Helper method to rollback a transaction
  async rollbackTransaction(): Promise<void> {
    await this.run('ROLLBACK');
  }

  // Helper method to check if database is ready
  isReady(): boolean {
    return this.db !== undefined;
  }
} 