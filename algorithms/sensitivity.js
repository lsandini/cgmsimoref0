// algorithms/sensitivity.js
const { logger } = require('../utils/logger');

/**
 * Calculate autosensitivity based on historical data
 * @param {Object} state - Current loop state
 * @returns {Object} - Autosensitivity result
 */
const calculateAutosens = (state) => {
  try {
    logger.info('Calculating autosensitivity...');
    
    // Import oref0 autosens module
    const detectSensitivity = require('oref0/lib/determine-basal/autosens');
    
    // Prepare inputs similar to oref0-autosens-loop
    const detection_inputs = {
      iob_inputs: {
        profile: state.profile,
        history: state.pumpHistory
      },
      glucose_data: state.glucose,
      basalprofile: state.profile.basalprofile,
      temptargets: [], // Add temp targets if available
      retrospective: true,
      deviations: 96, // Look at last 96 readings (8 hours at 5 min intervals)
      carbs: state.carbHistory || [] 
    };
    
    // Call detectSensitivity to calculate autosens ratio
    const autosens_result = detectSensitivity(detection_inputs);
    
    // Process the result to ensure valid numbers
    const processed_result = {
      ratio: processNumber(autosens_result.ratio, 1.0),
      newisf: processNumber(autosens_result.newisf, state.profile.sens),
      timestamp: new Date().toISOString()
    };
    
    // Log the result
    logger.info('Autosens calculation complete:', {
      ratio: processed_result.ratio,
      newisf: processed_result.newisf,
      oldisf: state.profile.sens
    });
    
    return processed_result;
  } catch (error) {
    logger.error('Error calculating autosensitivity:', error);
    logger.error('Error stack:', error.stack);
    
    // If autosens calculation fails, use a safe default
    const default_ratio = 1.0;
    
    logger.warn('Using default autosens ratio:', default_ratio);
    return {
      ratio: default_ratio,
      newisf: state.profile.sens,
      timestamp: new Date().toISOString(),
      error: error.toString()
    };
  }
};

/**
 * Process a number to ensure it's valid, otherwise return default
 * @param {*} value - Value to process
 * @param {number} defaultValue - Default value if invalid
 * @returns {number} - Processed number
 */
const processNumber = (value, defaultValue) => {
  // Check if value is null, undefined, NaN, or not a number
  if (value === null || value === undefined || isNaN(value) || typeof value !== 'number') {
    return defaultValue;
  }
  
  // If value is infinite, return default
  if (!isFinite(value)) {
    return defaultValue;
  }
  
  // Return the original value
  return value;
};

module.exports = {
  calculateAutosens
};