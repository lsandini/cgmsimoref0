// algorithms/basal.js
const { logger } = require('../utils/logger');

/**
 * Determine basal rate recommendations based on current state
 * @param {Object} state - Current loop state
 * @returns {Object} - Basal recommendations
 */
const determineBasal = (state) => {
  try {
    logger.info('Determining basal recommendations');
    
    // Import oref0 modules
    const determineBasalFn = require('oref0/lib/determine-basal/determine-basal');
    const getLastGlucose = require('oref0/lib/glucose-get-last');
    const tempBasalFunctions = require('oref0/lib/basal-set-temp');
    
    // Get glucose status (delta, etc.)
    const glucose_status = getLastGlucose(state.glucose);
    
    // Add fallback for missing glucose data
    if (!glucose_status || !glucose_status.glucose) {
      logger.warn('Missing or invalid glucose data, using fallback values');
      return createDefaultRecommendation(state);
    }
    
    // Get the current glucose reading
    const current_glucose = state.glucose[0] || { sgv: 120 };
    const bg = current_glucose.sgv;
    
    logger.info(`Current BG: ${bg} mg/dl`);
    
    // Current temporary basal
    const temp = {
      duration: state.tempBasal?.duration || 0,
      rate: state.tempBasal?.rate || 0,
      temp: "absolute"
    };
    
    // Validate essential profile properties and ensure they exist
    const profile = validateProfile(state.profile);
    
    // IOB data as an array (required format)
    const iob_data = state.iob || [{ 
      iob: 0, activity: 0, basaliob: 0, bolusiob: 0 
    }];
    
    // Meal data
    const meal_data = state.meal || {
      carbs: 0,
      mealCOB: 0,
      currentDeviation: 0,
      maxDeviation: 0,
      minDeviation: 0
    };
    
    // Autosens data
    const autosens_data = state.autosens || { ratio: 1.0 };
    
    logger.debug('Determine Basal Inputs', {
      bg: bg,
      iob: iob_data[0].iob,
      cob: meal_data.mealCOB,
      autosens: autosens_data.ratio
    });
    
    // Call determine-basal with all required inputs
    const determineBasalResult = determineBasalFn(
      glucose_status,
      temp,
      iob_data,
      profile,
      autosens_data,
      meal_data,
      tempBasalFunctions,
      true // Allow microbolus/SMB
    );
    
    // Handle case where determine_basal returns null or undefined
    if (!determineBasalResult) {
      logger.error("determine-basal returned null or undefined");
      return createDefaultRecommendation(state);
    }
    
    // Post-process the result
    const processedResult = processBasalResult(determineBasalResult, profile, bg);
    
    logger.info('Determine Basal Result', {
      rate: processedResult.rate,
      duration: processedResult.duration,
      reason: (processedResult.reason || 'No reason provided').split('\n')[0],
      eventualBG: processedResult.eventualBG
    });
    
    return processedResult;
  } catch (error) {
    logger.error('Error determining basal:', error);
    return createDefaultRecommendation(state);
  }
};

/**
 * Create default recommendation with safe values
 * @param {Object} state - Current loop state
 * @returns {Object} - Default recommendation
 */
const createDefaultRecommendation = (state) => {
  // Hardcoded fallback values
  const fallbackBasalRate = 0.7;
  const fallbackBG = 120;
  
  // Get current basal rate from profile if available
  const current_basal = state.profile?.current_basal || fallbackBasalRate;
  
  // Get current BG if available
  const current_bg = state.glucose && state.glucose.length > 0 
    ? state.glucose[0].sgv 
    : fallbackBG;
  
  logger.warn('Using default recommendation due to error or missing data');
  
  return {
    reason: "Error in determine-basal algorithm. Using safe defaults.",
    rate: current_basal,
    duration: 0,
    temp: "absolute",
    deliverAt: new Date(),
    eventualBG: current_bg
  };
};

/**
 * Validate and ensure profile has all required properties
 * @param {Object} profile - Profile object
 * @returns {Object} - Validated profile
 */
const validateProfile = (profile) => {
  // Define fallback values for essential properties
  const fallbacks = {
    dia: 6,
    current_basal: 0.7,
    sens: 36,
    carb_ratio: 10,
    min_bg: 100,
    max_bg: 100,
    max_iob: 3,
    curve: 'ultra-rapid',
    insulinPeakTime: 75,
    useCustomPeakTime: false
  };
  
  // Clone profile to avoid modifying the original
  const validatedProfile = { ...profile };
  
  // Ensure basic properties exist
  Object.entries(fallbacks).forEach(([key, value]) => {
    if (validatedProfile[key] === undefined) {
      logger.warn(`Profile missing ${key}, using default value: ${value}`);
      validatedProfile[key] = value;
    }
  });
  
  // Ensure complex structures exist
  if (!validatedProfile.basalprofile || !Array.isArray(validatedProfile.basalprofile) || validatedProfile.basalprofile.length === 0) {
    logger.warn('Missing or empty basalprofile, creating default');
    validatedProfile.basalprofile = [
      {
        i: 0,
        start: "00:00:00",
        minutes: 0,
        rate: validatedProfile.current_basal
      }
    ];
  }
  
  if (!validatedProfile.isfProfile || !validatedProfile.isfProfile.sensitivities || 
    !Array.isArray(validatedProfile.isfProfile.sensitivities) || 
    validatedProfile.isfProfile.sensitivities.length === 0) {
    logger.warn('Missing or invalid isfProfile, creating default');
    validatedProfile.isfProfile = {
      first: 1,
      units: "mg/dL",
      user_preferred_units: "mg/dL",
      sensitivities: [
        {
          i: 0,
          x: 0,
          sensitivity: validatedProfile.sens,
          offset: 0,
          start: "00:00:00",
          endOffset: 1440
        }
      ]
    };
  }
  
  // Ensure SMB settings are set from preferences
  validatedProfile.enableSMB_always = validatedProfile.enableSMB_always || false;
  validatedProfile.enableSMB_with_COB = validatedProfile.enableSMB_with_COB || false;
  validatedProfile.enableSMB_with_bolus = validatedProfile.enableSMB_with_bolus || false;
  validatedProfile.enableSMB_with_temptarget = validatedProfile.enableSMB_with_temptarget || false;
  validatedProfile.enableSMB_after_carbs = validatedProfile.enableSMB_after_carbs || false;
  validatedProfile.enableUAM = validatedProfile.enableUAM || false;
  validatedProfile.maxSMBBasalMinutes = validatedProfile.maxSMBBasalMinutes || 30;
  validatedProfile.maxUAMSMBBasalMinutes = validatedProfile.maxUAMSMBBasalMinutes || 30;
  
  return validatedProfile;
};

/**
 * Process the results of determine-basal to add missing fields and handle edge cases
 * @param {Object} result - Raw result from determine-basal
 * @param {Object} profile - Profile object
 * @param {number} bg - Current blood glucose
 * @returns {Object} - Processed result
 */
const processBasalResult = (result, profile, bg) => {
  // Clone the result to avoid modifying the original
  const processed = { ...result };
  
  // Handle unit conversions
  if (processed.ISF && profile.out_units === "mmol/L") {
    // Store the original ISF value before it gets converted
    processed.ISF_mgdl = processed.ISF ? 
      (parseFloat(processed.ISF) * 18).toFixed(1) : null;
  }
  
  // Add missing fields when "doing nothing"
  if (processed.rate === undefined) {
    processed.rate = profile.current_basal; // Use current basal
  }
  
  if (processed.duration === undefined) {
    processed.duration = 0; // No temp basal duration
  }
  
  processed.deliverAt = processed.deliverAt || new Date();
  
  // Make sure eventualBG is set (this affects prediction data)
  if (processed.eventualBG === undefined) {
    // Extract eventualBG from the reason string if possible
    const reasonStr = processed.reason || '';
    const eventualBGMatch = reasonStr.match(/eventualBG (\d+)/);
    if (eventualBGMatch && eventualBGMatch[1]) {
      processed.eventualBG = parseInt(eventualBGMatch[1]);
    } else {
      // Default to current BG if we can't extract it
      processed.eventualBG = bg;
    }
  }
  
  return processed;
};

module.exports = {
  determineBasal
};
