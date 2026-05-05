import { Client as IRCClient } from 'irc-framework';
import winston from 'winston';
import { Config } from './types';
import { parseChannels, parseAdmins } from './config';
import { MessageStateManager } from './messageState';
import { SplitKitClient } from './splitkit';

export class IRCBot {
  private client: IRCClient;
  private config: Config;
  private logger: winston.Logger;
  private messageState: MessageStateManager;
  private splitKit: SplitKitClient;
  private channels: string[];
  private admins: string[];
  private currentUrl: string = '';
  private isConnected: boolean = false;
  private messageQueue: string[] = [];
  private joinedChannels: Set<string> = new Set();

  constructor(
    config: Config, 
    logger: winston.Logger, 
    messageState: MessageStateManager,
    splitKit: SplitKitClient
  ) {
    this.config = config;
    this.logger = logger;
    this.messageState = messageState;
    this.splitKit = splitKit;
    this.channels = parseChannels(config.CHANNELS);
    this.admins = parseAdmins(config.ADMINS);

    this.client = new IRCClient();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('registered', async () => {
      this.logger.info('Connected to IRC server');
      
      // Identify with NickServ
      if (this.config.NSPASS) {
        this.client.say('NickServ', `IDENTIFY ${this.config.NSPASS}`);
        
        // Wait for NickServ response
        await new Promise<void>((resolve) => {
          const handler = (event: any) => {
            if (event.nick === 'NickServ' && event.message.includes('Password accepted')) {
              this.client.off('privmsg', handler);
              resolve();
            }
          };
          this.client.on('privmsg', handler);
          
          // Timeout after 10 seconds
          setTimeout(() => {
            this.client.off('privmsg', handler);
            resolve();
          }, 10000);
        });
      }

      // Join channels and track them
      for (const channel of this.channels) {
        this.logger.debug(`Joining ${channel}`);
        this.client.join(channel);
        this.joinedChannels.add(channel);
      }

      // Add a small delay to ensure user object is populated
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mark as connected and process queued messages
      this.isConnected = true;
      this.logger.debug(`IRC user object available: ${!!this.client.user}`);
      await this.processQueuedMessages();

      // Connect to Split Kit if URL is provided
      if (this.config.URL) {
        await this.connectToSplitKit(this.config.URL);
      } else {
        // Reset messages if no URL
        await this.messageState.resetAndSave();
      }
    });

    this.client.on('privmsg', async (event: any) => {
      await this.handleMessage(event);
    });

    this.client.on('close', () => {
      this.logger.info('Disconnected from IRC server');
      this.isConnected = false;
    });

    this.client.on('error', (error: unknown) => {
      this.logger.error('IRC error:', error);
    });
  }

  private async handleMessage(event: any): Promise<void> {
    const { nick, target, message } = event;
    
    // Handle IRC commands
    if (message.startsWith(this.config.COMMAND_PREFIX)) {
      await this.handleCommand(nick, target, message);
    }
  }

  private async handleCommand(sender: string, target: string, message: string): Promise<void> {
    const isAdmin = this.admins.includes(sender);
    const prefix = this.config.COMMAND_PREFIX || '`';
    const command = message.toLowerCase();
    const prefixLower = prefix.toLowerCase();

    try {
      if (command.startsWith(`${prefixLower}reset`)) {
        if (!isAdmin) return;
        await this.handleReset(target);
      } else if (command.startsWith(`${prefixLower}join `)) {
        if (!isAdmin) return;
        await this.handleJoin(sender, message);
      } else if (command.startsWith(`${prefixLower}part`)) {
        if (!isAdmin) return;
        await this.handlePart(sender, target);
      } else if (command.startsWith(`${prefixLower}linkme`)) {
        await this.handleLinkme(target);
      } else if (command.startsWith(`${prefixLower}connect `)) {
        if (!isAdmin) return;
        await this.handleConnect(target, message);
      } else if (command.startsWith(`${prefixLower}quit`)) {
        if (!isAdmin) return;
        await this.handleQuit(message);
      } else if (command.startsWith(`${prefixLower}disconnect`)) {
        if (!isAdmin) return;
        await this.handleDisconnect(target);
      } else if (command.startsWith(`${prefixLower}reload`)) {
        if (!isAdmin) return;
        await this.handleReload(target);
      } else if (command.startsWith(`${prefixLower}np`)) {
        await this.handleNowPlaying(target);
      } else if (command.startsWith(`${prefixLower}ping`)) {
        await this.handlePing(target, message);
      } else if (command.startsWith(`${prefixLower}help`)) {
        await this.handleHelp(target);
      }
    } catch (error) {
      this.logger.error('Error handling command:', error);
      if (isAdmin && this.admins[0]) {
        this.client.say(this.admins[0], `Error handling command: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async handleReset(target: string): Promise<void> {
    try {
      await this.messageState.resetAndSave();
      
      // Leave all channels except testing; snapshot before clearing set
      const currentChannels = Array.from(this.joinedChannels);
      
      // Reset channels tracking (will re-add #skr below)
      this.channels = [];
      this.joinedChannels.clear();

      for (const channel of currentChannels) {
        if (channel !== '#skr') {
          this.client.part(channel);
        }
      }
      
      // Rejoin testing channel
      this.channels.push('#skr');
      this.client.join('#skr');
      this.joinedChannels.add('#skr');
      
      this.client.say(target, 'Done');
    } catch (error) {
      this.logger.error('Reset error:', error);
      if (this.admins[0]) {
        this.client.say(this.admins[0], `Error resetting: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async handleJoin(sender: string, message: string): Promise<void> {
    const channel = message.split(' ')[1];
    if (!channel) return;

    try {
      this.client.join(channel);
      this.channels.push(channel);
      this.joinedChannels.add(channel);
    } catch (error) {
      this.logger.error('Join error:', error);
      if (this.admins[0]) {
        this.client.say(this.admins[0], `Error joining ${channel}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async handlePart(sender: string, target: string): Promise<void> {
    try {
      const channelIndex = this.channels.indexOf(target);
      if (channelIndex > -1) {
        this.channels.splice(channelIndex, 1);
      }
      this.joinedChannels.delete(target);
      
      this.client.part(target, 'adios');
      if (this.admins[0]) {
        this.client.say(this.admins[0], `Left ${target}`);
      }
    } catch (error) {
      this.logger.error('Part error:', error);
    }
  }

  private async handleLinkme(target: string): Promise<void> {
    if (this.currentUrl) {
      const uuid = this.currentUrl.split('=')[1];
      this.client.say(target, `Follow along at: https://thesplitkit.com/live/${uuid}`);
    } else {
      this.client.say(target, "I'm not connected to an event.");
    }
  }

  private async handleConnect(target: string, message: string): Promise<void> {
    try {
      let url = message.split(' ').slice(1).join(' ').trim();
      
      if (!url) {
        url = this.config.URL || '';
      }

      if (!url) {
        this.client.say(target, "No URL provided");
        return;
      }

      await this.connectToSplitKit(url);
      
      const uuid = url.includes('splitkit') 
        ? url.split('live/')[1]?.replace('/', '')
        : url.split('=')[1];
        
      const followUrl = `https://thesplitkit.com/live/${uuid}`;
      this.client.say(target, `Connected! Follow along at: ${followUrl}`);
    } catch (error) {
      this.logger.error('Connect error:', error);
      this.client.say(target, "I couldn't connect");
    }
  }

  private async connectToSplitKit(url: string): Promise<void> {
    let processedUrl = url;
    
    if (url.includes('splitkit')) {
      const uuid = url.split('live/')[1]?.replace('/', '');
      processedUrl = `https://curiohoster.com/event?event_id=${uuid}`;
    }

    await this.messageState.resetAndSave();
    await this.splitKit.connect(processedUrl);
    this.currentUrl = processedUrl;
  }

  private async handleQuit(message: string): Promise<void> {
    try {
      await this.messageState.saveMessages();
    } catch (error) {
      this.logger.error('Error saving messages on quit:', error);
    }

    const quitMessage = message.split(' ').slice(1).join(' ').trim() || 'Goodbye!';
    await this.splitKit.disconnect();
    this.client.quit(quitMessage);
  }

  private async handleDisconnect(target: string): Promise<void> {
    await this.splitKit.disconnect();
    this.client.say(target, 'Disconnected');
  }

  private async handleReload(target: string): Promise<void> {
    // Note: In a real implementation, you'd need to reload the config
    // For now, just acknowledge the command
    this.client.say(target, 'OK');
  }

  private async handleNowPlaying(target: string): Promise<void> {
    const { image, message } = this.messageState.getLastMessage();
    
    if (image) {
      this.client.say(target, image);
    }
    this.client.say(target, `Now Playing: ${message}`);
  }

  private async handlePing(target: string, message: string): Promise<void> {
    const cmdLen = (this.config.COMMAND_PREFIX || '`').length + 'ping'.length;
    const suffix = message.slice(cmdLen); // Remove '<prefix>ping'
    this.client.say(target, `pong${suffix}`);
  }

  private async handleHelp(target: string): Promise<void> {
    const p = this.config.COMMAND_PREFIX || '`';
    this.client.say(target, `Commands: \x02${p}help\x02 (show commands), \x02${p}linkme\x02 (event link), \x02${p}np\x02 (now playing), \x02${p}ping\x02 (test response) | Admin: \x02${p}connect\x02 (join event), \x02${p}disconnect\x02 (leave event), \x02${p}join\x02 (join channel), \x02${p}part\x02 (leave channel), \x02${p}reset\x02 (reset bot), \x02${p}reload\x02 (reload config), \x02${p}quit\x02 (shutdown bot)`);
  }

  async sendMessageToChannels(message: string): Promise<void> {
    if (!this.isConnected) {
      // Queue message until IRC is connected
      this.messageQueue.push(message);
      this.logger.debug(`Queued message: ${message}`);
      return;
    }

    try {
      // Use tracked channels as fallback if user.channels is not available
      let channelsToUse: string[] = [];
      
      if (this.client.user && this.client.user.channels) {
        channelsToUse = Array.from(this.client.user.channels.keys());
        this.logger.debug(`Using user.channels: ${channelsToUse.join(', ')}`);
      } else {
        channelsToUse = Array.from(this.joinedChannels);
        this.logger.debug(`Using fallback joinedChannels: ${channelsToUse.join(', ')}`);
      }

      if (channelsToUse.length === 0) {
        this.logger.warn('No channels available to send message to, re-queuing');
        this.messageQueue.push(message);
        return;
      }

      for (const channel of channelsToUse) {
        this.logger.debug(`Sending to ${channel}: ${message}`);
        this.client.say(channel, message);
      }
    } catch (error) {
      this.logger.error('Error sending message to channels:', error);
      // Re-queue the message to try again later
      this.messageQueue.push(message);
    }
  }

  private async processQueuedMessages(): Promise<void> {
    if (this.messageQueue.length === 0) return;
    
    this.logger.info(`Processing ${this.messageQueue.length} queued messages`);
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    
    for (const message of messages) {
      await this.sendMessageToChannels(message);
      // Small delay between messages to avoid flooding
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  connect(): void {
    const port = parseInt(this.config.PORT);
    const secure = this.config.SECURE?.toLowerCase() === 'true';

    this.client.connect({
      host: this.config.HOST,
      port: port,
      tls: secure,
      nick: this.config.NICK,
      username: this.config.USER,
      gecos: this.config.REALNAME
    });
  }

  disconnect(): void {
    this.client.quit('Bot shutting down');
  }
}