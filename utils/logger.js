// utils/logger.js
/**
 * Simple logger with consistent formatting
 */
const logger = {
  info: (message, data = null) => {
    console.log(`[INFO] ${message}${data ? ': ' + JSON.stringify(data) : ''}`);
  },
  
  warn: (message, data = null) => {
    console.warn(`[WARN] ${message}${data ? ': ' + JSON.stringify(data) : ''}`);
  },
  
  error: (message, error = null, data = null) => {
    console.error(`[ERROR] ${message}`);
    if (error) {
      console.error(error.stack || error);
    }
    if (data) {
      console.error('Additional data:', JSON.stringify(data));
    }
  },
  
  debug: (message, data = null) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${message}${data ? ': ' + JSON.stringify(data) : ''}`);
    }
  },
  
  // Create a logger with a component prefix
  child: (options) => {
    const prefix = options.component ? `[${options.component}] ` : '';
    return {
      info: (message, data) => logger.info(`${prefix}${message}`, data),
      warn: (message, data) => logger.warn(`${prefix}${message}`, data),
      error: (message, error, data) => logger.error(`${prefix}${message}`, error, data),
      debug: (message, data) => logger.debug(`${prefix}${message}`, data),
    };
  }
};

module.exports = { logger };
