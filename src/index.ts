#!/usr/bin/env node

import { loadConfig } from './config';
import { createLogger } from './logger';
import { MessageStateManager } from './messageState';
import { SplitKitClient } from './splitkit';
import { IRCBot } from './ircBot';
import { BoostBotWebServer } from './webserver';

async function main(): Promise<void> {
  try {
    // Load configuration
    const config = loadConfig();
    
    // Setup logging
    const logger = createLogger(config.LOGLEVEL);
    
    // Initialize message state
    const messageState = new MessageStateManager(logger);
    await messageState.loadMessages();
    
    // Initialize Split Kit client
    const splitKit = new SplitKitClient(config, logger, messageState);
    
    // Initialize IRC bot
    const ircBot = new IRCBot(config, logger, messageState, splitKit);
    
    // Set up Split Kit message callback to send to IRC
    splitKit.setMessageCallback(async (image: string, message: string) => {
      await ircBot.sendMessageToChannels(image);
      await ircBot.sendMessageToChannels(message);
    });
    
    // Initialize boost bot web server if enabled
    let webServer: BoostBotWebServer | undefined;
    if (config.ENABLEBOOSTBOT?.toLowerCase() === 'true') {
      webServer = new BoostBotWebServer(config, logger);
      
      // Set up boost bot callback to send to IRC
      webServer.setCallback(async (message: string) => {
        logger.info(`From webserver: ${message}`);
        await ircBot.sendMessageToChannels(message);
      });
      
      // Start web server
      await webServer.start();
    }
    
    // Connect to IRC
    ircBot.connect();
    
    // Handle graceful shutdown
    const shutdown = async (): Promise<void> => {
      logger.info('Shutting down...');
      
      try {
        await messageState.saveMessages();
        await splitKit.disconnect();
        ircBot.disconnect();
        
        if (webServer) {
          await webServer.stop();
        }
        
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    // Handle signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      shutdown().catch(() => process.exit(1));
    });
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      shutdown().catch(() => process.exit(1));
    });
    
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});