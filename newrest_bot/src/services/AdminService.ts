import { Logger } from '../utils/Logger';

export interface AdminSession {
  row: number;
  step: number;
  answers: Record<string, string>;
  agreed?: boolean;
  position?: string;
  awaitingCustomDate?: boolean;
  rejectionChoice?: 'only' | 'alt';
  lastActivity: number;
  awaitingRescheduleDate?: boolean;
  candidateName?: string;
  candidateUserId?: number | undefined;
  candidateLanguage?: string;
}

export class AdminService {
  private logger: Logger;

  constructor() {
    this.logger = new Logger();
  }

  async isAdmin(userId: number, chatId?: number, bot?: any): Promise<boolean> {
    try {
      this.logger.info(`Checking admin status for user ${userId} in chat ${chatId}`);

      // For now, we'll use a simple approach - check if user is admin in Telegram group
      // Later we can add database-based admin management
      if (!chatId || !bot) {
        this.logger.warn(`Cannot check admin status: missing chatId or bot instance`);
        return false;
      }

      try {
        const chatMember = await bot.getChatMember(chatId, userId);
        const isGroupAdmin = chatMember.status === 'administrator' || chatMember.status === 'creator';
        
        if (isGroupAdmin) {
          this.logger.info(`User ${userId} is admin in Telegram group ${chatId}`);
          return true;
        }
        
        this.logger.info(`User ${userId} is NOT admin in Telegram group ${chatId}`);
        return false;
      } catch (telegramError) {
        this.logger.warn(`Could not check Telegram permissions for user ${userId}:`, telegramError);
        return false;
      }

    } catch (error) {
      this.logger.error('Error checking admin status:', error);
      return false;
    }
  }

  async addAdmin(userId: number, permissions: string[] = []): Promise<void> {
    // TODO: Implement database-based admin management
    this.logger.info(`Adding admin ${userId} with permissions: ${permissions.join(', ')}`);
  }

  async removeAdmin(userId: number): Promise<void> {
    // TODO: Implement database-based admin management
    this.logger.info(`Removing admin ${userId}`);
  }
}
