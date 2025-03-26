// transforms/profile.js
const { logger } = require('../utils/logger');

/**
 * Default profile values used when Nightscout data is incomplete
 */
const defaultProfileValues = {
  dia: 6,                 // Duration of insulin action in hours
  insulinPeakTime: 75,    // Peak time for insulin activity in minutes
  current_basal: 0.7,     // Default basal rate in U/h
  max_daily_basal: 1.0,   // Maximum daily basal rate
  sens: 36,               // Insulin sensitivity factor (mg/dL/U)
  carb_ratio: 10,         // Carb ratio (g/U)
  min_bg: 100,            // Target minimum BG (mg/dL)
  max_bg: 100,            // Target maximum BG (mg/dL)
  max_basal: 4,           // Maximum temp basal rate
  out_units: "mg/dL"      // Output units
};

/**
 * Process Nightscout profile data into the format needed by OpenAPS
 * @param {Object} nsProfile - Raw Nightscout profile data
 * @param {Object} defaultProfile - Default profile values to use when data is missing
 * @returns {Object} - Normalized profile object
 */
const processProfile = (nsProfile, defaultProfile = defaultProfileValues) => {
  if (!nsProfile || !nsProfile.store) {
    logger.warn('Invalid or missing Nightscout profile');
    return createDefaultProfile(defaultProfile);
  }
  
  try {
    // Get first profile from store or use defaultProfile
    const profileName = nsProfile.defaultProfile || Object.keys(nsProfile.store)[0];
    const rawProfile = nsProfile.store[profileName];
    
    if (!rawProfile) {
      logger.error("No profile found in Nightscout profile store");
      return createDefaultProfile(defaultProfile);
    }
    
    // Extract basic profile values with fallbacks
    const profile = {
      ...defaultProfile,
      // Extract simple values
      dia: getProfileValue(rawProfile, 'dia', defaultProfile.dia),
      current_basal: extractBasalRate(rawProfile),
      // Store original units to track conversions
      original_units: rawProfile.units || 'mg/dL',
      
      // NEW: Add maxCOB from preferences or default
      maxCOB: defaultProfile.maxCOB || 120
    };
    
    // Extract and possibly convert sensitivity factor
    profile.sens = extractSensitivityFactor(rawProfile, profile.original_units);
    
    // Extract carb ratio
    profile.carb_ratio = extractCarbRatio(rawProfile, defaultProfile.carb_ratio);
    
    // Extract and possibly convert BG targets
    const targets = extractBGTargets(rawProfile, profile.original_units);
    profile.min_bg = targets.min_bg;
    profile.max_bg = targets.max_bg;
    
    // Force internal calculations to display in mg/dL
    profile.out_units = "mg/dL";
    
    // Add required type field
    profile.type = "current";
    
    // Create proper nested structures required by determine_basal
    profile.basalprofile = createBasalProfile(rawProfile, profile.current_basal);
    profile.isfProfile = createISFProfile(rawProfile, profile.sens, profile.original_units);
    profile.bg_targets = createBGTargets(rawProfile, profile.min_bg, profile.max_bg, profile.original_units);
    profile.carb_ratios = createCarbRatios(rawProfile, profile.carb_ratio);
    
    logger.info('Profile processed successfully');
    return profile;
  } catch (error) {
    logger.error('Error processing profile:', error);
    return createDefaultProfile(defaultProfile);
  }
};

/**
 * Extract a value from the profile with fallback
 * @param {Object} profile - Raw profile object
 * @param {string} key - Property key to extract
 * @param {any} defaultValue - Default value if not found
 * @returns {any} - Extracted value
 */
const getProfileValue = (profile, key, defaultValue) => {
  const value = profile[key];
  return value !== undefined && value !== null ? value : defaultValue;
};

/**
 * Extract the basal rate from the profile
 * @param {Object} profile - Raw profile object
 * @returns {number} - Basal rate
 */
const extractBasalRate = (profile) => {
  if (Array.isArray(profile.basal) && profile.basal.length > 0) {
    return profile.basal[0].value;
  }
  return defaultProfileValues.current_basal;
};

/**
 * Extract and possibly convert sensitivity factor
 * @param {Object} profile - Raw profile object
 * @param {string} units - Original units ('mmol' or 'mg/dL')
 * @returns {number} - Sensitivity factor in mg/dL
 */
const extractSensitivityFactor = (profile, units) => {
  if (Array.isArray(profile.sens) && profile.sens.length > 0) {
    let sens = profile.sens[0].value;
    
    // Convert to mg/dL if needed
    if (units === "mmol") {
      logger.debug("Converting ISF from mmol/L to mg/dL", {original: sens});
      sens = sens * 18; // Convert from mmol/L to mg/dL
      logger.debug("Converted ISF for OpenAPS", {converted: sens});
    }
    
    return sens;
  }
  
  return defaultProfileValues.sens;
};

/**
 * Extract carb ratio from the profile
 * @param {Object} profile - Raw profile object
 * @param {number} defaultValue - Default value if not found
 * @returns {number} - Carb ratio
 */
const extractCarbRatio = (profile, defaultValue) => {
  if (Array.isArray(profile.carbratio) && profile.carbratio.length > 0) {
    return profile.carbratio[0].value;
  }
  return defaultValue;
};

/**
 * Extract and possibly convert BG targets
 * @param {Object} profile - Raw profile object
 * @param {string} units - Original units ('mmol' or 'mg/dL')
 * @returns {Object} - Object with min_bg and max_bg in mg/dL
 */
const extractBGTargets = (profile, units) => {
  let min_bg = null;
  let max_bg = null;
  
  if (Array.isArray(profile.target_low) && profile.target_low.length > 0) {
    min_bg = profile.target_low[0].value;
  }
  if (Array.isArray(profile.target_high) && profile.target_high.length > 0) {
    max_bg = profile.target_high[0].value;
  }
  
  // Convert to mg/dL if necessary
  if (units === "mmol") {
    if (min_bg !== null) min_bg = min_bg * 18; // Convert from mmol/L to mg/dL
    if (max_bg !== null) max_bg = max_bg * 18; // Convert from mmol/L to mg/dL
  }
  
  return {
    min_bg: min_bg !== null ? min_bg : defaultProfileValues.min_bg,
    max_bg: max_bg !== null ? max_bg : defaultProfileValues.max_bg
  };
};

/**
 * Create a default profile with required structure
 * @param {Object} defaults - Default profile values
 * @returns {Object} - Complete profile structure
 */
const createDefaultProfile = (defaults) => {
  const profile = {
    ...defaults,
    type: "current",
    original_units: "mg/dL",
    out_units: "mg/dL"
  };
  
  // Create required nested structures
  profile.basalprofile = createBasalProfile(null, profile.current_basal);
  profile.isfProfile = createISFProfile(null, profile.sens, "mg/dL");
  profile.bg_targets = createBGTargets(null, profile.min_bg, profile.max_bg, "mg/dL");
  profile.carb_ratios = createCarbRatios(null, profile.carb_ratio);
  
  logger.info('Created default profile');
  return profile;
};

/**
 * Create basal profile structure
 * @param {Object} rawProfile - Raw profile data
 * @param {number} defaultBasal - Default basal rate
 * @returns {Array} - Formatted basal profile
 */
const createBasalProfile = (rawProfile, defaultBasal) => {
  if (rawProfile && Array.isArray(rawProfile.basal) && rawProfile.basal.length > 0) {
    return rawProfile.basal.map((entry, index) => ({
      i: index,
      start: entry.time + ":00",
      minutes: entry.timeAsSeconds / 60,
      rate: entry.value
    }));
  } else {
    // Default profile if none exists
    return [{
      i: 0,
      start: "00:00:00",
      minutes: 0,
      rate: defaultBasal
    }];
  }
};

/**
 * Create ISF profile structure
 * @param {Object} rawProfile - Raw profile data
 * @param {number} defaultSens - Default sensitivity factor
 * @param {string} originalUnits - Original units ('mmol' or 'mg/dL')
 * @returns {Object} - Formatted ISF profile
 */
const createISFProfile = (rawProfile, defaultSens, originalUnits) => {
  const isfProfile = {
    units: "mg/dL",
    user_preferred_units: originalUnits === "mmol" ? "mmol/L" : "mg/dL",
    sensitivities: []
  };
  
  if (rawProfile && Array.isArray(rawProfile.sens) && rawProfile.sens.length > 0) {
    rawProfile.sens.forEach((entry, index) => {
      // Convert if needed - already handled in extractSensitivityFactor
      const sensitivity = originalUnits === "mmol" ? 
        entry.value * 18 : entry.value;
      
      isfProfile.sensitivities.push({
        i: index,
        x: index,
        sensitivity: sensitivity,
        offset: entry.timeAsSeconds / 60,
        start: entry.time + ":00",
        endOffset: index < rawProfile.sens.length - 1 ? 
          (rawProfile.sens[index + 1].timeAsSeconds / 60) : 1440
      });
    });
  } else {
    // Default sensitivity if none exists
    isfProfile.sensitivities = [{
      i: 0,
      x: 0,
      sensitivity: defaultSens,
      offset: 0,
      start: "00:00:00",
      endOffset: 1440
    }];
  }
  
  return isfProfile;
};

/**
 * Create BG targets structure
 * @param {Object} rawProfile - Raw profile data
 * @param {number} defaultMinBG - Default minimum BG
 * @param {number} defaultMaxBG - Default maximum BG
 * @param {string} originalUnits - Original units ('mmol' or 'mg/dL')
 * @returns {Object} - Formatted BG targets
 */
const createBGTargets = (rawProfile, defaultMinBG, defaultMaxBG, originalUnits) => {
  const bgTargets = {
    units: "mg/dL",
    user_preferred_units: originalUnits === "mmol" ? "mmol/L" : "mg/dL",
    targets: []
  };
  
  if (rawProfile && Array.isArray(rawProfile.target_low) && Array.isArray(rawProfile.target_high)) {
    // Assuming target_low and target_high have the same length and times
    rawProfile.target_low.forEach((entry, index) => {
      // Convert mmol values to mg/dL for targets if needed
      const low = originalUnits === "mmol" ? entry.value * 18 : entry.value;
      const high = originalUnits === "mmol" ? 
        rawProfile.target_high[index].value * 18 : rawProfile.target_high[index].value;
      
      bgTargets.targets.push({
        i: index,
        x: index, // x is used for plotting
        high: high,
        start: entry.time + ":00",
        low: low,
        offset: entry.timeAsSeconds / 60,
        max_bg: high,
        min_bg: low
      });
    });
  } else {
    // Default targets if none exist
    bgTargets.targets = [{
      i: 0,
      x: 0,
      high: defaultMaxBG,
      start: "00:00:00",
      low: defaultMinBG,
      offset: 0,
      max_bg: defaultMaxBG,
      min_bg: defaultMinBG
    }];
  }
  
  return bgTargets;
};

/**
 * Create carb ratios structure
 * @param {Object} rawProfile - Raw profile data
 * @param {number} defaultCarbRatio - Default carb ratio
 * @returns {Object} - Formatted carb ratios
 */
const createCarbRatios = (rawProfile, defaultCarbRatio) => {
  const carbRatios = {
    units: "grams",
    schedule: []
  };
  
  if (rawProfile && Array.isArray(rawProfile.carbratio) && rawProfile.carbratio.length > 0) {
    rawProfile.carbratio.forEach((entry, index) => {
      carbRatios.schedule.push({
        x: index,
        i: index,
        start: entry.time + ":00",
        offset: entry.timeAsSeconds / 60,
        ratio: entry.value,
        r: entry.value // Some versions of OpenAPS use 'r' instead of 'ratio'
      });
    });
  } else {
    // Default carb ratio if none exists
    carbRatios.schedule = [{
      x: 0,
      i: 0,
      start: "00:00:00",
      offset: 0,
      ratio: defaultCarbRatio,
      r: defaultCarbRatio
    }];
  }
  
  return carbRatios;
};

module.exports = {
  processProfile,
  defaultProfileValues
};
