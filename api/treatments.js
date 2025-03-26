// api/treatments.js
const { logger } = require('../utils/logger');

/**
 * Enact treatment recommendations by uploading to Nightscout
 * @param {Object} recommendations - Treatment recommendations
 * @param {Object} nsClient - Nightscout client
 * @param {Object} state - Current loop state
 * @returns {Object} - Enacted data
 */
const enactTreatments = async (recommendations, nsClient, state) => {
  logger.info('Enacting treatments', {
    rate: recommendations.rate,
    duration: recommendations.duration,
    eventualBG: recommendations.eventualBG
  });
  
  try {
    // Ensure recommendations has valid properties
    const safeRecommendations = ensureValidRecommendations(recommendations, state);
    
    // Prepare enacted data
    const enactedData = { 
      ...safeRecommendations, 
      enacted: true, 
      timestamp: new Date().toISOString(),
      received: true
    };
    
    // Get current timestamp for all uploads
    const now = new Date();
    const timestamp = now.toISOString();
    
    // Check for SMB (microbolus)
    await handleMicrobolus(safeRecommendations, nsClient, timestamp);
    
    // Handle temp basal
    await handleTempBasal(safeRecommendations, nsClient, state, timestamp);
    
    logger.info('Treatment enacted successfully');
    return enactedData;
  } catch (error) {
    logger.error('Error enacting treatments:', error);
    return null;
  }
};

/**
 * Ensure recommendations has valid properties
 * @param {Object} recommendations - Treatment recommendations
 * @param {Object} state - Current loop state
 * @returns {Object} - Validated recommendations
 */
const ensureValidRecommendations = (recommendations, state) => {
  return {
    ...recommendations,
    rate: recommendations.rate !== undefined ? 
      recommendations.rate : state.profile.current_basal,
    duration: recommendations.duration !== undefined ? 
      recommendations.duration : 0,
    eventualBG: recommendations.eventualBG || 
      (state.glucose[0]?.sgv || 120)
  };
};

/**
 * Handle microbolus (SMB) if recommended
 * @param {Object} recommendations - Treatment recommendations
 * @param {Object} nsClient - Nightscout client
 * @param {string} timestamp - Current timestamp
 * @returns {Promise<void>}
 */
const handleMicrobolus = async (recommendations, nsClient, timestamp) => {
  if (recommendations.reason && recommendations.reason.includes('Microbolusing')) {
    // Extract the microbolus amount from the reason string
    const microbolusMatch = recommendations.reason.match(/Microbolusing (\d+\.?\d*)U/);
    if (microbolusMatch && microbolusMatch[1]) {
      const microbolusAmount = parseFloat(microbolusMatch[1]);
      
      logger.info('Enacting microbolus', {amount: microbolusAmount + "U"});
      
      // Upload microbolus to Nightscout
      try {
        const nsTreatment = {
          eventType: 'Bolus',
          insulin: microbolusAmount,
          created_at: timestamp,
          enteredBy: 'cgmsimoref0-node',
          notes: 'SMB from OpenAPS algorithm',
          mills: new Date().getTime()
        };
        
        await nsClient.uploadTreatments([nsTreatment]);
        logger.info('Uploaded microbolus to Nightscout', {amount: microbolusAmount + "U"});
      } catch (treatmentError) {
        logger.error('Error uploading microbolus treatment:', treatmentError);
      }
    }
  }
};

/**
 * Handle temp basal recommendations
 * @param {Object} recommendations - Treatment recommendations
 * @param {Object} nsClient - Nightscout client
 * @param {Object} state - Current loop state
 * @param {string} timestamp - Current timestamp
 * @returns {Promise<void>}
 */
const handleTempBasal = async (recommendations, nsClient, state, timestamp) => {
  if (recommendations.duration > 0 || recommendations.rate !== state.profile.current_basal) {
    // Log that we're setting a temp basal
    logger.info('Setting temp basal', {
      rate: recommendations.rate + "U/h",
      duration: recommendations.duration + " minutes"
    });
    
    // Upload the temp basal to Nightscout as a treatment
    try {
      const mills = new Date().getTime();
      
      const nsTreatment = {
        eventType: 'Temp Basal',
        duration: recommendations.duration,
        rate: recommendations.rate,
        absolute: recommendations.rate,
        created_at: timestamp,
        enteredBy: 'cgmsimoref0-node',
        mills: mills
      };
      
      await nsClient.uploadTreatments([nsTreatment]);
      logger.info('Uploaded temp basal treatment to Nightscout');
    } catch (treatmentError) {
      logger.error('Error uploading temp basal treatment:', treatmentError);
    }
  } else if (recommendations.duration === 0) {
    // Cancel any existing temp basal
    logger.info('Cancelling any existing temp basal');
    
    // We could send a zero-duration temp basal to indicate cancellation
    try {
      const mills = new Date().getTime();
      
      const nsTreatment = {
        eventType: 'Temp Basal',
        duration: 0,
        rate: state.profile.current_basal,
        absolute: state.profile.current_basal,
        created_at: timestamp,
        enteredBy: 'cgmsimoref0-node',
        mills: mills
      };
      
      await nsClient.uploadTreatments([nsTreatment]);
      logger.info('Uploaded temp basal cancellation to Nightscout');
    } catch (treatmentError) {
      logger.error('Error uploading temp basal cancellation:', treatmentError);
    }
  }
};

module.exports = {
  enactTreatments
};
