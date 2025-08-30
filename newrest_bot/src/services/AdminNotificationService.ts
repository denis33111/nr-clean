import TelegramBot from 'node-telegram-bot-api';
import { Logger } from '../utils/Logger';

export class AdminNotificationService {
  private bot: TelegramBot;
  private logger: Logger;

  constructor(bot: TelegramBot) {
    this.bot = bot;
    this.logger = new Logger();
  }

  async notifyAdminsOfNewCandidate(
    candidateName: string,
    candidateUserId: number,
    language: 'en' | 'gr',
    rowIndex: number
  ): Promise<void> {
    try {
      const adminGroupId = process.env['ADMIN_GROUP_ID'];
      if (!adminGroupId) {
        this.logger.error('ADMIN_GROUP_ID not set - cannot notify admins');
        return;
      }

      this.logger.info(`Sending admin notification for candidate ${candidateName} (${candidateUserId}) to group ${adminGroupId}`);

      // Create notification message based on language
      const notifyText = language === 'gr'
        ? `🆕 Υποψήφιος για Βήμα-2: ${candidateName}`
        : `🆕 Candidate ready for Step-2: ${candidateName}`;

      // Create "Start evaluation" button
      const buttonText = language === 'gr' ? 'Ξεκινήστε αξιολόγηση' : 'Start evaluation';
      const inlineBtn = { 
        text: buttonText, 
        callback_data: `step2_${rowIndex}` 
      };

      const keyboard = {
        inline_keyboard: [[inlineBtn]]
      };

      // Send notification to admin group
      const chatId = parseInt(adminGroupId, 10);
      await this.bot.sendMessage(chatId, notifyText, { reply_markup: keyboard });
      
      this.logger.info(`Admin notification sent successfully to group ${adminGroupId}`);

    } catch (error) {
      this.logger.error(`Failed to send admin notification for candidate ${candidateName}:`, error);
    }
  }

  async notifyAdminsOfRegistrationCompletion(
    candidateName: string,
    candidateUserId: number,
    language: 'en' | 'gr'
  ): Promise<void> {
    try {
      const adminGroupId = process.env['ADMIN_GROUP_ID'];
      if (!adminGroupId) {
        this.logger.error('ADMIN_GROUP_ID not set - cannot notify admins');
        return;
      }

      this.logger.info(`Sending registration completion notification for ${candidateName} (${candidateUserId}) to group ${adminGroupId}`);

      // Create completion message
      const completionText = language === 'gr'
        ? `✅ Ο/Η ${candidateName} ολοκλήρωσε την εγγραφή και είναι έτοιμος/η για αξιολόγηση`
        : `✅ ${candidateName} completed registration and is ready for evaluation`;

      const chatId = parseInt(adminGroupId, 10);
      await this.bot.sendMessage(chatId, completionText);
      
      this.logger.info(`Registration completion notification sent successfully to group ${adminGroupId}`);

    } catch (error) {
      this.logger.error(`Failed to send registration completion notification for ${candidateName}:`, error);
    }
  }
}
