export interface Config {
  // IRC Settings
  NSPASS: string;
  HOST: string;
  PORT: string;
  SECURE?: string | undefined;
  USER: string;
  REALNAME: string;
  NICK: string;
  CHANNELS: string;
  COMMAND_PREFIX: string;

  // Webserver Settings
  WEBPORT: string;
  AUTHTOKEN: string;

  // URL Shortener Settings
  YOURLSAPIURL: string;
  SHORTURL: string;

  // The Split Kit Settings
  URL?: string | undefined;

  // Bot Settings
  ADMINS: string;
  TEXTTOSTRIP?: string | undefined;
  LOGLEVEL?: string | undefined;
  ENABLEBOOSTBOT?: string | undefined;
}

export interface SplitKitData {
  blockGuid?: string;
  image?: string;
  title?: string;
  line?: string[];
  link?: {
    url?: string;
  };
  value?: unknown; // This gets removed, so we don't need to type it
}

export interface BoostagramData {
  message: string;
  value_msat_total: number;
  sender: string;
  app: string;
  podcast: string;
  episode: string;
  remote_podcast?: string | null;
  remote_episode?: string | null;
}

export interface MessageState {
  timestamp?: number | undefined;
  activeGUID?: string | undefined;
  lastMsg?: string | undefined;
  lastImg?: string | undefined;
}

export interface YourlsResponse {
  shorturl?: string;
  url?: {
    keyword?: string;
    url?: string;
    title?: string;
    date?: string;
    ip?: string;
  };
  status?: string;
  code?: string;
  message?: string;
  errorCode?: string;
}

export interface YourlsParams {
  signature: string;
  action: string;
  url: string;
  format: string;
}

export interface KarmaMessages {
  emojis: {
    positive: string[];
    negative: string[];
  };
  compliments: string[];
  insults: string[];
}

export interface KarmaResponseSettings {
  chance?: number;
  cooldownMs?: number;
  perTargetCooldownMs?: number;
  perUserCooldownMs?: number;
}

export interface RuntimeSettings {
  karmaResponse?: KarmaResponseSettings;
}

// IRC Framework types extension
export interface IRCMessage {
  sender: {
    name: string;
  };
  text: string;
  recipient: {
    name: string;
    part: (message: string) => Promise<void>;
  };
  reply: (message: string) => Promise<void>;
}