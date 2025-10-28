import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import winston from 'winston';
import { SplitKitData, YourlsParams, YourlsResponse, Config } from './types';
import { MessageStateManager } from './messageState';

export class SplitKitClient {
  private socket: Socket | null = null;
  private config: Config;
  private logger: winston.Logger;
  private messageState: MessageStateManager;
  private onMessageCallback?: (image: string, message: string) => Promise<void>;

  constructor(config: Config, logger: winston.Logger, messageState: MessageStateManager) {
    this.config = config;
    this.logger = logger;
    this.messageState = messageState;
  }

  setMessageCallback(callback: (image: string, message: string) => Promise<void>): void {
    this.onMessageCallback = callback;
  }

  async connect(url: string): Promise<void> {
    if (this.socket) {
      await this.disconnect();
    }

    this.socket = io(url, {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      this.logger.info('Connection established to Split Kit');
    });

    this.socket.on('disconnect', () => {
      this.logger.info('Disconnected from Split Kit server');
    });

    this.socket.on('remoteValue', async (data: SplitKitData) => {
      await this.handleMessage(data);
    });

    this.socket.on('connect_error', (error) => {
      this.logger.error('Connection error:', error);
    });

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not initialized'));
        return;
      }

      this.socket.on('connect', () => resolve());
      this.socket.on('connect_error', (error) => reject(error));
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private async handleMessage(data: SplitKitData): Promise<void> {
    try {
      // Remove value information that the relay doesn't use
      if ('value' in data) {
        delete data.value;
      }

      this.logger.info(`Event received: remoteValue\nMessage: ${JSON.stringify(data)}`);

      // Check timestamp to prevent spam
      if (this.messageState.isRecentTimestamp()) {
        return;
      }
      this.messageState.updateTimestamp();

      // If no data, set last message to nothing
      if (!data || Object.keys(data).length === 0) {
        this.messageState.setLastMessage('nothing', '');
        return;
      }

      // Compare GUID to prevent duplicate messages
      const guid = data.blockGuid || 'guid';
      this.logger.info(`GUIDS: ${guid} || ${this.messageState.getActiveGUID()}`);
      
      if (guid === this.messageState.getActiveGUID()) {
        return;
      }

      // Process image URL
      let image = data.image || 'N/A';
      
      // Wavlake fix
      if (image.includes('cloudfront')) {
        const encodedUrl = encodeURIComponent(image);
        image = `https://www.wavlake.com/_next/image?url=${encodedUrl}&w=750&q=75`;
      }

      // Shorten image URL
      const shortImage = await this.shortenUrl(image);

      // Process title
      const textToStrip = this.config.TEXTTOSTRIP || 'Text - click to edit';
      let title = (data.title || '').replace(textToStrip, '').trim();
      title = title.split(/\s+/).join(' '); // Normalize whitespace
      const boldTitle = `\x02${title}\x02`; // IRC bold formatting

      // Process details from line array
      const line = data.line || [''];
      const filteredLine = line.filter(item => item !== textToStrip);
      let details = filteredLine.filter(item => item).join(' • ').trim();
      
      if (details === ' • ' || details === '•') {
        details = '';
      }
      if (details) {
        details = details.split(/\s+/).join(' '); // Normalize whitespace
      }

      // Process URLs
      let urls = (data.link?.url || '').trim();
      urls = urls.replace(textToStrip, '');

      // Join everything together
      const messageParts = [boldTitle, details, urls].filter(part => part && part.trim());
      let message = messageParts.join(' - ');
      message = message.replace(/\n/g, ''); // Remove newlines
      message = message.replace(textToStrip, '');
      message = message.trim();
      message = message.split(/\s+/).join(' '); // Normalize whitespace

      // Store state for spam detection and `np` functionality
      this.messageState.setActiveGUID(guid);
      this.messageState.setLastMessage(message, shortImage);

      // Send message via callback
      if (this.onMessageCallback) {
        await this.onMessageCallback(shortImage, `Now Playing: ${message}`);
      }

    } catch (error) {
      this.logger.error('Error handling Split Kit message:', error);
    }
  }

  private async shortenUrl(url: string): Promise<string> {
    // Skip shortening if no YOURLS config
    if (!this.config.SHORTURL || !this.config.YOURLSAPIURL) {
      this.logger.debug('YOURLS not configured, using original URL');
      return url;
    }

    try {
      const params: YourlsParams = {
        signature: this.config.SHORTURL,
        action: 'shorturl',
        url: url,
        format: 'json'
      };

      this.logger.debug(`Attempting to shorten URL: ${url}`);
      const response = await axios.get<YourlsResponse>(this.config.YOURLSAPIURL, { 
        params,
        timeout: 5000 // 5 second timeout
      });
      
      if (response.data.shorturl) {
        this.logger.debug(`URL shortened: ${url} -> ${response.data.shorturl}`);
        return response.data.shorturl;
      } else {
        this.logger.warn('YOURLS response did not contain shorturl, using original URL');
        return url;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.warn(`YOURLS API error (${error.response?.status}): ${error.message}, using original URL`);
      } else {
        this.logger.warn(`Error shortening URL: ${error instanceof Error ? error.message : 'Unknown error'}, using original URL`);
      }
      return url;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}