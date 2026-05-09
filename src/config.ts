import { config } from 'dotenv';
import path from 'path';
import { Config } from './types';

// Load environment variables
const envPath = process.env.CONFIG_ENV_PATH || path.resolve(process.cwd(), '.env');
config({ path: envPath, override: true });

export function loadConfig(): Config {
  const requiredVars = ['NSPASS', 'HOST', 'PORT', 'USER', 'REALNAME', 'NICK', 'CHANNELS', 'WEBPORT', 'AUTHTOKEN', 'ADMINS'];
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`Required environment variable ${varName} is not set`);
    }
  }

  return {
    NSPASS: process.env.NSPASS!,
    HOST: process.env.HOST!,
    PORT: process.env.PORT!,
    SECURE: process.env.SECURE,
    USER: process.env.USER!,
    REALNAME: process.env.REALNAME!,
    NICK: process.env.NICK!,
    CHANNELS: process.env.CHANNELS!,
    COMMAND_PREFIX: process.env.COMMAND_PREFIX || '`',
    WEBPORT: process.env.WEBPORT!,
    AUTHTOKEN: process.env.AUTHTOKEN!,
    YOURLSAPIURL: process.env.YOURLSAPIURL || '',
    SHORTURL: process.env.SHORTURL || '',
    URL: process.env.URL,
    ADMINS: process.env.ADMINS!,
    TEXTTOSTRIP: process.env.TEXTTOSTRIP || 'Text - click to edit',
    LOGLEVEL: process.env.LOGLEVEL || 'warning',
    ENABLEBOOSTBOT: process.env.ENABLEBOOSTBOT
  };
}

export function parseChannels(channelsString: string): string[] {
  const channels = channelsString.split(',').map(ch => ch.trim());
  // Always include testing channel
  if (!channels.includes('#skr')) {
    channels.push('#skr');
  }
  // Remove duplicates
  return [...new Set(channels)];
}

export function parseAdmins(adminsString: string): string[] {
  return adminsString.split(',').map(admin => admin.trim());
}