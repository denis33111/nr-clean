import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';

export interface User {
  id: number;
  username?: string;
  firstName: string;
  lastName?: string;
  isBot: boolean;
  languageCode?: string;
  messageCount: number;
  commandCount: number;
  mostUsedCommand?: string;
  lastActive?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  notifications?: any;
  settings?: any;
}

export interface UserRegistrationData {
  id: number;
  username?: string;
  firstName: string;
  lastName?: string;
  isBot: boolean;
  languageCode?: string;
}

export class UserService {
  private database: Database;
  private logger: Logger;

  constructor(database: Database) {
    this.database = database;
    this.logger = new Logger();
  }

  async registerUser(userData: UserRegistrationData): Promise<User> {
    try {
      this.logger.dbOperation('registerUser', 'users', { userId: userData.id });

      // Check if user already exists
      const existingUser = await this.getUser(userData.id);
      if (existingUser) {
        // Update existing user
        await this.updateUser(userData.id, {
          username: userData.username || '',
          firstName: userData.firstName,
          lastName: userData.lastName || '',
          languageCode: userData.languageCode || '',
          updatedAt: new Date()
        });
        return existingUser;
      }

      // Create new user
      const sql = `
        INSERT OR IGNORE INTO users (id, username, firstName, lastName, isBot, languageCode, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      await this.database.run(sql, [
        userData.id,
        userData.username,
        userData.firstName,
        userData.lastName,
        userData.isBot,
        userData.languageCode
      ]);

      this.logger.userAction('user_registered', userData.id);
      return await this.getUser(userData.id) as User;

    } catch (error) {
      this.logger.error('Error registering user:', error);
      throw error;
    }
  }

  async getUser(userId: number): Promise<User | null> {
    try {
      this.logger.dbOperation('getUser', 'users', { userId });

      const sql = 'SELECT * FROM users WHERE id = ?';
      const user = await this.database.get(sql, [userId]);

      if (!user) {
        return null;
      }

      // Parse JSON fields
      return {
        ...user,
        notifications: user.notifications ? JSON.parse(user.notifications) : {},
        settings: user.settings ? JSON.parse(user.settings) : {},
        lastActive: user.lastActive ? new Date(user.lastActive) : undefined,
        createdAt: user.createdAt ? new Date(user.createdAt) : undefined,
        updatedAt: user.updatedAt ? new Date(user.updatedAt) : undefined
      };

    } catch (error) {
      this.logger.error('Error getting user:', error);
      throw error;
    }
  }

  async updateUser(userId: number, updates: Partial<User>): Promise<void> {
    try {
      this.logger.dbOperation('updateUser', 'users', { userId, updates });

      const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates);
      
      const sql = `UPDATE users SET ${fields}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`;
      await this.database.run(sql, [...values, userId]);

    } catch (error) {
      this.logger.error('Error updating user:', error);
      throw error;
    }
  }

  async updateUserActivity(userId: number): Promise<void> {
    try {
      this.logger.dbOperation('updateUserActivity', 'users', { userId });

      const sql = `
        UPDATE users 
        SET messageCount = messageCount + 1, 
            lastActive = CURRENT_TIMESTAMP,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      await this.database.run(sql, [userId]);

    } catch (error) {
      this.logger.error('Error updating user activity:', error);
      throw error;
    }
  }

  async incrementCommandCount(userId: number, command: string): Promise<void> {
    try {
      this.logger.dbOperation('incrementCommandCount', 'users', { userId, command });

      // Get current command usage
      const user = await this.getUser(userId);
      if (!user) return;

      // Update command count and most used command
      const sql = `
        UPDATE users 
        SET commandCount = commandCount + 1,
            mostUsedCommand = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      await this.database.run(sql, [command, userId]);

      // Log command usage
      await this.logCommandUsage(userId, command);

    } catch (error) {
      this.logger.error('Error incrementing command count:', error);
      throw error;
    }
  }

  async logCommandUsage(userId: number, command: string, args?: string[]): Promise<void> {
    try {
      this.logger.dbOperation('logCommandUsage', 'commands', { userId, command, args });

      const sql = `
        INSERT INTO commands (userId, command, args, timestamp)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `;

      await this.database.run(sql, [userId, command, args ? JSON.stringify(args) : null]);

    } catch (error) {
      this.logger.error('Error logging command usage:', error);
      throw error;
    }
  }

  async logMessage(userId: number, chatId: number, messageText: string, messageType: string = 'text'): Promise<void> {
    try {
      this.logger.dbOperation('logMessage', 'messages', { userId, chatId, messageType });

      const sql = `
        INSERT INTO messages (userId, chatId, messageText, messageType, timestamp)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      await this.database.run(sql, [userId, chatId, messageText, messageType]);

    } catch (error) {
      this.logger.error('Error logging message:', error);
      throw error;
    }
  }

  async getAllUsers(): Promise<User[]> {
    try {
      this.logger.dbOperation('getAllUsers', 'users');

      const sql = 'SELECT * FROM users ORDER BY createdAt DESC';
      const users = await this.database.query(sql);

      return users.map(user => ({
        ...user,
        notifications: user.notifications ? JSON.parse(user.notifications) : {},
        settings: user.settings ? JSON.parse(user.settings) : {},
        lastActive: user.lastActive ? new Date(user.lastActive) : undefined,
        createdAt: user.createdAt ? new Date(user.createdAt) : undefined,
        updatedAt: user.updatedAt ? new Date(user.updatedAt) : undefined
      }));

    } catch (error) {
      this.logger.error('Error getting all users:', error);
      throw error;
    }
  }

  async getActiveUsers(hours: number = 24): Promise<User[]> {
    try {
      this.logger.dbOperation('getActiveUsers', 'users', { hours });

      const sql = `
        SELECT * FROM users 
        WHERE lastActive >= datetime('now', '-${hours} hours')
        ORDER BY lastActive DESC
      `;

      const users = await this.database.query(sql);

      return users.map(user => ({
        ...user,
        notifications: user.notifications ? JSON.parse(user.notifications) : {},
        settings: user.settings ? JSON.parse(user.settings) : {},
        lastActive: user.lastActive ? new Date(user.lastActive) : undefined,
        createdAt: user.createdAt ? new Date(user.createdAt) : undefined,
        updatedAt: user.updatedAt ? new Date(user.updatedAt) : undefined
      }));

    } catch (error) {
      this.logger.error('Error getting active users:', error);
      throw error;
    }
  }

  async getNewUsersToday(): Promise<User[]> {
    try {
      this.logger.dbOperation('getNewUsersToday', 'users');

      const sql = `
        SELECT * FROM users 
        WHERE date(createdAt) = date('now')
        ORDER BY createdAt DESC
      `;

      const users = await this.database.query(sql);

      return users.map(user => ({
        ...user,
        notifications: user.notifications ? JSON.parse(user.notifications) : {},
        settings: user.settings ? JSON.parse(user.settings) : {},
        lastActive: user.lastActive ? new Date(user.lastActive) : undefined,
        createdAt: user.createdAt ? new Date(user.createdAt) : undefined,
        updatedAt: user.updatedAt ? new Date(user.updatedAt) : undefined
      }));

    } catch (error) {
      this.logger.error('Error getting new users today:', error);
      throw error;
    }
  }

  async deleteUser(userId: number): Promise<void> {
    try {
      this.logger.dbOperation('deleteUser', 'users', { userId });

      // Delete related data first
      await this.database.run('DELETE FROM messages WHERE userId = ?', [userId]);
      await this.database.run('DELETE FROM commands WHERE userId = ?', [userId]);
      await this.database.run('DELETE FROM admins WHERE userId = ?', [userId]);
      
      // Delete user
      await this.database.run('DELETE FROM users WHERE id = ?', [userId]);

      this.logger.userAction('user_deleted', userId);

    } catch (error) {
      this.logger.error('Error deleting user:', error);
      throw error;
    }
  }

  async resetUserStats(userId: number): Promise<void> {
    try {
      this.logger.dbOperation('resetUserStats', 'users', { userId });

      const sql = `
        UPDATE users 
        SET messageCount = 0,
            commandCount = 0,
            mostUsedCommand = NULL,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      await this.database.run(sql, [userId]);

      // Delete related logs
      await this.database.run('DELETE FROM messages WHERE userId = ?', [userId]);
      await this.database.run('DELETE FROM commands WHERE userId = ?', [userId]);

      this.logger.userAction('stats_reset', userId);

    } catch (error) {
      this.logger.error('Error resetting user stats:', error);
      throw error;
    }
  }

  async updateUserSettings(userId: number, settings: any): Promise<void> {
    try {
      this.logger.dbOperation('updateUserSettings', 'users', { userId, settings });

      const sql = 'UPDATE users SET settings = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?';
      await this.database.run(sql, [JSON.stringify(settings), userId]);

    } catch (error) {
      this.logger.error('Error updating user settings:', error);
      throw error;
    }
  }

  async updateUserNotifications(userId: number, notifications: any): Promise<void> {
    try {
      this.logger.dbOperation('updateUserNotifications', 'users', { userId, notifications });

      const sql = 'UPDATE users SET notifications = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?';
      await this.database.run(sql, [JSON.stringify(notifications), userId]);

    } catch (error) {
      this.logger.error('Error updating user notifications:', error);
      throw error;
    }
  }
} 