// algorithms/sensitivity.js
const detectSensitivity = require('oref0/lib/determine-basal/autosens');
const logger = require('../utils/logger');

/**
 * Creates functions for sensitivity/autosens calculations
 * @returns {Object} - Functions for calculating autosensitivity
 */
function createSensitivityCalculations() {
  /**
   * Calculate autosensitivity based on historical data
   * @param {Object} data - Current data
   * @param {Array} data.glucose - Glucose readings
   * @param {Array} data.pumpHistory - Pump history records
   * @param {Object} data.profile - OpenAPS profile
   * @param {Array} data.carbHistory - Carb history records
   * @returns {Object} - Autosens data
   */
  function calculateAutosens(data) {
    try {
      logger.debug('Calculating autosensitivity...');
      
      // Validate required inputs
      if (!data.glucose || !Array.isArray(data.glucose) || data.glucose.length === 0) {
        logger.warn('Missing or invalid glucose data, returning default autosens');
        return createDefaultAutosens();
      }
      
      if (!data.pumpHistory || !Array.isArray(data.pumpHistory)) {
        logger.warn('Missing or invalid pump history, returning default autosens');
        return createDefaultAutosens();
      }
      
      if (!data.profile) {
        logger.warn('Missing profile, returning default autosens');
        return createDefaultAutosens();
      }
      
      // Prepare inputs similar to oref0-autosens-loop
      const detection_inputs = {
        iob_inputs: {
          profile: data.profile,
          history: data.pumpHistory
        },
        glucose_data: data.glucose,
        basalprofile: data.profile.basalprofile,
        temptargets: [], // Add temp targets if available
        retrospective: true,
        deviations: 96, // Look at last 96 readings (8 hours at 5 min intervals)
        carbs: data.carbHistory || []
      };
      
      // Call detectSensitivity to calculate autosens ratio
      const autosens_result = detectSensitivity(detection_inputs);
      
      // Log results
      logger.info('Autosens calculation complete:', {
        ratio: autosens_result.ratio.toFixed(2),
        newisf: autosens_result.newisf,
        oldisf: data.profile.sens
      });
      
      // Add timestamp
      return {
        ...autosens_result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error calculating autosensitivity', error);
      return createDefaultAutosens();
    }
  }

  /**
   * Create default autosens data with ratio of 1.0 (no adjustment)
   * @param {number} ratio - Optional override for default ratio
   * @returns {Object} - Default autosens data
   */
  function createDefaultAutosens(ratio = 1.0) {
    logger.warn('Using default autosens with ratio of ' + ratio);
    
    return {
      ratio: ratio,
      newisf: null,
      timestamp: new Date().toISOString()
    };
  }

  return {
    calculateAutosens,
    createDefaultAutosens
  };
}

module.exports = { createSensitivityCalculations };