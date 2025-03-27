// api/nightscout.js
const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Creates a Nightscout client with the given configuration
 * @param {Object} config - Configuration object
 * @param {string} config.url - Nightscout URL
 * @param {string} config.apiSecret - API secret for Nightscout
 * @returns {Object} - Functions for interacting with Nightscout
 */
function createNightscoutClient(config) {
  const baseUrl = config.url;
  const apiSecret = config.apiSecret;
  
  const axiosClient = axios.create({
    baseURL: baseUrl,
    headers: {
      'API-SECRET': apiSecret,
      'Content-Type': 'application/json'
    }
  });

  logger.info(`Initializing Nightscout client for ${baseUrl}`);

  /**
   * Get CGM entries from Nightscout
   * @param {number} count - Number of entries to retrieve
   * @returns {Promise<Array>} - CGM entries
   */
  async function getEntries(count = 144) { // 24 hours of 5-min CGM data
    try {
      logger.debug(`Fetching ${count} entries from Nightscout`);
      const response = await axiosClient.get(`/api/v1/entries.json?count=${count}`);
      logger.debug(`Received ${response.data.length} entries from Nightscout`);
      
      // Log a sample of the data
      if (response.data.length > 0) {
        logger.debug(`Sample entry: ${JSON.stringify(response.data[0])}`);
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching entries from Nightscout: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get treatments from Nightscout
   * @param {number} count - Number of treatments to retrieve
   * @returns {Promise<Array>} - Treatments
   */
  async function getTreatments(count = 288) {
    try {
      logger.debug(`Fetching ${count} treatments from Nightscout`);
      const response = await axiosClient.get(`/api/v1/treatments.json?count=${count}`);
      logger.debug(`Received ${response.data.length} treatments from Nightscout`);
      
      // Log a sample of the data
      if (response.data.length > 0) {
        logger.debug(`Sample treatment: ${JSON.stringify(response.data[0])}`);
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching treatments from Nightscout: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload treatments to Nightscout
   * @param {Array} treatments - Treatments to upload
   * @returns {Promise<Object>} - Response from Nightscout
   */
  async function uploadTreatments(treatments) {
    try {
      logger.debug(`Uploading ${treatments.length} treatments to Nightscout`);
      logger.debug(`Sample treatment being uploaded: ${JSON.stringify(treatments[0])}`);
      
      const response = await axiosClient.post('/api/v1/treatments', treatments);
      logger.debug(`Successfully uploaded treatments to Nightscout`);
      
      return response.data;
    } catch (error) {
      logger.error(`Error uploading treatments to Nightscout: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get profile from Nightscout
   * @returns {Promise<Object>} - Profile from Nightscout
   */
  async function getProfile() {
    try {
      logger.debug('Fetching profile from Nightscout');
      const response = await axiosClient.get('/api/v1/profile.json');
      
      if (response.data && response.data.length > 0) {
        logger.debug(`Successfully retrieved profile from Nightscout`);
        logger.debug(`Profile keys: ${Object.keys(response.data[0]).join(', ')}`);
        
        // Log store section if it exists
        if (response.data[0].store) {
          const storeKeys = Object.keys(response.data[0].store);
          logger.debug(`Profile store keys: ${storeKeys.join(', ')}`);
          
          // Log a sample profile if available
          if (storeKeys.length > 0) {
            const sampleProfileName = storeKeys[0];
            const sampleProfile = response.data[0].store[sampleProfileName];
            logger.debug(`Sample profile (${sampleProfileName}) keys: ${Object.keys(sampleProfile).join(', ')}`);
            
            // Log some important profile values
            if (sampleProfile) {
              logger.debug(`DIA: ${sampleProfile.dia}`);
              logger.debug(`Basal settings: ${JSON.stringify(sampleProfile.basal)}`);
              logger.debug(`ISF settings: ${JSON.stringify(sampleProfile.sens)}`);
              logger.debug(`Carb ratio settings: ${JSON.stringify(sampleProfile.carbratio)}`);
              logger.debug(`Units: ${sampleProfile.units}`);
            }
          }
        }
        
        return response.data[0];
      } else {
        logger.warn('Empty or invalid profile returned from Nightscout');
        return null;
      }
    } catch (error) {
      logger.error(`Error fetching profile from Nightscout: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload device status to Nightscout
   * @param {Array} deviceStatuses - Device statuses to upload
   * @returns {Promise<Object>} - Response from Nightscout
   */
  async function uploadDeviceStatus(deviceStatuses) {
    try {
      logger.debug(`Uploading ${deviceStatuses.length} device statuses to Nightscout`);
      
      // Log detailed information about each deviceStatus
      deviceStatuses.forEach((status, index) => {
        logger.debug(`Device Status ${index + 1}:`, {
          totalIOB: status.openaps?.iob?.iob,
          basalIOB: status.openaps?.iob?.basaliob,
          bolusIOB: status.openaps?.iob?.bolusiob,
          pumpBasalIOB: status.openaps?.iob?.pumpBasalIOB,
          time: status.openaps?.iob?.time
        });
      });
  
      const response = await axiosClient.post('/api/v1/devicestatus', deviceStatuses);
      logger.debug('Successfully uploaded device status to Nightscout');
      
      return response.data;
    } catch (error) {
      logger.error(`Error uploading device status to Nightscout: ${error.message}`);
      throw error;
    }
  }

  return {
    getEntries,
    getTreatments,
    uploadTreatments,
    getProfile,
    uploadDeviceStatus
  };
}

module.exports = { createNightscoutClient };