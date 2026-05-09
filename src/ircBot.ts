import { Client as IRCClient } from 'irc-framework';
import winston from 'winston';
import { Config } from './types';
import { parseChannels, parseAdmins } from './config';
import { MessageStateManager } from './messageState';
import { SplitKitClient } from './splitkit';
import { checkKarma, reloadKarmaMessages } from './karma';
import { reloadSettings } from './settings';

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
  private roomQuietState: Map<string, { all: boolean; quips: boolean; boostagrams: boolean }> = new Map();

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

    const karmaResponse = checkKarma(message, { user: nick });
    if (karmaResponse) {
      this.sayToRoom(target, karmaResponse, 'quips');
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
      } else if (command.startsWith(`${prefixLower}subs`)) {
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
        await this.handleHelp(target, message);
      } else if (command.startsWith(`${prefixLower}status`)) {
        if (!isAdmin) return;
        await this.handleStatus(target);
      } else if (command === `${prefixLower}quiet` || command.startsWith(`${prefixLower}quiet `)) {
        if (!isAdmin) return;
        await this.handleQuiet(target, message);
      } else if (command === `${prefixLower}unquiet` || command.startsWith(`${prefixLower}unquiet `)) {
        if (!isAdmin) return;
        await this.handleUnquiet(target, message);
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
      
      this.client.part(target, 'adios mofos!');
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
      this.sayToRoom(target, "I'm not connected to an event.");
      return;
    }

    const followUrl = this.buildFollowUrl(currentRoomUrl);
    if (followUrl) {
      this.sayToRoom(target, `Follow along at: ${followUrl}`);
    } else {
      this.sayToRoom(target, "I'm connected, but couldn't build a follow link for this URL.");
    }
  }

  private async handleConnect(target: string, message: string): Promise<void> {
    try {
      let url = message.split(' ').slice(1).join(' ').trim();
      
      if (!url) {
        url = this.config.URL || '';
      }

      if (!url) {
        this.sayToRoom(target, 'No URL provided');
        return;
      }

      const subscriptionResult = await this.subscribeRoomToUrl(target, url);
      const followUrl = this.buildFollowUrl(subscriptionResult.processedUrl);

      if (subscriptionResult.alreadySubscribed) {
        this.sayToRoom(target, 'Already subscribed in this room.');
        return;
      }

      if (subscriptionResult.createdConnection) {
        this.sayToRoom(target, followUrl ? `Connected! Follow along at: ${followUrl}` : 'Connected!');
      } else {
        this.sayToRoom(target, followUrl ? `Subscribed to existing connection. Follow along at: ${followUrl}` : 'Subscribed to existing connection.');
      }
    } catch (error) {
      this.logger.error('Connect error:', error);
      this.sayToRoom(target, "I couldn't connect");
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
      this.sayToRoom(target, 'This room is not subscribed to any events.');
      return;
    }

    const urls = Array.from(roomUrls);
    for (const url of urls) {
      await this.unsubscribeRoomFromUrl(target, url);
    }

    this.sayToRoom(target, 'Disconnected this room from all subscribed events.');
  }

  private async handleReload(target: string): Promise<void> {
    reloadKarmaMessages();
    reloadSettings();
    this.sayToRoom(target, 'OK');
  }

  private async handleSubscriptions(target: string): Promise<void> {
    if (this.splitKitConnections.size === 0) {
      this.sayToRoom(target, 'No active websocket connections.');
      return;
    }

    const roomUrls = this.roomSubscriptions.get(target);
    if (!roomUrls || roomUrls.size === 0) {
      this.sayToRoom(target, 'This room is not subscribed to any events.');
    } else {
      this.sayToRoom(target, `This room subscriptions: ${Array.from(roomUrls).join(' | ')}`);
    }

    this.sayToRoom(target, `Active websocket connections: ${this.splitKitConnections.size}`);
    for (const [url, subscribers] of this.urlSubscribers.entries()) {
      this.sayToRoom(target, `${url} <= ${Array.from(subscribers).join(', ')}`);
    }
  }

  private async handleNowPlaying(target: string): Promise<void> {
    const { image, message } = this.messageState.getLastMessage();
    
    if (image) {
      this.sayToRoom(target, image);
    }
    this.sayToRoom(target, `Now Playing: ${message}`);
  }

  private async handlePing(target: string, message: string): Promise<void> {
    const cmdLen = (this.config.COMMAND_PREFIX || '`').length + 'ping'.length;
    const suffix = message.slice(cmdLen); // Remove '<prefix>ping'
    this.sayToRoom(target, `pong${suffix}`);
  }

  private async handleQuiet(target: string, message: string): Promise<void> {
    const p = this.config.COMMAND_PREFIX || '`';
    const topic = message.trim().split(/\s+/)[1]?.toLowerCase();
    const state = this.getRoomQuietState(target);

    if (!topic) {
      state.all = true;
      state.quips = true;
      state.boostagrams = true;
      this.sayToRoom(target, 'Quiet mode enabled for this room. Only help responses will be sent.', 'general', true);
      return;
    }

    if (topic === 'quips') {
      state.quips = true;
      this.sayToRoom(target, 'Quiet quips enabled for this room.', 'general', true);
      return;
    }

    if (topic === 'boostagrams') {
      state.boostagrams = true;
      this.sayToRoom(target, 'Boostagrams will not be shown in this room.', 'general', true);
      return;
    }

    this.sayToRoom(target, `Usage: ${p}quiet [quips|boostagrams]`, 'general', true);
  }

  private async handleUnquiet(target: string, message: string): Promise<void> {
    const p = this.config.COMMAND_PREFIX || '`';
    const topic = message.trim().split(/\s+/)[1]?.toLowerCase();
    const state = this.getRoomQuietState(target);

    if (!topic) {
      state.all = false;
      state.quips = false;
      state.boostagrams = false;
      this.sayToRoom(target, 'Quiet mode disabled for this room. All bot messages are enabled.');
      return;
    }

    if (topic === 'quips') {
      state.quips = false;
      this.sayToRoom(target, 'Quips re-enabled for this room.');
      return;
    }

    if (topic === 'boostagrams') {
      state.boostagrams = false;
      this.sayToRoom(target, 'Boostagrams re-enabled for this room.');
      return;
    }

    this.sayToRoom(target, `Usage: ${p}unquiet [quips|boostagrams]`);
  }

  private async handleHelp(target: string, message: string): Promise<void> {
    const p = this.config.COMMAND_PREFIX || '`';
    const lower = message.toLowerCase();
    const helpPrefix = `${p.toLowerCase()}help`;
    const suffix = lower.slice(helpPrefix.length).trim();

    // Keep existing behavior exactly for plain help.
    if (!suffix) {
      this.sayToRoom(target, `Commands: \x02${p}help\x02 (show commands), \x02${p}linkme\x02 (event link), \x02${p}np\x02 (now playing), \x02${p}ping\x02 (test response) | Admin: \x02${p}connect\x02 (join event), \x02${p}disconnect\x02 (leave event), \x02${p}subs\x02 (show room/url subscriptions), \x02${p}status\x02 (debug status), \x02${p}join\x02 (join channel), \x02${p}part\x02 (leave channel), \x02${p}reset\x02 (reset bot), \x02${p}reload\x02 (reload config), \x02${p}quit\x02 (shutdown bot), \x02${p}quiet\x02 (mute bot outputs), \x02${p}unquiet\x02 (restore bot outputs)`, 'help', true);
      return;
    }

    const topic = suffix.split(/\s+/)[0] || '';
    const commandHelp: Record<string, string> = {
      help: `${p}help [command]: Show command list, or detailed help for one command.`,
      linkme: `${p}linkme: Show the follow-along URL for this room's active event.`,
      np: `${p}np: Show the last now-playing message and image URL.`,
      ping: `${p}ping [text]: Reply with pong and echo any extra text.`,
      connect: `${p}connect [url]: Admin only. Subscribe this room to an event URL (or default URL).`,
      disconnect: `${p}disconnect: Admin only. Unsubscribe this room from all event URLs.`,
      subs: `${p}subs: Admin only. Show this room's subscriptions and active websocket connections.`,
      status: `${p}status: Admin only. Dump bot debug status for this room.`,
      join: `${p}join <#channel>: Admin only. Make the bot join a channel.`,
      part: `${p}part: Admin only. Make the bot leave the current channel.`,
      reset: `${p}reset: Admin only. Reset message state, leave non-#skr channels, and clear subscriptions.`,
      reload: `${p}reload: Admin only. Reload karma messages and runtime settings from disk.`,
      quit: `${p}quit [message]: Admin only. Save state, disconnect, and quit IRC.`,
      quiet: `${p}quiet [quips|boostagrams]: Admin only. Room-specific mute. No arg mutes all messages except help.`,
      unquiet: `${p}unquiet [quips|boostagrams]: Admin only. Room-specific unmute. No arg re-enables all bot messages.`
    };

    const helpText = commandHelp[topic];
    if (helpText) {
      this.sayToRoom(target, helpText, 'help', true);
      return;
    }

    this.sayToRoom(target, `Unknown command: ${topic}. Try ${p}help for the full list.`, 'help', true);
  }

  private async handleStatus(target: string): Promise<void> {
    const roomUrls = this.roomSubscriptions.get(target);
    const roomUrlList = roomUrls && roomUrls.size > 0 ? Array.from(roomUrls) : [];
    const quiet = this.getRoomQuietState(target);
    const lastMessage = this.messageState.getLastMessage();
    const fullState = this.messageState.getMessages();
    const activeConnections = Array.from(this.urlSubscribers.entries()).map(([url, subscribers]) => {
      return `${url} <= ${Array.from(subscribers).join(', ')}`;
    });
    const nowTs = Math.floor(Date.now() / 1000);

    const statusLines: string[] = [
      'Status:',
      `Room: ${target}`,
      `IRC connected: ${this.isConnected ? 'yes' : 'no'}`,
      `Configured channels: ${this.channels.length} (${this.channels.join(', ') || 'none'})`,
      `Joined channels: ${this.joinedChannels.size} (${Array.from(this.joinedChannels).join(', ') || 'none'})`,
      `Admins: ${this.admins.join(', ') || 'none'}`,
      `Default URL: ${this.config.URL || 'none'}`,
      `Queue length: ${this.messageQueue.length}`,
      `Room subscriptions: ${roomUrlList.length > 0 ? roomUrlList.join(' | ') : 'none'}`,
      `Active websocket connections: ${this.splitKitConnections.size}`,
      `Room quiet: all=${quiet.all} quips=${quiet.quips} boostagrams=${quiet.boostagrams}`,
      `Last now playing: ${lastMessage.message || 'nothing'}`,
      `Last image: ${lastMessage.image || 'none'}`,
      `Active GUID: ${fullState.activeGUID || 'none'}`,
      `Last state timestamp: ${fullState.timestamp ?? 0} (age=${fullState.timestamp ? nowTs - fullState.timestamp : 'n/a'}s)`
    ];

    for (const line of activeConnections) {
      statusLines.push(`WS: ${line}`);
    }

    for (const line of statusLines) {
      this.sayToRoom(target, line);
    }
  }

  async sendMessageToChannels(message: string, category: 'general' | 'boostagrams' = 'general'): Promise<void> {
    if (!this.isConnected) {
      // Queue message until IRC is connected
      this.messageQueue.push(message);
      this.logger.debug(`Queued message: ${message}`);
      return;
    }

    try {
      const primaryChannel = this.channels[0];

      if (!primaryChannel) {
        this.logger.warn('No primary channel configured in CHANNELS, re-queuing');
        this.messageQueue.push(message);
        return;
      }

      if (!this.joinedChannels.has(primaryChannel)) {
        this.logger.warn(`Primary channel ${primaryChannel} is not joined, re-queuing`);
        this.messageQueue.push(message);
        return;
      }

      if (this.isRoomSuppressed(primaryChannel, category)) {
        this.logger.debug(`Suppressed ${category} message in ${primaryChannel} due to quiet settings`);
        return;
      }

      this.logger.debug(`Sending to primary channel ${primaryChannel}: ${message}`);
      this.client.say(primaryChannel, message);
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

      if (this.isRoomSuppressed(room, 'general')) {
        continue;
      }

      this.logger.debug(`Sending room-scoped message to ${room}: ${message}`);
      this.client.say(room, message);
    }
  }

  private getRoomQuietState(room: string): { all: boolean; quips: boolean; boostagrams: boolean } {
    let state = this.roomQuietState.get(room);
    if (!state) {
      state = { all: false, quips: false, boostagrams: false };
      this.roomQuietState.set(room, state);
    }

    return state;
  }

  private isRoomSuppressed(room: string, category: 'general' | 'quips' | 'boostagrams'): boolean {
    const state = this.getRoomQuietState(room);
    if (state.all) {
      return true;
    }

    if (category === 'quips' && state.quips) {
      return true;
    }

    if (category === 'boostagrams' && state.boostagrams) {
      return true;
    }

    return false;
  }

  private sayToRoom(
    room: string,
    message: string,
    category: 'general' | 'quips' | 'boostagrams' | 'help' = 'general',
    force: boolean = false
  ): void {
    if (!force && category !== 'help' && this.isRoomSuppressed(room, category)) {
      return;
    }

    this.client.say(room, message);
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