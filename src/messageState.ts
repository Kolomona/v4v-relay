import fs from 'fs/promises';
import { MessageState } from './types';
import winston from 'winston';

export class MessageStateManager {
  private messagesPath: string;
  private messages: MessageState;
  private logger: winston.Logger;

  constructor(logger: winston.Logger, messagesPath: string = 'MESSAGES.json') {
    this.messagesPath = messagesPath;
    this.logger = logger;
    this.messages = {
      lastImg: '',
      lastMsg: 'nothing',
      activeGUID: ''
    };
  }

  async loadMessages(): Promise<void> {
    try {
      const data = await fs.readFile(this.messagesPath, 'utf8');
      this.messages = JSON.parse(data) as MessageState;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // File doesn't exist, create it with default values
        await this.saveMessages();
      } else {
        this.logger.error('Error loading messages:', error);
      }
    }
  }

  async saveMessages(): Promise<void> {
    try {
      await fs.writeFile(this.messagesPath, JSON.stringify(this.messages, null, 2));
    } catch (error) {
      this.logger.error('Error saving messages:', error);
    }
  }

  getMessages(): MessageState {
    return { ...this.messages };
  }

  updateTimestamp(): void {
    this.messages.timestamp = Math.floor(Date.now() / 1000);
  }

  isRecentTimestamp(): boolean {
    const now = Math.floor(Date.now() / 1000);
    const then = this.messages.timestamp || 0;
    return now === then;
  }

  setActiveGUID(guid: string): void {
    this.messages.activeGUID = guid;
  }

  getActiveGUID(): string | undefined {
    return this.messages.activeGUID;
  }

  setLastMessage(message: string, image: string): void {
    this.messages.lastMsg = message;
    this.messages.lastImg = image;
  }

  getLastMessage(): { message: string; image: string } {
    return {
      message: this.messages.lastMsg || 'nothing',
      image: this.messages.lastImg || ''
    };
  }

  reset(): void {
    this.messages = {
      lastImg: '',
      lastMsg: 'nothing',
      activeGUID: ''
    };
  }

  async resetAndSave(): Promise<void> {
    this.reset();
    await this.saveMessages();
  }
}