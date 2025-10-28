declare module 'irc-framework' {
  export interface ConnectOptions {
    host: string;
    port: number;
    tls?: boolean;
    nick: string;
    username: string;
    gecos: string;
    password?: string;
  }

  export interface IRCUser {
    channels: Map<string, unknown>;
  }

  export interface IRCEvent {
    nick: string;
    target: string;
    message: string;
    sender?: {
      name: string;
    };
  }

  export class Client {
    user: IRCUser;
    
    constructor();
    
    connect(options: ConnectOptions): void;
    join(channel: string): void;
    part(channel: string, message?: string): void;
    say(target: string, message: string): void;
    quit(message?: string): void;
    
    on(event: string, callback: (...args: unknown[]) => void): void;
    
    off(event: string, callback: Function): void;
  }
}