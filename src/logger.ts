import winston from 'winston';

export function createLogger(level: string = 'warning'): winston.Logger {
  const logger = winston.createLogger({
    level: level.toLowerCase(),
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.colorize({
        all: true,
        colors: {
          error: 'red',
          warn: 'yellow',
          info: 'cyan',
          debug: 'blue'
        }
      }),
      winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const pid = process.pid;
        const filename = meta.filename || 'unknown';
        const line = meta.line || '0';
        
        let logMessage = `${timestamp} | ${level.padEnd(15)} | ${level.padEnd(8)} | ${filename}:${line} | ${pid} >>> ${message}`;
        
        if (stack) {
          logMessage += `\n${stack}`;
        }
        
        return logMessage;
      })
    ),
    transports: [
      new winston.transports.Console({
        handleExceptions: true,
        handleRejections: true
      })
    ],
    exitOnError: false
  });

  logger.info('Logger initialized.');
  return logger;
}