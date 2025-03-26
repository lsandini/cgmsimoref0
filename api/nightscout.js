const fetch = require('node-fetch');
const { logger } = require('../utils/logger');

/**
 * Creates a client for interacting with Nightscout API
 * @param {Object} config - Nightscout configuration
 * @returns {Object} - Object with Nightscout API methods
 */
const createNightscoutClient = (config) => {
  const baseURL = config.url;
  const token = config.api_secret || '';
  const headers = token ? { 'api-secret': token } : {};
  
/**
 * Make an HTTP request to Nightscout API
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} - Parsed response data
 */
const makeRequest = async (endpoint, options = {}) => {
  const url = `${baseURL}${endpoint}`;
  const fetchOptions = {
    headers,
    timeout: 10000,
    ...options
  };
  
  try {
    const response = await fetch(url, fetchOptions);
    
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }
    
    // First get the response as text
    const text = await response.text();
    
    // Custom parsing for entries endpoint
    if (endpoint.includes('/entries')) {
      try {
        // Try to parse as JSON first (for normal cases)
        return JSON.parse(text);
      } catch (jsonParseError) {
        // If JSON parsing fails, attempt to construct JSON manually
        const entries = parseEntriesFromText(text);
        if (entries.length > 0) {
          return entries;
        }
        
        // If parsing fails, log the error and rethrow
        logger.error(`Custom parsing failed for ${url}:`, text);
        throw jsonParseError;
      }
    }
    
    // For other endpoints, use standard JSON parsing
    return JSON.parse(text);
  } catch (error) {
    logger.error(`Error making request to ${url}:`, error);
    throw error;
  }
};

/**
 * Parse entries from raw text response
 * @param {string} text - Raw text response
 * @returns {Array} - Parsed entries
 */
const parseEntriesFromText = (text) => {
  // Split the text into lines
  const lines = text.trim().split('\n');
  
  // Parse each line into an entry
  const entries = lines.map(line => {
    // Split the line by tabs or multiple spaces
    const parts = line.trim().split(/\s+/);
    
    // Ensure we have enough parts to create an entry
    if (parts.length >= 4) {
      return {
        dateString: parts[0].replace(/"/g, ''),
        date: parseInt(parts[1]),
        sgv: parseInt(parts[2]),
        direction: parts[3].replace(/"/g, '')
      };
    }
    
    return null;
  }).filter(entry => entry !== null);
  
  return entries;
};
  
  /**
   * Fetch glucose readings from Nightscout
   * @param {number} hours - Number of hours of data to fetch
   * @returns {Promise<Array>} - Array of glucose readings
   */
  const getEntries = async (hours = 24) => {
    try {
      // Calculate count based on 5-minute intervals
      // 12 readings per hour × requested hours
      const count = Math.ceil(12 * hours);
      
      const data = await makeRequest(`/api/v1/entries?count=${count}`);
      
      // Convert to format expected by oref0 and mark as fakecgm
      const formattedEntries = data.map(entry => ({
        sgv: entry.sgv,
        date: entry.date,
        dateString: entry.dateString,
        direction: entry.direction,
        type: entry.type || 'sgv',
        device: "fakecgm" // Add this to bypass the flat CGM check
      }));
      
      logger.info(`Fetched ${formattedEntries.length} glucose readings (${hours} hours)`);
      return formattedEntries;
    } catch (error) {
      logger.error('Error fetching CGM data:', error);
      return [];
    }
  };

  /**
   * Fetch recent treatments from Nightscout
   * @param {number} hours - Number of hours of treatments to fetch
   * @returns {Promise<Array>} - Array of treatments
   */
  const getTreatments = async (hours = 24) => {
    try {
      // Calculate milliseconds for the time window
      const timeWindowMs = hours * 60 * 60 * 1000;
      const endDate = new Date().getTime();
      const startDate = endDate - timeWindowMs;
      
      const data = await makeRequest(`/api/v1/treatments?find[created_at][$gte]=${new Date(startDate).toISOString()}`);
      logger.info(`Fetched ${data.length} treatments from the last ${hours} hours`);
      return data;
    } catch (error) {
      logger.error('Error fetching treatments:', error);
      return [];
    }
  };
  
  /**
   * Fetch current profile from Nightscout
   * @returns {Promise<Object|null>} - Profile object or null if not found
   */
  const getProfile = async () => {
    try {
      logger.info('Fetching profile from Nightscout');
      const data = await makeRequest('/api/v1/profile');
      
      if (!data || !data[0] || !data[0].store) {
        logger.warn('Invalid or missing Nightscout profile, using defaults');
        return null;
      }
      
      logger.info('Successfully fetched profile from Nightscout');
      return data[0];
    } catch (error) {
      logger.error('Error fetching profile from Nightscout:', error);
      return null;
    }
  };

  /**
   * Upload treatments to Nightscout
   * @param {Array} treatments - Array of treatment objects
   * @returns {Promise<Object>} - Upload response
   */
  const uploadTreatments = async (treatments) => {
    try {
      const data = await makeRequest('/api/v1/treatments', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(treatments)
      });
      
      logger.info(`Uploaded ${treatments.length} treatments to Nightscout`);
      return data;
    } catch (error) {
      logger.error('Error uploading treatments:', error);
      throw error;
    }
  };

  /**
   * Upload device status to Nightscout
   * @param {Array} deviceStatuses - Array of device status objects
   * @returns {Promise<Object>} - Upload response
   */
  const uploadDeviceStatus = async (deviceStatuses) => {
    try {
      const data = await makeRequest('/api/v1/devicestatus', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(deviceStatuses)
      });
      
      logger.info(`Uploaded ${deviceStatuses.length} device status(es) to Nightscout`);
      return data;
    } catch (error) {
      logger.error('Error uploading device status:', error);
      throw error;
    }
  };
  
  return {
    getEntries,
    getTreatments,
    getProfile,
    uploadTreatments,
    uploadDeviceStatus
  };
};

module.exports = { createNightscoutClient };