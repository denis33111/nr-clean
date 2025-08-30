export interface UserSession {
  userId: number;
  chatId: number;
  language: 'en' | 'gr';
  currentStep: RegistrationStep;
  userData: UserRegistrationData;
  createdAt: Date;
  lastActivity: Date;
  step: number;
  editingKey?: string;
  reviewing?: boolean;
}

export enum RegistrationStep {
  LANGUAGE_SELECTION = 'LANGUAGE_SELECTION',
  NAME_INPUT = 'NAME_INPUT',
  AGE_INPUT = 'AGE_INPUT',
  PHONE_INPUT = 'PHONE_INPUT',
  EMAIL_INPUT = 'EMAIL_INPUT',
  ADDRESS_INPUT = 'ADDRESS_INPUT',
  TRANSPORT_INPUT = 'TRANSPORT_INPUT',
  BANK_INPUT = 'BANK_INPUT',
  DR_LICENCE_INPUT = 'DR_LICENCE_INPUT',
  REVIEW_EDIT = 'REVIEW_EDIT',
  VALIDATION_COMPLETE = 'VALIDATION_COMPLETE'
}

export interface UserRegistrationData {
  name: string;
  age: string;
  phone: string;
  email: string;
  address: string;
  transport: 'MMM' | 'VEHICLE' | 'BOTH' | '';
  bank: 'EURO_BANK' | 'ALPHA_BANK' | 'PIRAEUS_BANK' | 'NATION_ALBANK' | '';
  drLicence: 'YES' | 'NO' | '';
}
