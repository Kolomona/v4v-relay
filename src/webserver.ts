import express, { Request, Response } from 'express';
import winston from 'winston';
import { BoostagramData, Config } from './types';

export class BoostBotWebServer {
  private app: express.Application;
  private server: any;
  private config: Config;
  private logger: winston.Logger;
  private callback?: (message: string) => Promise<void>;

  constructor(config: Config, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
    this.app = express();
    
    // Middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    this.setupRoutes();
  }

  setCallback(callback: (message: string) => Promise<void>): void {
    this.callback = callback;
  }

  private setupRoutes(): void {
    // GET route for basic info
    this.app.get('/', (req: Request, res: Response) => {
      const message = '<h2>This is a boostagram IRC boostbot for the TSK relay.</h2> See <a href="https://github.com/cottongin/splitkit-relay">https://github.com/cottongin/splitkit-relay</a> and <a href="https://github.com/Podcastindex-org/helipad">https://github.com/Podcastindex-org/helipad</a> for more info';
      res.setHeader('Content-Type', 'text/html');
      res.send(message);
    });

    // POST route for boostagram webhooks
    this.app.post('/', async (req: Request, res: Response) => {
      try {
        // Check authorization
        const authToken = req.headers.authorization;
        if (!authToken || authToken.substring(7) !== this.config.AUTHTOKEN) {
          res.status(401);
          res.setHeader('Content-Type', 'text/plain');
          res.send('Unauthorized');
          return;
        }

        const data: BoostagramData = req.body;
        
        // Extract and format boostagram data
        const message = data.message;
        const valueSatTotal = Math.floor(data.value_msat_total / 1000);
        const sender = data.sender;
        const app = data.app;
        const episode = data.episode;
        const remoteEpisode = data.remote_episode;

        // Format message with IRC color codes
        const outputMessage = `\x02${valueSatTotal}\x02 sats from \x02${sender}\x02 via ${app} | ${episode} | ${remoteEpisode} | \x0304"${message}"\x0300`;

        // Log the processed message
        this.logger.info(`From webserver: ${outputMessage}`);

        // Send via callback
        if (this.callback) {
          await this.callback(outputMessage);
        }

        res.status(200);
        res.setHeader('Content-Type', 'text/html');
        res.send('OK');

      } catch (error) {
        this.logger.error('Error processing boostagram:', error);
        res.status(500);
        res.setHeader('Content-Type', 'text/plain');
        res.send('Internal Server Error');
      }
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const port = parseInt(this.config.WEBPORT);
        this.server = this.app.listen(port, () => {
          this.logger.info(`Boost bot web server listening on port ${port}`);
          resolve();
        });

        this.server.on('error', (error: Error) => {
          this.logger.error('Web server error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('Boost bot web server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  isRunning(): boolean {
    return this.server?.listening || false;
  }
}