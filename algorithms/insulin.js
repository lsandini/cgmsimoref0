// algorithms/insulin.js
const { logger } = require('../utils/logger');

/**
 * Calculate Insulin on Board (IOB) from treatment history
 * @param {Object} state - Current loop state
 * @returns {Array} - Array of IOB data
 */
const calculateIOB = (state) => {
  try {
    logger.info('Calculating IOB');
    
    // Import the OpenAPS IOB calculation library
    const generate = require('oref0/lib/iob');
    
    // Format clock exactly as the original implementation would
    const now = new Date();
    const clockTime = now.toISOString();
    
    // Set up inputs for oref0-calculate-iob
    const inputs = {
      history: state.pumpHistory,
      history24: state.pumpHistory, // Use the same history for 24-hour window
      profile: state.profile,
      clock: clockTime
    };
    
    // Add autosens data if available
    if (state.autosens) {
      inputs.autosens = state.autosens;
    }
    
    // Generate IOB using the OpenAPS calculation
    const iobData = generate(inputs);
    
    // If no IOB data was generated, return a safe default
    if (!iobData || iobData.length === 0) {
      logger.warn('No IOB data returned from calculation, using default');
      return [createDefaultIOB()];
    }
    
    // Add additional data needed by determine-basal
    const enhancedIOB = enhanceIOBData(iobData[0], state);
    
    logger.info('IOB calculation completed', {
      iob: enhancedIOB.iob,
      basalIOB: enhancedIOB.basaliob,
      bolusIOB: enhancedIOB.bolusiob
    });
    
    return [enhancedIOB];
  } catch (error) {
    logger.error('Error calculating IOB:', error);
    return [createDefaultIOB()];
  }
};

/**
 * Enhance the IOB data with additional required fields
 * @param {Object} iobData - Basic IOB data
 * @param {Object} state - Current loop state
 * @returns {Object} - Enhanced IOB data
 */
const enhanceIOBData = (iobData, state) => {
  const now = new Date();
  const mills = now.getTime();
  const timeString = now.toISOString();
  
  // Create a complete object without any undefined values
  const enhanced = {
    ...iobData,
    iob: iobData.iob || 0,
    activity: iobData.activity || 0,
    basaliob: iobData.basaliob || 0,
    bolusiob: iobData.bolusiob || 0,
    netbasalinsulin: iobData.netbasalinsulin || 0,
    bolusinsulin: iobData.bolusinsulin || 0,
    time: iobData.time || timeString,
    timestamp: iobData.timestamp || timeString,
    mills: iobData.mills || mills
  };
  
  // Add last bolus time if available
  enhanced.lastBolusTime = findLastBolusTime(state.pumpHistory);
  
  // Add last temp basal if available
  enhanced.lastTemp = findLastTempBasal(state.pumpHistory, state.profile.current_basal);
  
  // Ensure iobWithZeroTemp is defined
  if (!enhanced.iobWithZeroTemp || typeof enhanced.iobWithZeroTemp.iob === 'undefined') {
    enhanced.iobWithZeroTemp = {
      iob: enhanced.iob,
      activity: enhanced.activity,
      basaliob: enhanced.basaliob,
      bolusiob: enhanced.bolusiob,
      netbasalinsulin: enhanced.netbasalinsulin || 0,
      bolusinsulin: enhanced.bolusinsulin || 0,
      time: enhanced.time
    };
  }
  
  return enhanced;
};

/**
 * Find the timestamp of the most recent bolus
 * @param {Array} pumpHistory - Pump history data
 * @returns {number} - Timestamp of the last bolus in milliseconds, or 0 if none found
 */
const findLastBolusTime = (pumpHistory) => {
  const bolusEntries = pumpHistory.filter(entry => 
    entry._type === 'Bolus' && entry.amount > 0
  );
  
  if (bolusEntries.length === 0) {
    return 0;
  }
  
  // Sort by date descending
  bolusEntries.sort((a, b) => {
    const dateA = a.date || new Date(a.timestamp).getTime();
    const dateB = b.date || new Date(b.timestamp).getTime();
    return dateB - dateA;
  });
  
  // Return the timestamp of the most recent bolus
  return bolusEntries[0].date || new Date(bolusEntries[0].timestamp).getTime();
};

/**
 * Find the most recent temp basal
 * @param {Array} pumpHistory - Pump history data
 * @param {number} defaultBasal - Default basal rate
 * @returns {Object} - Last temp basal data
 */
const findLastTempBasal = (pumpHistory, defaultBasal) => {
  const tempBasalEntries = pumpHistory.filter(entry => 
    entry._type === 'TempBasal'
  );
  
  if (tempBasalEntries.length === 0) {
    // Default lastTemp object if no temp basal found
    const now = new Date();
    return {
      rate: defaultBasal,
      timestamp: now.toISOString(),
      started_at: now.toISOString(),
      date: now.getTime(),
      duration: 0
    };
  }
  
  // Sort by date descending
  tempBasalEntries.sort((a, b) => {
    const dateA = a.date || new Date(a.timestamp).getTime();
    const dateB = b.date || new Date(b.timestamp).getTime();
    return dateB - dateA;
  });
  
  const latestTempBasal = tempBasalEntries[0];
  
  // Find corresponding duration entry matching timestamp
  const durationEntry = pumpHistory.find(entry => 
    entry._type === 'TempBasalDuration' && 
    entry.timestamp === latestTempBasal.timestamp
  );
  
  // Format exactly as expected
  return {
    rate: latestTempBasal.rate || 0,
    timestamp: latestTempBasal.timestamp,
    started_at: latestTempBasal.timestamp,
    date: latestTempBasal.date || new Date(latestTempBasal.timestamp).getTime(),
    duration: durationEntry ? (durationEntry['duration (min)'] || durationEntry.duration || 30) : 30
  };
};

/**
 * Create default IOB data structure with safe values
 * @returns {Object} - Default IOB data
 */
const createDefaultIOB = () => {
  const now = new Date();
  const mills = now.getTime();
  const timeString = now.toISOString();
  
  return {
    iob: 0,
    activity: 0,
    basaliob: 0,
    bolusiob: 0,
    netbasalinsulin: 0,
    bolusinsulin: 0,
    time: timeString,
    lastBolusTime: 0,
    lastTemp: {
      rate: 0,
      timestamp: timeString,
      started_at: timeString,
      date: mills,
      duration: 0
    },
    iobWithZeroTemp: {
      iob: 0,
      activity: 0,
      basaliob: 0,
      bolusiob: 0,
      netbasalinsulin: 0,
      bolusinsulin: 0,
      time: timeString
    },
    timestamp: timeString,
    mills: mills
  };
};

module.exports = {
  calculateIOB
};
