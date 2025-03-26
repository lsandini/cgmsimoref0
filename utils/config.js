// utils/config.js
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

/**
 * Default configuration for OpenAPS loop
 */
const defaultConfig = {
  // Nightscout connection settings
  nightscout: {
    url: process.env.NIGHTSCOUT_URL || 'http://localhost:1337',
    api_secret: process.env.NIGHTSCOUT_API_SECRET || ''
  },
  
  // Profile defaults (used when Nightscout profile is unavailable)
  defaultProfile: {
    // Core settings
    dia: 6,                 // Duration of insulin action in hours
    insulinPeakTime: 75,    // Time of peak insulin activity in minutes
    current_basal: 0.7,     // Default basal rate in U/h
    max_daily_basal: 1.0,   // Maximum daily basal rate
    sens: 36,               // Insulin sensitivity factor (mg/dL/U)
    carb_ratio: 10,         // Carb ratio (g/U)
    min_bg: 100,            // Target minimum BG (mg/dL)
    max_bg: 100,            // Target maximum BG (mg/dL)
    max_basal: 4,           // Maximum temp basal rate
    out_units: "mg/dL"      // Display units
  },
  
  // Algorithm preferences
  preferences: {
    max_iob: 3,                    // Maximum allowed IOB
    max_daily_safety_multiplier: 3, // Safety multiplier for max daily basal
    current_basal_safety_multiplier: 4, // Safety multiplier for current basal
    autosens_max: 1.2,             // Maximum autosens ratio
    autosens_min: 0.7,             // Minimum autosens ratio
    enableSMB_always: false,       // Enable SMB always
    enableSMB_with_COB: false,     // Enable SMB with COB
    enableSMB_with_temptarget: false, // Enable SMB with temp target
    enableSMB_with_bolus: false,   // Enable SMB with bolus
    enableSMB_after_carbs: false,  // Enable SMB after carbs
    enableUAM: false,              // Enable UAM (unannounced meals)
    curve: 'ultra-rapid',          // Insulin curve type
    useCustomPeakTime: false,      // Use custom insulin peak time
    insulinPeakTime: 75            // Custom insulin peak time in minutes
  }
};

/**
 * Load configuration from file and environment variables
 * @param {string} configPath - Path to configuration file (optional)
 * @returns {Object} - Merged configuration
 */
const loadConfig = (configPath = null) => {
  let fileConfig = {};
  
  // Try to load configuration from file if provided
  if (configPath) {
    try {
      const configFile = fs.readFileSync(path.resolve(configPath), 'utf8');
      fileConfig = JSON.parse(configFile);
      logger.info(`Loaded configuration from ${configPath}`);
    } catch (error) {
      logger.warn(`Could not load configuration from ${configPath}:`, error);
    }
  }
  
  // Load preferences from separate file if it exists
  let preferencesConfig = {};
  try {
    const prefsPath = path.resolve('./preferences.json');
    if (fs.existsSync(prefsPath)) {
      const prefsFile = fs.readFileSync(prefsPath, 'utf8');
      preferencesConfig = JSON.parse(prefsFile);
      logger.info('Loaded preferences from preferences.json');
    }
  } catch (error) {
    logger.warn('Could not load preferences from preferences.json:', error);
  }
  
  // Override configuration with environment variables
  const envConfig = {
    nightscout: {
      url: process.env.NIGHTSCOUT_URL || defaultConfig.nightscout.url,
      api_secret: process.env.NIGHTSCOUT_API_SECRET || defaultConfig.nightscout.api_secret
    }
  };
  
  // Merge configurations with priority: env > file > preferences > default
  const mergedConfig = {
    ...defaultConfig,
    preferences: {
      ...defaultConfig.preferences,
      ...preferencesConfig
    },
    ...fileConfig,
    ...envConfig
  };
  
  return mergedConfig;
};

module.exports = {
  loadConfig,
  defaultConfig
};
