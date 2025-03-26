// api/deviceStatus.js
const { logger } = require('../utils/logger');

/**
 * Create and upload device status to Nightscout
 * @param {Object} state - Current loop state
 * @param {Object} recommendations - Treatment recommendations
 * @param {Object} nsClient - Nightscout client
 * @returns {Promise<Object>} - Upload response
 */
const uploadDeviceStatus = async (state, recommendations, nsClient) => {
  try {
    const deviceStatus = createDeviceStatus(state, recommendations);
    
    logger.info('Uploading device status to Nightscout');
    const response = await nsClient.uploadDeviceStatus([deviceStatus]);
    logger.info('Device status uploaded successfully');
    
    return response;
  } catch (error) {
    logger.error('Error uploading device status:', error);
    throw error;
  }
};

/**
 * Create device status object for Nightscout
 * @param {Object} state - Current loop state
 * @param {Object} recommendations - Treatment recommendations
 * @returns {Object} - Device status object
 */
const createDeviceStatus = (state, recommendations) => {
  const now = new Date();
  const mills = now.getTime();
  const timeString = now.toISOString();
  
  // Get current glucose reading with fallback
  const currentBG = state.glucose && state.glucose.length > 0 
    ? state.glucose[0].sgv 
    : 120;
  
  // Get iobData with fallbacks
  const iobData = state.iob && state.iob.length > 0 ? state.iob[0] : {
    iob: 0,
    activity: 0,
    basaliob: 0,
    bolusiob: 0,
    time: timeString
  };
  
  // Calculate glucose trend indicators
  const tick = calculateGlucoseTick(state.glucose);
  
  // Get COB
  const COB = Math.round(state.meal?.mealCOB || 0);
  
  // Build the complete device status object
  const deviceStatus = {
    device: "openaps://cgmsimoref0-node",
    openaps: {
      iob: iobData,
      suggested: {
        temp: "absolute",
        bg: currentBG,
        tick: tick,
        eventualBG: recommendations.eventualBG || currentBG,
        insulinReq: recommendations.insulinReq || 0,
        reservoir: "180.4", // Mock value
        deliverAt: recommendations.deliverAt || timeString,
        sensitivityRatio: recommendations.sensitivityRatio || 1.0,
        predBGs: recommendations.predBGs || {},
        COB: COB,
        IOB: iobData.iob || 0,
        BGI: recommendations.BGI || 0,
        deviation: recommendations.deviation || 0,
        ISF: recommendations.ISF || state.profile.sens,
        CR: recommendations.CR || state.profile.carb_ratio,
        target_bg: recommendations.target_bg || state.profile.min_bg,
        reason: recommendations.reason,
        duration: recommendations.duration,
        rate: recommendations.rate,
        timestamp: timeString,
        mills: mills
      },
      enacted: {
        reason: recommendations.reason,
        temp: "absolute",
        deliverAt: recommendations.deliverAt || timeString,
        rate: recommendations.rate,
        duration: recommendations.duration,
        received: true,
        timestamp: timeString,
        mills: mills,
        bg: currentBG,
        tick: tick,
        eventualBG: recommendations.eventualBG || currentBG,
        predBGs: recommendations.predBGs || {},
        COB: COB,
        IOB: iobData.iob || 0
      },
      version: "0.7.1"
    },
    pump: {
      clock: timeString,
      battery: {
        voltage: 1.39,
        status: "normal"
      },
      reservoir: 180.4, // Mock value
      status: {
        status: "normal",
        bolusing: false,
        suspended: false,
        timestamp: timeString
      }
    },
    preferences: state.preferences || {},
    uploader: {
      batteryVoltage: 3861,
      battery: 68
    },
    created_at: timeString
  };
  
  return deviceStatus;
};

/**
 * Calculate glucose trend indicator
 * @param {Array} glucose - Glucose readings
 * @returns {string} - Trend indicator
 */
const calculateGlucoseTick = (glucose) => {
  let tick = "+0";
  if (glucose && glucose.length >= 2) {
    const currentBG = glucose[0].sgv;
    const prevBG = glucose[1].sgv;
    const delta = currentBG - prevBG;
    
    if (delta >= 4) tick = "+4";
    else if (delta >= 3) tick = "+3";
    else if (delta >= 2) tick = "+2";
    else if (delta >= 1) tick = "+1";
    else if (delta <= -4) tick = "-4";
    else if (delta <= -3) tick = "-3";
    else if (delta <= -2) tick = "-2";
    else if (delta <= -1) tick = "-1";
    else tick = "+0";
  }
  
  return tick;
};

module.exports = {
  uploadDeviceStatus,
  createDeviceStatus
};
