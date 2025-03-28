// utils/config.js
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
require('dotenv').config();

/**
 * Load configuration from environment variables and JSON files
 * @returns {Promise<Object>} - Configuration object
 */
// Load configuration from environment variables and JSON files
async function loadConfig() {
  try {
    // Load preferences from preferences.json
    let preferences = {};
    try {
      const preferencesPath = path.join(__dirname, '..', 'preferences.json');
      const preferencesData = await fs.readFile(preferencesPath, 'utf8');
      preferences = JSON.parse(preferencesData);
      logger.info('Loaded preferences from preferences.json');
    } catch (error) {
      logger.warn(`Could not load preferences: ${error.message}`);
      logger.warn('Using default preferences');
    }

    // Combine environment variables with preferences
    const config = {
      nightscout: {
        url: process.env.NIGHTSCOUT_URL,
        apiSecret: process.env.API_SECRET
      },
      preferences
    };

    // Validate required configuration
    if (!config.nightscout.url || !config.nightscout.apiSecret) {
      throw new Error('Missing required Nightscout configuration');
    }

    logger.info(`Nightscout URL: ${config.nightscout.url}`);
    logger.debug('Configuration loaded successfully');

    return config;
  } catch (error) {
    logger.error(`Error loading configuration: ${error.message}`);
    throw error;
  }
}

module.exports = { loadConfig };