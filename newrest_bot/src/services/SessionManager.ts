import { UserSession, RegistrationStep, UserRegistrationData } from '../types/UserSession';
import { Logger } from '../utils/Logger';

export class SessionManager {
  private sessions: Map<number, UserSession> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger();
  }

  createSession(userId: number, chatId: number): UserSession {
    const session: UserSession = {
      userId,
      chatId,
      language: 'en', // Default language
      currentStep: RegistrationStep.LANGUAGE_SELECTION,
      step: 0,
      userData: {
        name: '',
        age: '',
        phone: '',
        email: '',
        address: '',
        transport: '',
        bank: '',
        drLicence: ''
      },
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.sessions.set(userId, session);
    this.logger.info(`Created new session for user ${userId}`);
    return session;
  }

  getSession(userId: number): UserSession | undefined {
    return this.sessions.get(userId);
  }

  updateSession(userId: number, updates: Partial<UserSession>): void {
    const session = this.sessions.get(userId);
    if (session) {
      Object.assign(session, updates);
      session.lastActivity = new Date();
      this.logger.info(`Updated session for user ${userId}, step: ${updates.currentStep || session.currentStep}`);
    }
  }

  updateUserData(userId: number, field: keyof UserRegistrationData, value: string): void {
    const session = this.sessions.get(userId);
    if (session) {
      // Handle each field specifically to avoid type issues
      if (field === 'name') session.userData.name = value;
      else if (field === 'age') session.userData.age = value;
      else if (field === 'phone') session.userData.phone = value;
      else if (field === 'email') session.userData.email = value;
      else if (field === 'address') session.userData.address = value;
      else if (field === 'transport') session.userData.transport = value as 'MMM' | 'VEHICLE' | 'BOTH';
      else if (field === 'bank') session.userData.bank = value as 'EURO_BANK' | 'ALPHA_BANK' | 'PIRAEUS_BANK' | 'NATION_ALBANK';
              else if (field === 'drLicence') session.userData.drLicence = value as 'YES' | 'NO';
      
      session.lastActivity = new Date();
      this.logger.info(`Updated user data for user ${userId}: ${field} = ${value}`);
    }
  }

  nextStep(userId: number): void {
    const session = this.sessions.get(userId);
    if (session) {
      const currentIndex = Object.values(RegistrationStep).indexOf(session.currentStep);
      const nextIndex = currentIndex + 1;
      
      if (nextIndex < Object.values(RegistrationStep).length) {
        const nextStep = Object.values(RegistrationStep)[nextIndex];
        if (nextStep) {
          session.currentStep = nextStep;
          session.lastActivity = new Date();
          this.logger.info(`User ${userId} moved to step: ${session.currentStep}`);
        }
      }
    }
  }

  removeSession(userId: number): void {
    this.sessions.delete(userId);
    this.logger.info(`Removed session for user ${userId}`);
  }

  cleanupOldSessions(maxAgeHours: number = 24): void {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [userId, session] of this.sessions.entries()) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info(`Cleaned up ${cleanedCount} old sessions`);
    }
  }
}
