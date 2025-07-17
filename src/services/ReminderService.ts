import TelegramBot from 'node-telegram-bot-api';
// @ts-ignore – No types for node-cron in repo
import cron from 'node-cron';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';

export class ReminderService {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient) {
    this.bot = bot;
    this.sheets = sheets;
    // Run reminder at 10:00 AM every day
    cron.schedule('0 10 * * *', () => this.sendReminders().catch(console.error));
    
    // Run no-response check at 18:00 (6 PM) every day
    cron.schedule('0 18 * * *', () => this.checkNoResponses().catch(console.error));
  }

  private normalise(s: string) { return s.replace(/\s|_/g, '').toUpperCase(); }

  private async sendReminders() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0]; // yyyy-mm-dd

    const header = await this.sheets.getHeaderRow();
    const rowsRaw = await this.sheets.getRows(`A3:${String.fromCharCode(65 + header.length)}1000`);
    if (!rowsRaw || !rowsRaw.length) return;
    const rows = rowsRaw as string[][];

    const colDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
    const colConfirmed = header.findIndex(h => this.normalise(h) === 'COURSECONFIRMED');
    const colReminder = header.findIndex(h => {
      const n = this.normalise(h);
      return n === 'REMINDER' || n === 'REMINDERSENT';
    });
    const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
    const colLang = header.findIndex(h => { const n=this.normalise(h); return n==='LANG' || n==='LANGUAGE'; });
    const nameIdx = header.findIndex(h => this.normalise(h) === 'NAME');

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const courseDate = (r[colDate] || '').trim();
      if (!courseDate || courseDate === 'TBA' || courseDate === 'RESCHEDULE') continue;
      
      // Only send reminder for courses tomorrow (1 day before)
      if (courseDate !== tomorrowStr) continue;
      
      // Skip if reminder already sent or already confirmed
      if (colReminder !== -1 && (r[colReminder] || '').trim()) continue;
      const confirmed = (r[colConfirmed] || '').trim();
      if (confirmed === 'YES') continue;

      const uidStr = r[colUserId] || '';
      const uid = parseInt(uidStr, 10);
      const langVal = (r[colLang] || '').toLowerCase();
      const lang: 'gr' | 'en' = langVal.startsWith('gr') ? 'gr' : 'en';

      const courseTime = '9:50-15:00';
      const msg = lang === 'gr'
        ? `📅 Υπενθύμιση: Η εισαγωγική εκπαίδευση είναι αύριο (${courseDate}) στις ${courseTime}.\nΠαρακαλούμε επιβεβαιώστε την παρουσία σας:`
        : `📅 Reminder: The introductory course is tomorrow (${courseDate}) at ${courseTime}.\nPlease confirm your attendance:`;

      const keyboard: TelegramBot.InlineKeyboardButton[][] = [
        [{ text: lang === 'gr' ? '✅ Θα παραβρεθώ' : '✅ I will attend', callback_data: 'course_yes' }],
        [{ text: lang === 'gr' ? '❌ Δεν μπορώ να παραβρεθώ' : '❌ I cannot attend', callback_data: 'course_no' }]
      ];

      if (!isNaN(uid)) {
        try {
          await this.bot.sendMessage(uid, msg, { reply_markup: { inline_keyboard: keyboard } });
        } catch (err) {
          console.error('Failed to DM reminder to', uid, err);
        }
      }

      // Notify admins
      const candidateName = nameIdx !== -1 ? (r[nameIdx] || uidStr) : uidStr;
      const adminText = lang === 'gr'
        ? `🔔 Υπενθύμιση στάλθηκε στον/στην ${candidateName} (μάθημα αύριο ${tomorrowStr})`
        : `🔔 Reminder sent to ${candidateName} (course tomorrow ${tomorrowStr})`;
      await this.notifyAdmins(adminText);

      // mark reminder sent
      if (colReminder !== -1) {
        r[colReminder] = new Date().toISOString();
        const rowNum = i + 3; // data starts at row 3
        const range = `A${rowNum}:${String.fromCharCode(65 + header.length - 1)}${rowNum}`;
        await this.sheets.updateRow(range, r);
      }
    }
  }

  private async checkNoResponses() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const header = await this.sheets.getHeaderRow();
    const rowsRaw = await this.sheets.getRows(`A3:${String.fromCharCode(65 + header.length)}1000`);
    if (!rowsRaw || !rowsRaw.length) return;
    const rows = rowsRaw as string[][];

    const colDate = header.findIndex(h => this.normalise(h) === 'COURSEDATE');
    const colConfirmed = header.findIndex(h => this.normalise(h) === 'COURSECONFIRMED');
    const colReminder = header.findIndex(h => {
      const n = this.normalise(h);
      return n === 'REMINDER' || n === 'REMINDERSENT';
    });
    const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
    const nameIdx = header.findIndex(h => this.normalise(h) === 'NAME');

    const noResponseCandidates: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const courseDate = (r[colDate] || '').trim();
      if (!courseDate || courseDate === 'TBA' || courseDate === 'RESCHEDULE') continue;
      
      // Check if course is tomorrow
      if (courseDate !== tomorrowStr) continue;
      
      // Check if reminder was sent but no response received
      const reminderSent = colReminder !== -1 && (r[colReminder] || '').trim();
      const confirmed = (r[colConfirmed] || '').trim();
      
      if (reminderSent && confirmed !== 'YES' && confirmed !== 'NO') {
        const candidateName = nameIdx !== -1 ? (r[nameIdx] || 'Unknown') : 'Unknown';
        noResponseCandidates.push(candidateName);
      }
    }

    // Notify admins about candidates who didn't respond
    if (noResponseCandidates.length > 0) {
      const candidateList = noResponseCandidates.join(', ');
      const adminText = `⚠️ Οι παρακάτω υποψήφιοι δεν απάντησαν στην υπενθύμιση για το μάθημα αύριο (${tomorrowStr}):\n${candidateList}`;
      await this.notifyAdmins(adminText);
    }
  }

  private async notifyAdmins(text: string) {
    const adminIds = (process.env.ADMIN_IDS || '')
      .split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(n => !isNaN(n));
    for (const id of adminIds) {
      try { await this.bot.sendMessage(id, text); } catch (_) { /* ignore */ }
    }
  }
} 