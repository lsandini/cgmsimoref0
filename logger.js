const pino = require('pino');
require('dotenv').config();

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  white: '\x1b[37m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

// Create a basic logger
const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: null,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'hostname,pid',
      // Tell pino-pretty not to colorize, we'll do it ourselves
      messageFormat: '{msg}'
    }
  }
});

// Function to colorize values in %o placeholders
const colorizeValue = (value) => {
  if (typeof value === 'object') {
    // For objects, we'll stringify and colorize the whole string
    return `${colors.yellow}${JSON.stringify(value)}${colors.reset}`;
  } else {
    // For simple values, just colorize the value
    return `${colors.yellow}${value}${colors.reset}`;
  }
};

// Create a wrapper for the %o format with custom colors
const logger = {
  info: (msg, ...args) => {
    if (typeof msg === 'string' && msg.includes('%o') && args.length > 0) {
      // Extract the label part (before the colon)
      const colonIndex = msg.indexOf(':');
      if (colonIndex !== -1) {
        const label = msg.substring(0, colonIndex + 1);
        let restOfMsg = msg.substring(colonIndex + 1);
        
        // Replace %o placeholders with colorized values
        restOfMsg = restOfMsg.replace(/%o/g, () => {
          const arg = args.shift();
          return colorizeValue(arg);
        });
        
        // Colorize the label and combine
        pinoLogger.info(`${colors.blue}${label}${colors.reset}${restOfMsg}`);
      } else {
        // No colon found, just do regular replacement
        const formattedMsg = msg.replace(/%o/g, () => {
          const arg = args.shift();
          return colorizeValue(arg);
        });
        pinoLogger.info(formattedMsg);
      }
    } else {
      pinoLogger.info(msg, ...args);
    }
  },
  // Repeat for other log levels...
  error: (msg, ...args) => {
    if (typeof msg === 'string' && msg.includes('%o') && args.length > 0) {
      // Similar implementation as info
      const colonIndex = msg.indexOf(':');
      if (colonIndex !== -1) {
        const label = msg.substring(0, colonIndex + 1);
        let restOfMsg = msg.substring(colonIndex + 1);
        
        restOfMsg = restOfMsg.replace(/%o/g, () => {
          const arg = args.shift();
          return colorizeValue(arg);
        });
        
        pinoLogger.error(`${colors.blue}${label}${colors.reset}${restOfMsg}`);
      } else {
        const formattedMsg = msg.replace(/%o/g, () => {
          const arg = args.shift();
          return colorizeValue(arg);
        });
        pinoLogger.error(formattedMsg);
      }
    } else {
      pinoLogger.error(msg, ...args);
    }
  },
  warn: (msg, ...args) => {
    // Similar implementation as info
    if (typeof msg === 'string' && msg.includes('%o') && args.length > 0) {
      const colonIndex = msg.indexOf(':');
      if (colonIndex !== -1) {
        const label = msg.substring(0, colonIndex + 1);
        let restOfMsg = msg.substring(colonIndex + 1);
        
        restOfMsg = restOfMsg.replace(/%o/g, () => {
          const arg = args.shift();
          return colorizeValue(arg);
        });
        
        pinoLogger.warn(`${colors.blue}${label}${colors.reset}${restOfMsg}`);
      } else {
        const formattedMsg = msg.replace(/%o/g, () => {
          const arg = args.shift();
          return colorizeValue(arg);
        });
        pinoLogger.warn(formattedMsg);
      }
    } else {
      pinoLogger.warn(msg, ...args);
    }
  },
  debug: (msg, ...args) => {
    // Similar implementation as info
    if (typeof msg === 'string' && msg.includes('%o') && args.length > 0) {
      const colonIndex = msg.indexOf(':');
      if (colonIndex !== -1) {
        const label = msg.substring(0, colonIndex + 1);
        let restOfMsg = msg.substring(colonIndex + 1);
        
        restOfMsg = restOfMsg.replace(/%o/g, () => {
          const arg = args.shift();
          return colorizeValue(arg);
        });
        
        pinoLogger.debug(`${colors.blue}${label}${colors.reset}${restOfMsg}`);
      } else {
        const formattedMsg = msg.replace(/%o/g, () => {
          const arg = args.shift();
          return colorizeValue(arg);
        });
        pinoLogger.debug(formattedMsg);
      }
    } else {
      pinoLogger.debug(msg, ...args);
    }
  },
  child: () => logger
};

module.exports = { logger };