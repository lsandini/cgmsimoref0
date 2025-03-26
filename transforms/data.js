// transforms/data.js
const { logger } = require('../utils/logger');
const { processProfile } = require('./profile');

/**
 * Fetch all required data for loop execution
 * @param {Object} nsClient - Nightscout client
 * @param {Object} config - Configuration
 * @returns {Promise<Object>} - Complete state object
 */
const fetchLoopData = async (nsClient, config) => {
  const state = {
    timestamp: new Date().toISOString(),
    clock: new Date().toISOString()
  };
  
  try {
    // Process profile (assuming it's already fetched in mpc.js)
    if (config.profile) {
      state.profile = processProfile(config.profile, config.defaultProfile);
    } else {
      // Fallback in case profile wasn't passed
      logger.info('Fetching profile from Nightscout');
      const nsProfile = await nsClient.getProfile();
      state.profile = processProfile(nsProfile, config.defaultProfile);
    }
    
    // Fetch glucose data (24 hours for autosens, recent for loop)
    logger.info('Fetching glucose readings');
    const allGlucose = await nsClient.getEntries(24);
    state.glucose = allGlucose;
    
    // Fetch pump history (24 hours for IOB calculations)
    logger.info('Fetching pump history');
    const treatments = await nsClient.getTreatments(24);
    
    // Process treatments into pump history format
    const { pumpHistory, carbHistory } = processTreatments(treatments);
    state.pumpHistory = pumpHistory;
    state.carbHistory = carbHistory;
    
    // Add preferences to state
    state.preferences = config.preferences || {};
    
    logger.info('All data fetched successfully');
    return state;
  } catch (error) {
    logger.error('Error fetching loop data:', error);
    throw error;
  }
};

/**
 * Process Nightscout treatments into pump history format
 * @param {Array} treatments - Nightscout treatments
 * @returns {Object} - Formatted pump history and carb history
 */
const processTreatments = (treatments) => {
  // Filter to recent treatments only (last 24 hours)
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const recentTreatments = treatments.filter(t => 
    new Date(t.created_at) >= oneDayAgo
  );

  // Convert to pump history format
  const pumpHistory = [];
  const carbHistory = [];

  recentTreatments.forEach(treatment => {
    const timestamp = treatment.created_at || treatment.timestamp || new Date().toISOString();
    const dateNum = new Date(timestamp).getTime();

    // Convert bolus treatments
    if (treatment.insulin && ['Bolus', 'Meal Bolus', 'Snack Bolus', 'Correction Bolus', 'SMB'].includes(treatment.eventType)) {
      pumpHistory.push({
        _type: 'Bolus',
        timestamp: timestamp,
        amount: parseFloat(treatment.insulin),
        programmed: parseFloat(treatment.insulin),
        unabsorbed: 0,
        duration: 0,
        date: dateNum
      });
    }

    // Convert temp basals
    if (treatment.eventType === 'Temp Basal') {
      // TempBasal entry
      pumpHistory.push({
        _type: 'TempBasal',
        timestamp: timestamp,
        rate: parseFloat(treatment.rate || treatment.absolute),
        temp: 'absolute',
        date: dateNum
      });

      // TempBasalDuration entry
      pumpHistory.push({
        _type: 'TempBasalDuration',
        timestamp: timestamp,
        'duration (min)': parseInt(treatment.duration),
        date: dateNum
      });
    }

    // Convert carb entries
    if (treatment.carbs) {
      const carbEntry = {
        _type: 'Meal',
        timestamp: timestamp,
        carbs: parseInt(treatment.carbs),
        created_at: timestamp,
        date: dateNum
      };

      pumpHistory.push(carbEntry);
      carbHistory.push(carbEntry);
    }
  });

  // Sort pump history by date, most recent first
  pumpHistory.sort((a, b) => b.date - a.date);

  logger.info(`Processed ${pumpHistory.length} pump history records`);
  return { pumpHistory, carbHistory };
};

/**
 * Get current temp basal status
 * @param {Array} pumpHistory - Pump history array
 * @param {number} defaultBasal - Default basal rate
 * @returns {Object} - Current temp basal status
 */
const getCurrentTempBasal = (pumpHistory, defaultBasal) => {
  // Find the most recent temp basal
  const tempBasals = pumpHistory.filter(entry => entry._type === 'TempBasal');
  
  if (tempBasals.length === 0) {
    return {
      duration: 0,
      rate: 0,
      temp: 'absolute',
      timestamp: new Date().toISOString()
    };
  }
  
  // Sort by date, most recent first (should already be sorted)
  tempBasals.sort((a, b) => b.date - a.date);
  const latestTempBasal = tempBasals[0];
  
  // Find corresponding duration entry
  const durationEntry = pumpHistory.find(entry => 
    entry._type === 'TempBasalDuration' && 
    entry.timestamp === latestTempBasal.timestamp
  );
  
  // Calculate remaining duration
  let remainingDuration = 0;
  if (durationEntry) {
    const durationMinutes = durationEntry['duration (min)'] || 0;
    const startTime = new Date(latestTempBasal.timestamp).getTime();
    const currentTime = new Date().getTime();
    const elapsedMinutes = Math.floor((currentTime - startTime) / 60000);
    
    remainingDuration = Math.max(0, durationMinutes - elapsedMinutes);
  }
  
  return {
    duration: remainingDuration,
    rate: latestTempBasal.rate || defaultBasal,
    temp: 'absolute',
    timestamp: latestTempBasal.timestamp
  };
};

module.exports = {
  fetchLoopData,
  processTreatments,
  getCurrentTempBasal
};