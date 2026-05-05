import { Client as IRCClient } from 'irc-framework';
import winston from 'winston';
import { Config } from './types';
import { parseChannels, parseAdmins } from './config';
import { MessageStateManager } from './messageState';
import { SplitKitClient } from './splitkit';
import { checkKarma, reloadKarmaMessages } from './karma';

export class IRCBot {
  private client: IRCClient;
  private config: Config;
  private logger: winston.Logger;
  private messageState: MessageStateManager;
  private channels: string[];
  private admins: string[];
  private isConnected: boolean = false;
  private messageQueue: string[] = [];
  private joinedChannels: Set<string> = new Set();
  private splitKitConnections: Map<string, SplitKitClient> = new Map();
  private urlSubscribers: Map<string, Set<string>> = new Map();
  private roomSubscriptions: Map<string, Set<string>> = new Map();

  constructor(
    config: Config, 
    logger: winston.Logger, 
    messageState: MessageStateManager
  ) {
    this.config = config;
    this.logger = logger;
    this.messageState = messageState;
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

      // Subscribe all joined channels to default URL if provided.
      if (this.config.URL) {
        for (const channel of this.joinedChannels) {
          try {
            await this.subscribeRoomToUrl(channel, this.config.URL);
          } catch (error) {
            this.logger.error(`Failed to subscribe ${channel} to default URL:`, error);
          }
        }
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

    const karmaResponse = checkKarma(message);
    if (karmaResponse) {
      this.client.say(target, karmaResponse);
    }

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
      } else if (command === `${prefixLower}connect` || command.startsWith(`${prefixLower}connect `)) {
        if (!isAdmin) return;
        await this.handleConnect(target, message);
      } else if (command.startsWith(`${prefixLower}quit`)) {
        if (!isAdmin) return;
        await this.handleQuit(message);
      } else if (command.startsWith(`${prefixLower}disconnect`)) {
        if (!isAdmin) return;
        await this.handleDisconnect(target);
      } else if (command.startsWith(`${prefixLower}subscriptions`)) {
        if (!isAdmin) return;
        await this.handleSubscriptions(target);
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

      for (const channel of currentChannels) {
        await this.unsubscribeRoomFromAllUrls(channel);
      }
      
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
      await this.unsubscribeRoomFromAllUrls(target);

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
    const urls = this.roomSubscriptions.get(target);
    const currentRoomUrl = urls?.values().next().value;

    if (!currentRoomUrl) {
      this.client.say(target, "I'm not connected to an event.");
      return;
    }

    const followUrl = this.buildFollowUrl(currentRoomUrl);
    if (followUrl) {
      this.client.say(target, `Follow along at: ${followUrl}`);
    } else {
      this.client.say(target, "I'm connected, but couldn't build a follow link for this URL.");
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

      const subscriptionResult = await this.subscribeRoomToUrl(target, url);
      const followUrl = this.buildFollowUrl(subscriptionResult.processedUrl);

      if (subscriptionResult.alreadySubscribed) {
        this.client.say(target, 'Already subscribed in this room.');
        return;
      }

      if (subscriptionResult.createdConnection) {
        this.client.say(target, followUrl ? `Connected! Follow along at: ${followUrl}` : 'Connected!');
      } else {
        this.client.say(target, followUrl ? `Subscribed to existing connection. Follow along at: ${followUrl}` : 'Subscribed to existing connection.');
      }
    } catch (error) {
      this.logger.error('Connect error:', error);
      this.client.say(target, "I couldn't connect");
    }
  }

  private async handleQuit(message: string): Promise<void> {
    try {
      await this.messageState.saveMessages();
    } catch (error) {
      this.logger.error('Error saving messages on quit:', error);
    }

    const quitMessage = message.split(' ').slice(1).join(' ').trim() || 'Goodbye!';
    await this.disconnectAllSplitKitConnections();
    this.client.quit(quitMessage);
  }

  private async handleDisconnect(target: string): Promise<void> {
    const roomUrls = this.roomSubscriptions.get(target);
    if (!roomUrls || roomUrls.size === 0) {
      this.client.say(target, 'This room is not subscribed to any events.');
      return;
    }

    const urls = Array.from(roomUrls);
    for (const url of urls) {
      await this.unsubscribeRoomFromUrl(target, url);
    }

    this.client.say(target, 'Disconnected this room from all subscribed events.');
  }

  private async handleReload(target: string): Promise<void> {
    reloadKarmaMessages();
    this.client.say(target, 'OK');
  }

  private async handleSubscriptions(target: string): Promise<void> {
    if (this.splitKitConnections.size === 0) {
      this.client.say(target, 'No active websocket connections.');
      return;
    }

    const roomUrls = this.roomSubscriptions.get(target);
    if (!roomUrls || roomUrls.size === 0) {
      this.client.say(target, 'This room is not subscribed to any events.');
    } else {
      this.client.say(target, `This room subscriptions: ${Array.from(roomUrls).join(' | ')}`);
    }

    this.client.say(target, `Active websocket connections: ${this.splitKitConnections.size}`);
    for (const [url, subscribers] of this.urlSubscribers.entries()) {
      this.client.say(target, `${url} <= ${Array.from(subscribers).join(', ')}`);
    }
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
    this.client.say(target, `Commands: \x02${p}help\x02 (show commands), \x02${p}linkme\x02 (event link), \x02${p}np\x02 (now playing), \x02${p}ping\x02 (test response) | Admin: \x02${p}connect\x02 (join event), \x02${p}disconnect\x02 (leave event), \x02${p}subscriptions\x02 (show room/url subscriptions), \x02${p}join\x02 (join channel), \x02${p}part\x02 (leave channel), \x02${p}reset\x02 (reset bot), \x02${p}reload\x02 (reload config), \x02${p}quit\x02 (shutdown bot)`);
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

  private async sendMessageToRooms(rooms: Iterable<string>, message: string): Promise<void> {
    if (!this.isConnected) {
      this.logger.debug(`Dropping room-scoped message while IRC disconnected: ${message}`);
      return;
    }

    for (const room of rooms) {
      if (!this.joinedChannels.has(room)) {
        continue;
      }

      this.logger.debug(`Sending room-scoped message to ${room}: ${message}`);
      this.client.say(room, message);
    }
  }

  private normalizeSplitKitUrl(url: string): string {
    const trimmedUrl = url.trim();
    const splitkitMatch = trimmedUrl.match(/\/live\/([a-f0-9-]+)/i);
    if (splitkitMatch?.[1]) {
      return `https://curiohoster.com/event?event_id=${splitkitMatch[1]}`;
    }

    return trimmedUrl;
  }

  private extractEventId(url: string): string | undefined {
    const eventIdMatch = url.match(/[?&]event_id=([a-f0-9-]+)/i);
    if (eventIdMatch?.[1]) {
      return eventIdMatch[1];
    }

    const liveMatch = url.match(/\/live\/([a-f0-9-]+)/i);
    return liveMatch?.[1];
  }

  private buildFollowUrl(url: string): string | undefined {
    const eventId = this.extractEventId(url);
    if (!eventId) {
      return undefined;
    }

    return `https://thesplitkit.com/live/${eventId}`;
  }

  private async subscribeRoomToUrl(room: string, rawUrl: string): Promise<{ processedUrl: string; createdConnection: boolean; alreadySubscribed: boolean }> {
    const processedUrl = this.normalizeSplitKitUrl(rawUrl);

    let roomUrls = this.roomSubscriptions.get(room);
    if (!roomUrls) {
      roomUrls = new Set<string>();
      this.roomSubscriptions.set(room, roomUrls);
    }

    if (roomUrls.has(processedUrl)) {
      return { processedUrl, createdConnection: false, alreadySubscribed: true };
    }

    roomUrls.add(processedUrl);

    let subscribers = this.urlSubscribers.get(processedUrl);
    if (!subscribers) {
      subscribers = new Set<string>();
      this.urlSubscribers.set(processedUrl, subscribers);
    }
    subscribers.add(room);

    const existingConnection = this.splitKitConnections.get(processedUrl);
    if (existingConnection) {
      return { processedUrl, createdConnection: false, alreadySubscribed: false };
    }

    const splitKitClient = new SplitKitClient(this.config, this.logger, this.messageState);
    splitKitClient.setMessageCallback(async (image: string, message: string) => {
      const currentSubscribers = this.urlSubscribers.get(processedUrl);
      if (!currentSubscribers || currentSubscribers.size === 0) {
        return;
      }

      await this.sendMessageToRooms(currentSubscribers, image);
      await this.sendMessageToRooms(currentSubscribers, message);
    });

    try {
      await splitKitClient.connect(processedUrl);
      this.splitKitConnections.set(processedUrl, splitKitClient);
      return { processedUrl, createdConnection: true, alreadySubscribed: false };
    } catch (error) {
      subscribers.delete(room);
      if (subscribers.size === 0) {
        this.urlSubscribers.delete(processedUrl);
      }

      roomUrls.delete(processedUrl);
      if (roomUrls.size === 0) {
        this.roomSubscriptions.delete(room);
      }

      throw error;
    }
  }

  private async unsubscribeRoomFromUrl(room: string, url: string): Promise<void> {
    const roomUrls = this.roomSubscriptions.get(room);
    if (roomUrls) {
      roomUrls.delete(url);
      if (roomUrls.size === 0) {
        this.roomSubscriptions.delete(room);
      }
    }

    const subscribers = this.urlSubscribers.get(url);
    if (!subscribers) {
      return;
    }

    subscribers.delete(room);
    if (subscribers.size > 0) {
      return;
    }

    this.urlSubscribers.delete(url);
    const client = this.splitKitConnections.get(url);
    if (client) {
      await client.disconnect();
      this.splitKitConnections.delete(url);
    }
  }

  private async unsubscribeRoomFromAllUrls(room: string): Promise<void> {
    const urls = this.roomSubscriptions.get(room);
    if (!urls || urls.size === 0) {
      return;
    }

    for (const url of Array.from(urls)) {
      await this.unsubscribeRoomFromUrl(room, url);
    }
  }

  private async disconnectAllSplitKitConnections(): Promise<void> {
    for (const [url, client] of this.splitKitConnections.entries()) {
      try {
        await client.disconnect();
      } catch (error) {
        this.logger.error(`Error disconnecting Split Kit client for ${url}:`, error);
      }
    }

    this.splitKitConnections.clear();
    this.urlSubscribers.clear();
    this.roomSubscriptions.clear();
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

  async disconnect(): Promise<void> {
    await this.disconnectAllSplitKitConnections();
    this.client.quit('Bot shutting down');
  }
}