import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsClient } from '../utils/GoogleSheetsClient';

interface CourseSession {
  awaitingReason?: boolean;          // Waiting for reschedule reason input
  row: number;                      // Sheet row index
  lastActivity: number;             // Timestamp of last activity
}

// Shared session map so other modules (MessageHandler) can detect active course sessions
export const courseSessions: Map<number, CourseSession> = new Map();

export class CandidateCourseFlow {
  private bot: TelegramBot;
  private sheets: GoogleSheetsClient;
  // Use the shared map
  private sessions = courseSessions;

  // Helper to get language from header/row (defaults to 'en')
  private getLang(header: string[], row: string[]): 'en' | 'gr' {
    const idx = header.findIndex(h => {
      const norm = this.normalise(h);
      return norm === 'LANG' || norm === 'LANGUAGE';
    });
    const val = idx !== -1 ? (row[idx] || '').toLowerCase() : '';
    return val.startsWith('gr') ? 'gr' : 'en';
  }

  constructor(bot: TelegramBot, sheets: GoogleSheetsClient) {
    this.bot = bot;
    this.sheets = sheets;
    this.setupHandlers();
    this.setupSessionCleanup();
  }

  // Setup session cleanup to prevent memory leaks
  private setupSessionCleanup(): void {
    // Clean up expired sessions every 10 minutes
    setInterval(() => {
      const now = Date.now();
      const sessionTTL = 30 * 60 * 1000; // 30 minutes TTL
      let cleanedCount = 0;
      
      for (const [userId, session] of this.sessions) {
        // Check if session is too old (no activity for 30 minutes)
        const lastActivity = session.lastActivity || 0;
        if (now - lastActivity > sessionTTL) {
          this.sessions.delete(userId);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`[CandidateCourseFlow] Memory cleanup: Removed ${cleanedCount} expired sessions`);
      }
      
      // Log session count for monitoring
      if (this.sessions.size > 0) {
        console.log(`[CandidateCourseFlow] Active sessions: ${this.sessions.size}`);
      }
    }, 10 * 60 * 1000); // Every 10 minutes
  }

  private setupHandlers() {
    // Handle course_* callback buttons
    this.bot.on('callback_query', async (q) => {
      if (!q.data || !q.from) return;
      // Only allow in private chats, not group chats
      if (q.message?.chat.type !== 'private') return;
      
      const uid = q.from.id;

      if (q.data === 'course_yes') {
        await this.handleYes(uid, q.id, q.message!.chat.id);
      } else if (q.data === 'course_no') {
        await this.startDecline(uid, q.id, q.message!.chat.id);
      } else if (q.data === 'course_decline') {
        await this.finalDecline(uid, q.id, q.message!.chat.id, 'NOT_INTERESTED');
      } else if (q.data === 'course_reschedule') {
        await this.startReschedule(uid, q.id, q.message!.chat.id);
      } else if (q.data === 'alt_yes') {
        await this.handleAltYes(uid, q.id, q.message!.chat.id);
      } else if (q.data === 'alt_no') {
        await this.handleAltNo(uid, q.id, q.message!.chat.id);
      }
    });

    // Capture free-text replies (reschedule reason)
    this.bot.on('message', async (msg) => {
      if (!msg.from || !msg.text || msg.text.startsWith('/')) return;
      // Only allow in private chats, not group chats
      if (msg.chat.type !== 'private') return;
      
      const sess = this.sessions.get(msg.from.id);
      if (!sess) return;

      // Reschedule reason
      if (sess.awaitingReason) {
        await this.saveRescheduleReason(msg.from.id, msg.text.trim(), msg.chat.id, sess.row);
        // Keep session for a bit so other handlers skip duplicate replies
        setTimeout(() => this.sessions.delete(msg.from!.id), 10000);
        return;
      }
    });
  }

  // ---------------- handlers -----------------
  private async handleYes(userId: number, callbackId: string, chatId: number) {
    try {
      const { row, current, header } = await this.getRowData(userId);
      if (row === -1) return;
      
      // Update session activity
      const session = this.sessions.get(userId);
      if (session) {
        session.lastActivity = Date.now();
      }
      
      const normalise = (s: string) => s.replace(/\s|_/g, '').toUpperCase();

      header.forEach((h, idx) => {
        const key = normalise(h);
        if (key === 'COURSECONFIRMED') current[idx] = 'YES';
        if (key === 'STATUS') current[idx] = 'WORKING';
        if (key === 'REMINDER' || key === 'REMINDERSENT') current[idx] = '';
        if (key === 'STEP3') current[idx] = 'done';
      });
      
      const range = `A${row}:${String.fromCharCode(65 + header.length - 1)}${row}`;
      
      // Add error handling for Google Sheets update
      try {
        await this.sheets.updateRow(range, current);
        console.log(`[CandidateCourseFlow] Successfully updated user ${userId} status to WORKING`);
      } catch (sheetsError) {
        console.error(`[CandidateCourseFlow] Failed to update Google Sheets for user ${userId}:`, sheetsError);
        // Send error message to user
        await this.bot.sendMessage(chatId, '❌ Sorry, there was an error updating your status. Please try again later.');
        return;
      }
      
      const candidateName = this.getName(header, current) || userId.toString();
      
      // Add error handling for admin notification
      try {
        await this.notifyAdmins(`✅ ${candidateName} επιβεβαίωσε τη συμμετοχή στο μάθημα.`);
      } catch (notifyError) {
        console.error(`[CandidateCourseFlow] Failed to notify admins for user ${userId}:`, notifyError);
        // Continue with user notification even if admin notification fails
      }
      
      const lang = this.getLang(header, current);
      
      // Toast for button press
      try {
        await this.safeAnswer(callbackId, lang==='gr' ? 'Ευχαριστούμε!' : 'Thank you!');
      } catch (answerError) {
        console.error(`[CandidateCourseFlow] Failed to answer callback for user ${userId}:`, answerError);
      }
      
      // Explicit chat confirmation so conversation shows it
      try {
        await this.bot.sendMessage(chatId, lang==='gr' ? 'Ευχαριστούμε! Τα λέμε αύριο στο μάθημα! 🎉' : 'Thank you! See you tomorrow at the course! 🎉');
        console.log(`[CandidateCourseFlow] Successfully completed course confirmation for user ${userId}`);
      } catch (messageError) {
        console.error(`[CandidateCourseFlow] Failed to send confirmation message to user ${userId}:`, messageError);
      }
      
    } catch (error) {
      console.error(`[CandidateCourseFlow] Critical error in handleYes for user ${userId}:`, error);
      // Try to send error message to user
      try {
        await this.bot.sendMessage(chatId, '❌ Sorry, something went wrong. Please try again later.');
      } catch (sendError) {
        console.error(`[CandidateCourseFlow] Failed to send error message to user ${userId}:`, sendError);
      }
    }
  }

  // ----- decline workflow -----
  private async startDecline(userId: number, callbackId: string, chatId: number) {
    await this.safeAnswer(callbackId);
    const { row, current, header } = await this.getRowData(userId);
    if (row === -1) return;
    const lang = this.getLang(header,current);
    console.log(`[DEBUG] startDecline lang=${lang} userId=${userId}`);
    await this.bot.sendMessage(
      chatId,
      lang === 'gr'
        ? 'Παρακαλώ επιλέξτε:'
        : 'Please select:',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: lang === 'gr'
                  ? '🔄 Χρειάζομαι αλλαγή ημερομηνίας'
                  : '🔄 Need to reschedule',
                callback_data: 'course_reschedule',
              },
            ],
            [
              {
                text: lang === 'gr'
                  ? '❌ Δεν ενδιαφέρομαι πλέον'
                  : '❌ Not interested anymore',
                callback_data: 'course_decline',
              },
            ],
          ],
        },
      }
    );
    const sess = this.sessions.get(userId);
    if (sess) { sess.row = row; }
  }



  private async finalDecline(userId: number, callbackId: string, chatId: number, tag: string) {
    try {
      await this.safeAnswer(callbackId);
      const { row, current, header } = await this.getRowData(userId);
      if (row === -1) return;
      const lang = this.getLang(header, current);
      
      // Update session activity
      const session = this.sessions.get(userId);
      if (session) {
        session.lastActivity = Date.now();
      }
      
      const message = tag === 'NOT_INTERESTED' 
        ? (lang === 'gr' 
            ? 'Καταλαβαίνουμε. Σας ευχαριστούμε για το ενδιαφέρον και σας ευχόμαστε καλή συνέχεια! 👋'
            : 'We understand. Thank you for your interest and we wish you all the best! 👋')
        : (lang === 'gr'
            ? 'Σας ευχαριστούμε που μας ενημερώσατε. Σας ευχόμαστε καλή συνέχεια!'
            : 'Thank you for letting us know. We wish you all the best!');
      
      await this.bot.sendMessage(chatId, message);
      
      const normalise = (s: string) => s.replace(/\s|_/g, '').toUpperCase();
      header.forEach((h, idx) => {
        const key = normalise(h);
        if (key === 'COURSECONFIRMED') current[idx] = 'NO';
        if (key === 'STATUS') current[idx] = 'STOP';
        if (key === 'STEP3') current[idx] = 'cancelled';
      });
      
      const range = `A${row}:${String.fromCharCode(65 + header.length - 1)}${row}`;
      
      // Add error handling for Google Sheets update
      try {
        await this.sheets.updateRow(range, current);
        console.log(`[CandidateCourseFlow] Successfully updated user ${userId} status to STOP`);
      } catch (sheetsError) {
        console.error(`[CandidateCourseFlow] Failed to update Google Sheets for user ${userId}:`, sheetsError);
        // Send error message to user
        await this.bot.sendMessage(chatId, '❌ Sorry, there was an error updating your status. Please try again later.');
        return;
      }
      
    } catch (error) {
      console.error(`[CandidateCourseFlow] Critical error in finalDecline for user ${userId}:`, error);
      // Try to send error message to user
      try {
        await this.bot.sendMessage(chatId, '❌ Sorry, something went wrong. Please try again later.');
      } catch (sendError) {
        console.error(`[CandidateCourseFlow] Failed to send error message to user ${userId}:`, sendError);
      }
    }
  }

  private async startReschedule(userId: number, callbackId: string, chatId: number) {
    await this.safeAnswer(callbackId);
    const { row, current, header } = await this.getRowData(userId);
    const lang = this.getLang(header, current);
    
    // Create course session with lastActivity
    this.sessions.set(userId, { row, awaitingReason: true, lastActivity: Date.now() });
    
    // Update sheet immediately
    const normalise = (s: string) => s.replace(/\s|_/g, '').toUpperCase();
    header.forEach((h, idx) => {
      const key = normalise(h);
      if (key === 'COURSECONFIRMED') current[idx] = 'RESCHEDULE';
      if (key === 'STATUS') current[idx] = 'WAITING';
      if (key === 'COURSEDATE') current[idx] = 'RESCHEDULE';
    });
    const range = `A${row}:${String.fromCharCode(65 + header.length - 1)}${row}`;
    await this.sheets.updateRow(range, current);

    // Send immediate response
    await this.bot.sendMessage(
      chatId,
      lang === 'gr'
        ? 'Ευχαριστούμε! Κάποιος από την ομάδα μας θα επικοινωνήσει μαζί σας σύντομα. 😊'
        : 'Thank you! Someone from our team will contact you soon. 😊'
    );
    
    // Notify admins
    await this.notifyAdmins(`🔄 ${this.getName(header, current) || userId.toString()} ζήτησε αλλαγή ημερομηνίας.`);
  }

  private async saveRescheduleReason(userId: number, reason: string, chatId: number, row: number) {
    const header = await this.sheets.getHeaderRow();
    const rowRange = `A${row}:${String.fromCharCode(65 + header.length - 1)}${row}`;
    const rowData = await this.sheets.getRows(rowRange);
    const current = (rowData[0] as string[]) || [];
    while (current.length < header.length) current.push('');
    
    // Update session activity
    const session = this.sessions.get(userId);
    if (session) {
      session.lastActivity = Date.now();
    }
    
    const normalise = (s: string) => s.replace(/\s|_/g, '').toUpperCase();

    header.forEach((h, idx) => {
      const key = normalise(h);
      if (key === 'COURSECONFIRMED') current[idx] = 'RESCHEDULE';
      if (key === 'STATUS') current[idx] = 'WAITING';
      if (key === 'COURSEDATE') current[idx] = 'RESCHEDULE';
    });
    await this.sheets.updateRow(rowRange, current);

    const lang = this.getLang(header, current);
    await this.bot.sendMessage(
      chatId,
      lang === 'gr'
        ? 'Κάποιος από την ομάδα μας θα επικοινωνήσει μαζί σας.'
        : 'Someone from our team will contact you.'
    );
    await this.notifyAdmins(`🔄 ${this.getName(header,current) || userId.toString()} ζήτησε αλλαγή ημερομηνίας:\n${reason}`);
  }

  private async handleAltYes(userId: number, callbackId: string, chatId: number) {
    await this.bot.answerCallbackQuery(callbackId);
    
    // Update session activity
    const session = this.sessions.get(userId);
    if (session) {
      session.lastActivity = Date.now();
    }
    
    // Get candidate info and update database
    const header = await this.sheets.getHeaderRow();
    const rowsRaw = await this.sheets.getRows('A3:Z1000');
    if (!rowsRaw || !rowsRaw.length) return;
    const rows = rowsRaw as string[][];
    
    const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
    const colName = header.findIndex(h => this.normalise(h) === 'NAME');
    const colPosition = header.findIndex(h => this.normalise(h) === 'POSITION');
    const colStatus = header.findIndex(h => this.normalise(h) === 'STATUS');
    
    if (colUserId === -1 || colName === -1 || colPosition === -1 || colStatus === -1) return;
    
    const candidateRow = rows.find(row => parseInt(row[colUserId] || '0', 10) === userId);
    if (!candidateRow) return;
    
    const rowIndex = rows.indexOf(candidateRow) + 3; // +3 because we start from A3
    const candidateName = candidateRow[colName] || 'Unknown';
    const position = candidateRow[colPosition] || 'Unknown';
    
    // Update status to show candidate accepted alternative
    const rowRange = `A${rowIndex}:${String.fromCharCode(65 + header.length - 1)}${rowIndex}`;
    const rowData = await this.sheets.getRows(rowRange);
    const current = (rowData[0] as string[]) || [];
    while (current.length < header.length) current.push('');
    
    current[colStatus] = 'ALT_ACCEPTED';
    await this.sheets.updateRow(rowRange, current);
    
    // Send response to candidate
    await this.bot.sendMessage(chatId, 'Ευχαριστούμε για το ενδιαφέρον! Θα επικοινωνήσουμε μαζί σας σύντομα για διαθέσιμες θέσεις.');
    
    // Notify admins
    await this.notifyAdmins(`✅ ${candidateName} (${position}) accepted alternative position offer`);
  }

  private async handleAltNo(userId: number, callbackId: string, chatId: number) {
    await this.bot.answerCallbackQuery(callbackId);
    
    // Update session activity
    const session = this.sessions.get(userId);
    if (session) {
      session.lastActivity = Date.now();
    }
    
    // Get candidate info and update database
    const header = await this.sheets.getHeaderRow();
    const rowsRaw = await this.sheets.getRows('A3:Z1000');
    if (!rowsRaw || !rowsRaw.length) return;
    const rows = rowsRaw as string[][];
    
    const colUserId = header.findIndex(h => this.normalise(h) === 'USERID');
    const colName = header.findIndex(h => this.normalise(h) === 'NAME');
    const colPosition = header.findIndex(h => this.normalise(h) === 'POSITION');
    const colStatus = header.findIndex(h => this.normalise(h) === 'STATUS');
    
    if (colUserId === -1 || colName === -1 || colPosition === -1 || colStatus === -1) return;
    
    const candidateRow = rows.find(row => parseInt(row[colUserId] || '0', 10) === userId);
    if (!candidateRow) return;
    
    const rowIndex = rows.indexOf(candidateRow) + 3; // +3 because we start from A3
    const candidateName = candidateRow[colName] || 'Unknown';
    const position = candidateRow[colPosition] || 'Unknown';
    
    // Update status to show candidate declined alternative
    const rowRange = `A${rowIndex}:${String.fromCharCode(65 + header.length - 1)}${rowIndex}`;
    const rowData = await this.sheets.getRows(rowRange);
    const current = (rowData[0] as string[]) || [];
    while (current.length < header.length) current.push('');
    
    current[colStatus] = 'ALT_DECLINED';
    await this.sheets.updateRow(rowRange, current);
    
    // Send response to candidate
    await this.bot.sendMessage(chatId, 'Καταλαβαίνουμε. Σας ευχαριστούμε για το ενδιαφέρον και σας ευχόμαστε καλή συνέχεια! 👋');
    
    // Notify admins
    await this.notifyAdmins(`❌ ${candidateName} (${position}) declined alternative position offer`);
  }


  // ---------------- helpers -----------------
  private async getRowData(userId: number): Promise<{ row: number; header: string[]; current: string[] }> {
    const header = await this.sheets.getHeaderRow();
    const normalise = (s: string) => s.replace(/\s|_/g, '').toUpperCase();
    const uidIdx = header.findIndex(h => normalise(h) === 'USERID');
    if (uidIdx === -1) return { row: -1, header, current: [] };

    const dataRows = await this.sheets.getRows('A3:Z1000');
    if (!dataRows) return { row: -1, header, current: [] };
    const rows = dataRows as string[][];
    // Iterate from bottom to top to find the most recent entry for this user
    let match = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i] || [];
      if ((r[uidIdx] || '').trim() === userId.toString()) {
        match = i;
        break;
      }
    }
    if (match === -1) return { row: -1, header, current: [] };
    return { row: match + 3, header, current: rows[match] || [] };
  }

  private async notifyAdmins(text: string) {
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (!adminGroupId) {
      console.error('[CandidateCourseFlow] ADMIN_GROUP_ID not set - cannot notify admins');
      return;
    }
    
    try { 
      await this.bot.sendMessage(parseInt(adminGroupId, 10), text); 
    } catch (error) {
      console.error(`[CandidateCourseFlow] Failed to send admin notification to group ${adminGroupId}:`, error);
    }
  }

  private getName(header: string[], row: string[]) {
    const idx = header.findIndex(h => this.normalise(h) === 'NAME');
    return idx !== -1 ? row[idx] || '' : '';
  }

  private normalise(s: string) { return s.replace(/\s|_/g,'').toUpperCase(); }

  private async safeAnswer(id: string, text?: string) {
    try {
      await this.bot.answerCallbackQuery(id, text ? { text } : undefined);
    } catch (err: any) {
      if (err?.code !== 'ETELEGRAM') console.error(err);
    }
  }
} 