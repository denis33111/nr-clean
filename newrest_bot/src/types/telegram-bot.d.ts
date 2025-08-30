declare module 'node-telegram-bot-api' {
  import { EventEmitter } from 'events';

  export interface Message {
    message_id: number;
    from?: User;
    date: number;
    chat: Chat;
    text?: string;
    location?: Location;
  }

  export interface User {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  }

  export interface Chat {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  }

  export interface Location {
    latitude: number;
    longitude: number;
  }

  export interface CallbackQuery {
    id: string;
    from: User;
    message?: Message;
    data?: string;
  }

  export interface BotOptions {
    polling?: boolean;
    webHook?: string;
  }

  class TelegramBot extends EventEmitter {
    constructor(token: string, options?: BotOptions);
    
    onText(regexp: RegExp, callback: (msg: Message, match: RegExpExecArray | null) => void): void;
    on(event: 'message', listener: (message: Message) => void): this;
    on(event: 'callback_query', listener: (query: CallbackQuery) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'polling_error', listener: (error: Error) => void): this;
    
    sendMessage(chatId: number | string, text: string, options?: any): Promise<Message>;
    sendDocument(chatId: number | string, document: any, options?: any, extra?: any): Promise<Message>;
    answerCallbackQuery(callbackQueryId: string, options?: any): Promise<boolean>;
    setWebHook(url: string): Promise<boolean>;
    
    start(): void;
    stop(): void;
  }

  // Add namespace support
  namespace TelegramBot {
    export { Message, CallbackQuery, User, Chat, Location, BotOptions };
  }

  export = TelegramBot;
}
