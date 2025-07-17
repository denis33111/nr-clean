import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';
import { UserService } from './UserService';

export interface BotStats {
  totalUsers: number;
  activeUsers24h: number;
  newUsersToday: number;
  totalMessages: number;
  messagesToday: number;
  averageMessagesPerUser: number;
  uptime: string;
  memoryUsage: string;
  databaseSize: string;
}

export interface BroadcastResult {
  successCount: number;
  failureCount: number;
  errors: string[];
}

export class AdminService {
  private database: Database;
  private logger: Logger;
  private userService: UserService;
  private startTime: Date;

  constructor(database: Database) {
    this.database = database;
    this.logger = new Logger();
    this.userService = new UserService(database);
    this.startTime = new Date();
  }

  async isAdmin(userId: number): Promise<boolean> {
    try {
      this.logger.dbOperation('isAdmin', 'admins', { userId });

      const sql = 'SELECT COUNT(*) as count FROM admins WHERE userId = ?';
      const result = await this.database.get(sql, [userId]);

      return result && result.count > 0;

    } catch (error) {
      this.logger.error('Error checking admin status:', error);
      return false;
    }
  }

  async addAdmin(userId: number, permissions: string[] = []): Promise<void> {
    try {
      this.logger.dbOperation('addAdmin', 'admins', { userId, permissions });

      const sql = `
        INSERT OR REPLACE INTO admins (userId, permissions, createdAt)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `;

      await this.database.run(sql, [userId, JSON.stringify(permissions)]);
      this.logger.security('admin_added', userId, { permissions });

    } catch (error) {
      this.logger.error('Error adding admin:', error);
      throw error;
    }
  }

  async removeAdmin(userId: number): Promise<void> {
    try {
      this.logger.dbOperation('removeAdmin', 'admins', { userId });

      const sql = 'DELETE FROM admins WHERE userId = ?';
      await this.database.run(sql, [userId]);

      this.logger.security('admin_removed', userId);

    } catch (error) {
      this.logger.error('Error removing admin:', error);
      throw error;
    }
  }

  async getAdmins(): Promise<any[]> {
    try {
      this.logger.dbOperation('getAdmins', 'admins');

      const sql = `
        SELECT a.*, u.firstName, u.lastName, u.username
        FROM admins a
        JOIN users u ON a.userId = u.id
        ORDER BY a.createdAt DESC
      `;

      const admins = await this.database.query(sql);

      return admins.map(admin => ({
        ...admin,
        permissions: admin.permissions ? JSON.parse(admin.permissions) : [],
        createdAt: admin.createdAt ? new Date(admin.createdAt) : undefined
      }));

    } catch (error) {
      this.logger.error('Error getting admins:', error);
      throw error;
    }
  }

  async getBotStats(): Promise<BotStats> {
    try {
      this.logger.dbOperation('getBotStats', 'stats');

      // Get user statistics
      const totalUsers = await this.getTotalUsers();
      const activeUsers24h = await this.getActiveUsers24h();
      const newUsersToday = await this.getNewUsersToday();

      // Get message statistics
      const totalMessages = await this.getTotalMessages();
      const messagesToday = await this.getMessagesToday();
      const averageMessagesPerUser = totalUsers > 0 ? Math.round((totalMessages / totalUsers) * 100) / 100 : 0;

      // Get system statistics
      const uptime = this.getUptime();
      const memoryUsage = this.getMemoryUsage();
      const databaseSize = await this.getDatabaseSize();

      return {
        totalUsers,
        activeUsers24h,
        newUsersToday,
        totalMessages,
        messagesToday,
        averageMessagesPerUser,
        uptime,
        memoryUsage,
        databaseSize
      };

    } catch (error) {
      this.logger.error('Error getting bot stats:', error);
      throw error;
    }
  }

  async getAllUsers(): Promise<any[]> {
    try {
      this.logger.dbOperation('getAllUsers', 'users');

      return await this.userService.getAllUsers();

    } catch (error) {
      this.logger.error('Error getting all users:', error);
      throw error;
    }
  }

  async broadcastMessage(message: string): Promise<BroadcastResult> {
    try {
      this.logger.dbOperation('broadcastMessage', 'users');

      const users = await this.userService.getAllUsers();
      const result: BroadcastResult = {
        successCount: 0,
        failureCount: 0,
        errors: []
      };

      // Note: In a real implementation, you would need the bot instance
      // to send messages. This is a placeholder for the logic.
      for (const user of users) {
        try {
          // This would be: await bot.sendMessage(user.id, message);
          result.successCount++;
        } catch (error) {
          result.failureCount++;
          result.errors.push(`User ${user.id}: ${error}`);
        }
      }

      this.logger.security('broadcast_sent', undefined, { 
        messageLength: message.length, 
        successCount: result.successCount,
        failureCount: result.failureCount 
      });

      return result;

    } catch (error) {
      this.logger.error('Error broadcasting message:', error);
      throw error;
    }
  }

  async banUser(userId: number, reason?: string): Promise<void> {
    try {
      this.logger.dbOperation('banUser', 'users', { userId, reason });

      // Add ban logic here
      // This could involve adding a 'banned' field to the users table
      // or creating a separate bans table

      this.logger.security('user_banned', userId, { reason });

    } catch (error) {
      this.logger.error('Error banning user:', error);
      throw error;
    }
  }

  async unbanUser(userId: number): Promise<void> {
    try {
      this.logger.dbOperation('unbanUser', 'users', { userId });

      // Add unban logic here

      this.logger.security('user_unbanned', userId);

    } catch (error) {
      this.logger.error('Error unbanning user:', error);
      throw error;
    }
  }

  async getDailyStats(date: string): Promise<any> {
    try {
      this.logger.dbOperation('getDailyStats', 'stats', { date });

      const sql = `
        SELECT * FROM stats 
        WHERE date = ?
      `;

      const stats = await this.database.get(sql, [date]);

      if (!stats) {
        // Create new stats entry for the date
        return await this.createDailyStats(date);
      }

      return stats;

    } catch (error) {
      this.logger.error('Error getting daily stats:', error);
      throw error;
    }
  }

  async updateDailyStats(): Promise<void> {
    try {
      this.logger.dbOperation('updateDailyStats', 'stats');

      const today = new Date().toISOString().split('T')[0];
      const stats = await this.getBotStats();

      const sql = `
        INSERT OR REPLACE INTO stats 
        (date, totalUsers, activeUsers, totalMessages, totalCommands, createdAt)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      await this.database.run(sql, [
        today,
        stats.totalUsers,
        stats.activeUsers24h,
        stats.totalMessages,
        0 // totalCommands would need to be calculated
      ]);

    } catch (error) {
      this.logger.error('Error updating daily stats:', error);
      throw error;
    }
  }

  private async getTotalUsers(): Promise<number> {
    const sql = 'SELECT COUNT(*) as count FROM users';
    const result = await this.database.get(sql);
    return result ? result.count : 0;
  }

  private async getActiveUsers24h(): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count 
      FROM users 
      WHERE lastActive >= datetime('now', '-24 hours')
    `;
    const result = await this.database.get(sql);
    return result ? result.count : 0;
  }

  private async getNewUsersToday(): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count 
      FROM users 
      WHERE date(createdAt) = date('now')
    `;
    const result = await this.database.get(sql);
    return result ? result.count : 0;
  }

  private async getTotalMessages(): Promise<number> {
    const sql = 'SELECT COUNT(*) as count FROM messages';
    const result = await this.database.get(sql);
    return result ? result.count : 0;
  }

  private async getMessagesToday(): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count 
      FROM messages 
      WHERE date(timestamp) = date('now')
    `;
    const result = await this.database.get(sql);
    return result ? result.count : 0;
  }

  private getUptime(): string {
    const now = new Date();
    const diff = now.getTime() - this.startTime.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  private getMemoryUsage(): string {
    const usage = process.memoryUsage();
    const rss = Math.round(usage.rss / 1024 / 1024);
    const heapUsed = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotal = Math.round(usage.heapTotal / 1024 / 1024);

    return `${heapUsed}MB / ${heapTotal}MB (RSS: ${rss}MB)`;
  }

  private async getDatabaseSize(): Promise<string> {
    try {
      const fs = require('fs');
      const dbPath = process.env.DATABASE_URL || './data/bot.db';
      
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        const sizeInMB = Math.round(stats.size / 1024 / 1024 * 100) / 100;
        return `${sizeInMB}MB`;
      }
      
      return 'Unknown';
    } catch (error) {
      return 'Unknown';
    }
  }

  private async createDailyStats(date: string): Promise<any> {
    const stats = await this.getBotStats();
    
    const sql = `
      INSERT INTO stats 
      (date, totalUsers, activeUsers, totalMessages, totalCommands, createdAt)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    await this.database.run(sql, [
      date,
      stats.totalUsers,
      stats.activeUsers24h,
      stats.totalMessages,
      0
    ]);

    return await this.getDailyStats(date);
  }
} 