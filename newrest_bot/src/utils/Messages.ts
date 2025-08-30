export interface LanguageMessages {
  [key: string]: {
    en: string;
    gr: string;
  };
}

export const REGISTRATION_MESSAGES: LanguageMessages = {
  LANGUAGE_SELECTION: {
    en: 'Please select your language',
    gr: 'Παρακαλώ επιλέξτε γλώσσα'
  },
  
  NAME_PROMPT: {
    en: 'Please enter your full name (First and Last Name)',
    gr: 'Παρακαλώ εισάγετε το πλήρες όνομά σας (Όνομα και Επώνυμο)'
  },
  
  AGE_PROMPT: {
    en: 'Please enter your age',
    gr: 'Παρακαλώ εισάγετε την ηλικία σας'
  },
  
  ADDRESS_PROMPT: {
    en: 'Please enter your full address',
    gr: 'Παρακαλώ εισάγετε την πλήρη διεύθυνσή σας'
  },
  
  PHONE_PROMPT: {
    en: 'Please enter your phone number',
    gr: 'Παρακαλώ εισάγετε τον αριθμό τηλεφώνου σας'
  },
  
  EMAIL_PROMPT: {
    en: 'Please enter your email address',
    gr: 'Παρακαλώ εισάγετε τη διεύθυνση email σας'
  },
  
  TRANSPORT_PROMPT: {
    en: 'Please select your transportation method',
    gr: 'Παρακαλώ επιλέξτε το μέσο μεταφοράς σας'
  },
  
  BANK_PROMPT: {
    en: 'Please select your bank',
    gr: 'Παρακαλώ επιλέξτε την τράπεζά σας'
  },
  
  DR_LICENCE_PROMPT: {
    en: 'Do you have a driving license?',
    gr: 'Έχετε δίπλωμα οδήγησης;'
  },
  
  REVIEW_TITLE: {
    en: '📋 Registration Review\n\nPlease review your information:',
    gr: '📋 Επιθεώρηση Εγγραφής\n\nΠαρακαλώ ελέγξτε τις πληροφορίες σας:'
  },
  
  REVIEW_EDIT_PROMPT: {
    en: 'Is this information correct? You can edit any field if needed.',
    gr: 'Είναι σωστές αυτές οι πληροφορίες; Μπορείτε να επεξεργαστείτε οποιοδήποτε πεδίο εάν χρειάζεται.'
  },
  
  EDIT_PROMPT: {
    en: 'Which field would you like to edit?',
    gr: 'Ποιο πεδίο θα θέλατε να επεξεργαστείτε;'
  },
  
  SAVE_SUCCESS: {
    en: '✅ Your registration has been saved successfully!\n\nWe will review your information and contact you soon.',
    gr: '✅ Η εγγραφή σας αποθηκεύτηκε με επιτυχία!\n\nΘα ελέγξουμε τις πληροφορίες σας και θα επικοινωνήσουμε μαζί σας σύντομα.'
  },
  
  CONTACT_BUTTON: {
    en: '📱 Contact ',
    gr: '📱 Επικοινωνία '
  },
  
  BACK_TO_MENU: {
    en: '🔙 Back to Menu',
    gr: '🔙 Επιστροφή στο Μενού'
  },
  
  YES: {
    en: 'Yes',
    gr: 'Ναι'
  },
  
  NO: {
    en: 'No',
    gr: 'Όχι'
  },
  
  EDIT: {
    en: '✏️ Edit',
    gr: '✏️ Επεξεργασία'
  },
  
  SAVE: {
    en: '💾 Save',
    gr: '💾 Αποθήκευση'
  },
  
  CONFIRM_REGISTRATION: {
    en: '✅ Confirm Registration',
    gr: '✅ Επιβεβαίωση Εγγραφής'
  },
  
  REVIEW_CLICK_TO_EDIT: {
    en: 'Click any field above to edit it.',
    gr: 'Κάντε κλικ σε οποιοδήποτε πεδίο παραπάνω για να το επεξεργαστείτε.'
  },
  
  EDITING_HEADER: {
    en: '✏️ Editing:',
    gr: '✏️ Επεξεργασία:'
  },
  
  FIELD_UPDATED: {
    en: '✅ Field updated successfully!\n\nReturning to review...',
    gr: '✅ Το πεδίο ενημερώθηκε επιτυχώς!\n\nΕπιστροφή στην αναθεώρηση...'
  },
  
  // Button labels for dropdown options (Greek display, English values)
  BUTTON_YES: {
    en: 'YES',
    gr: 'ΝΑΙ'
  },
  
  BUTTON_NO: {
    en: 'NO', 
    gr: 'ΟΧΙ'
  },
  
  BUTTON_MMM: {
    en: 'MMM',
    gr: 'ΜΜΜ'
  },
  
  BUTTON_VEHICLE: {
    en: 'VEHICLE',
    gr: 'ΟΧΗΜΑ'
  },
  
  BUTTON_BOTH: {
    en: 'BOTH',
    gr: 'ΚΑΙ ΤΑ ΔΥΟ'
  },
  
  BUTTON_EURO_BANK: {
    en: 'EURO_BANK',
    gr: 'ΕΥΡΩ_ΤΡΑΠΕΖΑ'
  },
  
  BUTTON_ALPHA_BANK: {
    en: 'ALPHA_BANK',
    gr: 'ΑΛΦΑ_ΤΡΑΠΕΖΑ'
  },
  
  BUTTON_PIRAEUS_BANK: {
    en: 'PIRAEUS_BANK',
    gr: 'ΠΕΙΡΑΙΩΣ_ΤΡΑΠΕΖΑ'
  },
  
  BUTTON_NATION_ALBANK: {
    en: 'NATION_ALBANK',
    gr: 'ΕΘΝΙΚΗ_ΤΡΑΠΕΖΑ'
  },
  
  // Field names for review display
  FIELD_NAME: {
    en: 'NAME',
    gr: 'ΟΝΟΜΑ'
  },
  
  FIELD_AGE: {
    en: 'AGE',
    gr: 'ΗΛΙΚΙΑ'
  },
  
  FIELD_PHONE: {
    en: 'PHONE',
    gr: 'ΤΗΛΕΦΩΝΟ'
  },
  
  FIELD_EMAIL: {
    en: 'EMAIL',
    gr: 'EMAIL'
  },
  
  FIELD_ADDRESS: {
    en: 'ADDRESS',
    gr: 'ΔΙΕΥΘΥΝΣΗ'
  },
  
  FIELD_TRANSPORT: {
    en: 'TRANSPORT',
    gr: 'ΜΕΤΑΦΟΡΑ'
  },
  
  FIELD_BANK: {
    en: 'BANK',
    gr: 'ΤΡΑΠΕΖΑ'
  },
  
  FIELD_DR_LICENCE: {
    en: 'DR_LICENCE',
    gr: 'ΔΙΠΛΩΜΑ_ΟΔΗΓΗΣΗΣ'
  }
};

export function getMessage(key: string, language: 'en' | 'gr'): string {
  const message = REGISTRATION_MESSAGES[key];
  if (!message) {
    return `Message not found: ${key}`;
  }
  return message[language];
}

/**
 * Get localized button text for dropdown options
 * @param option The English option value (e.g., 'YES', 'VEHICLE')
 * @param language The user's language preference
 * @returns The localized button text
 */
export function getButtonText(option: string, language: 'en' | 'gr'): string {
  const buttonKey = `BUTTON_${option}` as keyof typeof REGISTRATION_MESSAGES;
  const message = REGISTRATION_MESSAGES[buttonKey];
  
  if (message) {
    return message[language];
  }
  
  // Fallback to original option if no localized version found
  return option;
}

/**
 * Get localized field name for review display
 * @param fieldKey The field key (e.g., 'NAME', 'AGE')
 * @param language The user's language preference
 * @returns The localized field name
 */
export function getFieldName(fieldKey: string, language: 'en' | 'gr'): string {
  const fieldMessageKey = `FIELD_${fieldKey}` as keyof typeof REGISTRATION_MESSAGES;
  const message = REGISTRATION_MESSAGES[fieldMessageKey];
  
  if (message) {
    return message[language];
  }
  
  // Fallback to original field key if no localized version found
  return fieldKey;
}


