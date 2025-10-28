# V4V Relay

TypeScript IRC bot that relays messages from The Split Kit and boostagrams from Helipad.

This is a Node.js/TypeScript conversion of the original [splitkit-relay](https://github.com/cottongin/splitkit-relay) Python project with 100% functionality preservation.

## Features

- **IRC Bot**: Connects to IRC channels and relays live media updates from The Split Kit
- **WebSocket Client**: Listens to Split Kit events in real-time  
- **Boost Bot**: HTTP server that receives boostagram webhooks from Helipad
- **URL Shortening**: Integrates with YOURLS for image URL shortening
- **Admin Commands**: Full set of IRC commands for bot management
- **TypeScript**: Fully typed with strict TypeScript configuration

## Installation

### Requirements

- Node.js 18+ 
- npm or yarn
- [YOURLS](https://github.com/YOURLS/YOURLS) URL shortener instance
- Access to The Split Kit event websocket

### Setup

```bash
# Clone and install dependencies
git clone <repository-url>
cd v4v-relay
npm install

# Copy and configure environment
cp .env.sample .env
# Edit .env with your settings

# Build the project
npm run build

# Start the bot
npm start
```

### Development

```bash
# Run in development mode with hot reload
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint

# Watch mode for building
npm run watch
```

## Configuration

Edit `.env` file with your settings:

- **IRC Settings**: Server, credentials, channels
- **Split Kit**: Websocket URL from thesplitkit.com
- **YOURLS**: URL shortener API configuration  
- **Boost Bot**: Webserver port and auth token for Helipad
- **Admins**: IRC nicknames allowed to control the bot

## IRC Commands

| Command | Description | Admin Only? |
|---------|-------------|-------------|
| `` `join #channel`` | Join IRC channel | Yes |
| `` `part`` | Leave current channel | Yes |
| `` `connect URL`` | Connect to Split Kit websocket | Yes |
| `` `disconnect`` | Disconnect from websocket | Yes |
| `` `reload`` | Reload configuration | Yes |
| `` `np`` | Show last playing message | No |
| `` `quit`` | Shutdown bot | Yes |
| `` `reset`` | Reset state and channels | Yes |
| `` `linkme`` | Get Split Kit event URL | No |
| `` `ping`` | Ping/pong test | No |

## Architecture

- **`src/index.ts`**: Main application entry point
- **`src/ircBot.ts`**: IRC client and command handling
- **`src/splitkit.ts`**: WebSocket client for Split Kit events  
- **`src/webserver.ts`**: HTTP server for boostagram webhooks
- **`src/messageState.ts`**: Message persistence and deduplication
- **`src/config.ts`**: Configuration management
- **`src/logger.ts`**: Winston logging setup
- **`src/types.ts`**: TypeScript type definitions

## License

Same as original project. See parent repository for details.