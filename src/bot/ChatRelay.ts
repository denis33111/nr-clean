import TelegramBot from 'node-telegram-bot-api';
import { AdminService } from '../services/AdminService';

/**
 * ChatRelay forwards incoming user DMs to a designated admin group and allows
 * admins to reply via an inline "Reply" button. Workflow:
 * 1. Non-admin user sends a private message -> forwarded to ADMIN_GROUP_ID with
 *    a Reply button.
 * 2. When an admin presses Reply the bot stores "pending reply" for that admin
 *    (adminId -> targetUserId) and asks them to type their response.
 * 3. The next message from that admin in the group is delivered to the user
 *    and the pending state is cleared.
 */
export class ChatRelay {
  private bot: TelegramBot;
  private adminService: AdminService;
  private adminGroupId: number;

  // Map admin userId -> candidate userId they are replying to
  private pendingReplies: Map<number, number> = new Map();

  constructor(bot: TelegramBot, adminService: AdminService) {
    this.bot = bot;
    this.adminService = adminService;
    const idStr = process.env.ADMIN_GROUP_ID || '';
    const parsed = parseInt(idStr, 10);
    this.adminGroupId = isNaN(parsed) ? 0 : parsed;
    if (!this.adminGroupId) {
      console.error('[ChatRelay] ADMIN_GROUP_ID env not set – relay disabled');
      return;
    }
    this.setup();
  }

  private setup() {
    console.log(`[ChatRelay] Setup complete. Admin group ID: ${this.adminGroupId}`);
    
    // Forward candidate messages
    this.bot.on('message', async (msg) => {
      // Only private chats with users (type === 'private')
      if (!msg.from || msg.chat.type !== 'private') return;

      const fromId = msg.from.id;
      console.log(`[ChatRelay] Received message from ${fromId} in private chat`);
      
      if (await this.adminService.isAdmin(fromId)) {
        console.log(`[ChatRelay] Skipping admin message from ${fromId}`);
        return; // skip admin messages
      }
      
      if (!msg.text) return; // only handle text for now

      const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || msg.from.username || 'User';
      const forwardText = `📩 ${name} (${fromId}) wrote:\n${msg.text}`;
      
      console.log(`[ChatRelay] Forwarding message to admin group ${this.adminGroupId}: ${forwardText}`);
      
      await this.safeSend(this.adminGroupId, forwardText, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '↩️ Reply', callback_data: `reply_${fromId}` }]
          ]
        }
      });
    });

    // Handle reply button
    this.bot.on('callback_query', async (q) => {
      if (!q.data || !q.from) return;
      if (!q.data.startsWith('reply_')) return;
      if (q.message?.chat.id !== this.adminGroupId) return;

      console.log(`[ChatRelay] Reply button clicked by admin ${q.from.id}`);

      const adminId = q.from.id;
      const targetId = parseInt(q.data.replace('reply_', ''), 10);
      if (isNaN(targetId)) return;
      this.pendingReplies.set(adminId, targetId);
      await this.bot.answerCallbackQuery(q.id);
      const name = q.message?.text?.match(/^📩 (.*?) \(/)?.[1] || targetId.toString();
      await this.safeSend(this.adminGroupId, `💬 @${q.from.username || q.from.first_name}: type your reply to ${name}:`);
    });

    // Capture admin group messages to forward
    this.bot.on('message', async (msg) => {
      console.log(`[ChatRelay] Message received in chat ${msg.chat.id} from ${msg.from?.id}: ${msg.text}`);
      
      if (!msg.from) return;
      if (msg.chat.id !== this.adminGroupId) {
        console.log(`[ChatRelay] Message not in admin group (expected ${this.adminGroupId}, got ${msg.chat.id})`);
        return;
      }
      if (!msg.text || msg.text.startsWith('/')) {
        console.log(`[ChatRelay] Skipping command or empty message: ${msg.text}`);
        return; // ignore commands
      }

      const adminId = msg.from.id;
      const targetId = this.pendingReplies.get(adminId);
      console.log(`[ChatRelay] Checking pending replies for admin ${adminId}, target: ${targetId}`);
      
      if (!targetId) {
        console.log(`[ChatRelay] No pending reply for admin ${adminId}`);
        return; // not in reply mode
      }

      console.log(`[ChatRelay] Forwarding admin reply from ${adminId} to candidate ${targetId}: ${msg.text}`);

      // Send to candidate
      await this.safeSend(targetId, msg.text);
      // Confirm in group
      await this.safeSend(this.adminGroupId, `✅ Sent.`);
      this.pendingReplies.delete(adminId);
      console.log(`[ChatRelay] Reply completed and pending state cleared for admin ${adminId}`);
    });
  }

  private async safeSend(chatId: number, text: string, opts: TelegramBot.SendMessageOptions = {}) {
    try { 
      console.log(`[ChatRelay] Sending message to ${chatId}: ${text.substring(0, 50)}...`);
      await this.bot.sendMessage(chatId, text, opts); 
      console.log(`[ChatRelay] Message sent successfully to ${chatId}`);
    } catch (err) { 
      console.error('[ChatRelay] send failed', err); 
    }
  }
} 