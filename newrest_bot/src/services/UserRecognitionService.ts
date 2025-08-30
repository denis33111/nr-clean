import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';
import { Logger } from '../utils/Logger';

export class UserRecognitionService {
  private sheetsClient: GoogleSheetsClient;
  private logger: Logger;

  constructor(sheetsClient: GoogleSheetsClient) {
    this.sheetsClient = sheetsClient;
    this.logger = new Logger();
  }

  async isUserRegistered(userId: number): Promise<boolean> {
    try {
      this.logger.info(`Checking if user ${userId} is registered`);
      
      const isRegistered = await this.sheetsClient.isUserInWorkersSheet(userId);
      
      this.logger.info(`User ${userId} registration status: ${isRegistered ? 'Registered' : 'Not registered'}`);
      
      return isRegistered;
    } catch (error) {
      this.logger.error(`Error checking registration status for user ${userId}:`, error);
      // If there's an error checking, assume user is not registered
      return false;
    }
  }

  async getUserInfo(userId: number): Promise<{ name: string; status: string; language: string } | null> {
    try {
      const workers = await this.sheetsClient.getWorkersSheet();
      
      // Find user in WORKERS sheet (column B = ID)
      const userRow = workers.find(row => row[1] === userId.toString());
      
      if (userRow) {
        return {
          name: userRow[0] || 'Unknown',
          status: userRow[2] || 'Unknown',
          language: userRow[3] || 'en'
        };
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Error getting user info for user ${userId}:`, error);
      return null;
    }
  }
}
