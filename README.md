# V4V Relay

V4V Relay is a TypeScript IRC bot that relays live media updates from The Split Kit and boostagram webhooks from Helipad.

It started as a Node.js port of the original [splitkit-relay](https://github.com/cottongin/splitkit-relay) Python project, but it now has its own room-scoped websocket subscription model, configurable command prefix, karma responses, and current Node.js tooling.

## What It Does

- Connects to one or more IRC channels using `irc-framework`
- Listens to Split Kit websocket events and relays now-playing updates into IRC
- Accepts Helipad boostagram webhooks over HTTP and relays them to IRC
- Shortens image URLs with [YOURLS](https://github.com/YOURLS/YOURLS)
- Responds to `++` and `--` karma messages with randomized compliments and insults from `karmaMessages.json`
- Persists the last seen message in `MESSAGES.json`

## Room-Scoped Subscriptions

The bot supports multiple active Split Kit events at the same time.

- Each unique event URL gets at most one websocket connection
- Each IRC room can subscribe to one or more event URLs
- When a room connects to a URL that is already active, the bot reuses the existing websocket and just adds that room as a subscriber
- Websocket events are relayed only to the rooms subscribed to that URL
- `disconnect` removes only the current room from its subscriptions and closes a websocket only when no rooms remain subscribed
- If `URL` is set in `.env`, every joined room is subscribed to that default event at startup

## Data Files

All persistent data files are stored in the `data/` directory:

- `karmaMessages.json` — Emoji, compliment, and insult templates for karma responses
- `settings.json` — Runtime configuration (chance, cooldown timers, etc.) without requiring redeploy
- `MESSAGES.json` — Last-seen message state for each IRC room (auto-generated)

In Docker, the entire `data/` directory is mounted as a volume, so data persists across container restarts and redeployments.

## Runtime Configuration

The `data/settings.json` file allows tuning bot behavior without code changes or redeploys.

Currently supports karma response rate-limiting:
- `chance`: Probability of responding to `++`/`--` messages (0.0–1.0)
- `cooldownMs`: Global cooldown between responses
- `perTargetCooldownMs`: Per-channel cooldown
- `perUserCooldownMs`: Per-user cooldown (set to 0 to disable)

See [data/settings.md](data/settings.md) for detailed documentation and tuning examples.

## Requirements

- Node.js 18+
- npm
- A reachable IRC server with NickServ credentials if your network requires identification
- A Split Kit or compatible websocket event URL
- A YOURLS instance if you want URL shortening
- Helipad if you want boostagram webhook relaying

## Setup

```bash
git clone https://github.com/Kolomona/v4v-relay.git
cd v4v-relay
npm install
cp sample.env .env
```

Edit `.env`, then run:

```bash
npm run build
npm start
```

For development:

```bash
npm run dev
npm run type-check
npm run lint
npm run watch
```

## Environment Variables

Use `sample.env` as the template.

### IRC

- `NSPASS`: NickServ password
- `HOST`: IRC server hostname
- `PORT`: IRC server port
- `SECURE`: set to `True` to enable TLS
- `USER`: IRC username
- `REALNAME`: IRC real name / gecos
- `NICK`: bot nickname
- `CHANNELS`: comma-separated list of channels to join
- `COMMAND_PREFIX`: command prefix, defaults to `` ` `` if omitted

Note: the bot always adds `#skr` to the joined channel list.

### Web Server

- `WEBPORT`: port for the boostagram webhook server
- `AUTHTOKEN`: bearer token expected from Helipad

### YOURLS

- `YOURLSAPIURL`: full YOURLS API endpoint, usually `https://your-domain/yourls-api.php`
- `SHORTURL`: YOURLS API signature/token

If YOURLS is not configured, the bot sends original image URLs instead of shortened ones.

### Split Kit

- `URL`: optional default event URL to subscribe joined rooms to at startup
- `TEXTTOSTRIP`: string removed from websocket payload text before relay formatting

### Bot

- `ADMINS`: comma-separated IRC nicknames allowed to run admin commands
- `LOGLEVEL`: log level such as `debug`, `info`, or `warning`
- `ENABLEBOOSTBOT`: set to `true` to enable the Helipad webhook server

## Commands

Replace `~` below with your configured `COMMAND_PREFIX`.

### Public Commands

- `~help`: show command help
- `~linkme`: show the follow-along URL for the current room's first subscribed event
- `~np`: show the last stored now-playing message and image
- `~ping`: reply with `pong`

### Admin Commands

- `~connect <url>`: subscribe the current room to an event URL
- `~connect`: subscribe the current room to the default `URL` from `.env`
- `~disconnect`: unsubscribe the current room from all of its event URLs
- `~subscriptions`: show current room subscriptions and all active websocket connections
- `~join <#channel>`: have the bot join another IRC channel
- `~part`: leave the current IRC channel and remove its subscriptions
- `~reset`: clear message state, unsubscribe all rooms, leave all joined channels except `#skr`, and rejoin `#skr`
- `~reload`: reload karma message templates from `karmaMessages.json`
- `~quit [message]`: save state, disconnect sockets, and quit IRC

## Boostagram Webhook

When `ENABLEBOOSTBOT=true`, the bot starts an Express server on `WEBPORT`.

- `GET /`: simple informational page
- `POST /`: Helipad webhook endpoint
- Requires `Authorization: Bearer <AUTHTOKEN>`

Boostagrams are formatted into IRC with the sats amount, sender, app, episode, remote episode, and quoted message.

## Message Formatting

Split Kit events are normalized before relay:

- `value` payload fields are ignored
- duplicate GUIDs are suppressed per websocket connection
- image URLs may be rewritten for Wavlake / CloudFront images
- titles are bolded for IRC
- detail lines are joined with ` • `
- newline and repeated whitespace are collapsed
- if YOURLS reports that a URL already exists, the existing short URL is reused

## Persistence

- `MESSAGES.json` stores the last image URL, last message, active GUID, and timestamp state
- `karmaMessages.json` stores emoji lists, compliments, and insults used by the karma responder

## Project Layout

- `src/index.ts`: startup, shutdown, and wiring
- `src/ircBot.ts`: IRC connection, commands, room subscription registry, and routing
- `src/splitkit.ts`: websocket client, event normalization, and YOURLS handling
- `src/webserver.ts`: boostagram webhook server
- `src/messageState.ts`: persisted message state
- `src/karma.ts`: karma matching and random response generation
- `src/config.ts`: `.env` loading and parsing
- `src/logger.ts`: Winston console logger
- `src/types.ts`: shared types

## Scripts

- `npm run build`: compile TypeScript to `dist/`
- `npm start`: run compiled output
- `npm run dev`: run directly with `ts-node`
- `npm run watch`: TypeScript watch mode
- `npm run clean`: remove `dist/`
- `npm run lint`: run ESLint
- `npm run type-check`: run TypeScript without emitting files

## Notes

- The repo includes a `Dockerfile`, but the primary workflow in this repo is local Node.js execution
- The logger writes colored structured output to the console only
- Current TypeScript and dependency tooling passes `npm audit` with no reported vulnerabilities

## License

MIT