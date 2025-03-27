// api/treatments.js
const logger = require('../utils/logger');

/**
 * Creates functions for handling treatments
 * @param {Object} client - Nightscout client
 * @returns {Object} - Functions for treatment operations
 */
function createTreatmentsAPI(client) {
  /**
   * Upload treatments to Nightscout
   * @param {Array} treatments - Treatments to upload
   * @returns {Promise<Object>} - Response from Nightscout
   */
  async function uploadTreatments(treatments) {
    try {
      logger.debug(`Uploading ${treatments.length} treatments to Nightscout`);
      
      if (treatments.length > 0) {
        logger.debug(`Sample treatment being uploaded: ${JSON.stringify(treatments[0])}`);
      }
      
      const response = await client.post('/api/v1/treatments', treatments);
      logger.debug(`Successfully uploaded treatments to Nightscout`);
      
      return response.data;
    } catch (error) {
      logger.error(`Error uploading treatments to Nightscout: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a bolus treatment object
   * @param {number} amount - Bolus amount in units
   * @param {string} notes - Optional notes
   * @returns {Object} - Formatted bolus treatment
   */
  function createBolusTreatment(amount, notes = 'SMB from OpenAPS algorithm') {
    const now = new Date();
    const timestamp = now.toISOString();
    
    return {
      eventType: 'Bolus',
      insulin: amount,
      created_at: timestamp,
      enteredBy: 'cgmsimoref0-node',
      notes: notes,
      mills: now.getTime()
    };
  }

  /**
   * Create a temp basal treatment object
   * @param {number} rate - Basal rate in U/hr
   * @param {number} duration - Duration in minutes
   * @returns {Object} - Formatted temp basal treatment
   */
  function createTempBasalTreatment(rate, duration) {
    const now = new Date();
    const timestamp = now.toISOString();
    
    return {
      eventType: 'Temp Basal',
      duration: duration,
      rate: rate,
      absolute: rate,
      created_at: timestamp,
      enteredBy: 'cgmsimoref0-node',
      mills: now.getTime()
    };
  }

  return {
    uploadTreatments,
    createBolusTreatment,
    createTempBasalTreatment
  };
}

module.exports = { createTreatmentsAPI };