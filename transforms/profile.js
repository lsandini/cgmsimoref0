// transforms/profile.js
const logger = require('../utils/logger');

/**
 * Creates functions for transforming Nightscout profile to OpenAPS format
 * @returns {Object} - Profile transformation functions
 */
function createProfileTransforms() {
  /**
   * Transform Nightscout profile to OpenAPS format
   * @param {Object} nsProfile - Nightscout profile object
   * @param {Object} defaultValues - Default values to use as fallbacks
   * @returns {Object} - OpenAPS formatted profile
   */
  function transformProfile(nsProfile, defaultValues) {
    if (!nsProfile || !nsProfile.store) {
      logger.warn('Invalid or missing Nightscout profile');
      return createDefaultProfile(defaultValues);
    }
    
    try {
      // Get first profile from store or use defaultProfile
      const profileName = nsProfile.defaultProfile || Object.keys(nsProfile.store)[0];
      const profile = nsProfile.store[profileName];
      
      if (!profile) {
        logger.error("No profile found in Nightscout profile store");
        return createDefaultProfile(defaultValues);
      }
      
      logger.debug(`Transforming profile: ${profileName}`);
      
      // Define fallback values directly in this method
      const fallbacks = defaultValues || {
        dia: 6,
        current_basal: 0.7,
        sens: 36,
        carb_ratio: 10,
        min_bg: 100,
        max_bg: 100
      };
      
      // Extract values from the profile arrays
      let dia = profile.dia;
      
      // Extract current basal
      let current_basal = null;
      if (Array.isArray(profile.basal) && profile.basal.length > 0) {
        current_basal = profile.basal[0].value;
      }
      
      // Extract sensitivity factor
      let sens = null;
      if (Array.isArray(profile.sens) && profile.sens.length > 0) {
        sens = profile.sens[0].value;
        
        // Only convert if the profile is in mmol/L
        if (profile.units === "mmol") {
          logger.debug(`Original ISF from Nightscout (mmol/L): ${sens}`);
          // Store the value in mg/dL for internal use
          sens = sens * 18; // Convert from mmol/L to mg/dL
          logger.debug(`Converted ISF for OpenAPS (mg/dL): ${sens}`);
        } else {
          logger.debug(`Using ISF directly (already in mg/dL): ${sens}`);
        }
      }
      
      // Extract carb ratio
      let carb_ratio = null;
      if (Array.isArray(profile.carbratio) && profile.carbratio.length > 0) {
        carb_ratio = profile.carbratio[0].value;
      }
      
      // Extract target BG
      let min_bg = null;
      let max_bg = null;
      if (Array.isArray(profile.target_low) && profile.target_low.length > 0) {
        min_bg = profile.target_low[0].value;
      }
      if (Array.isArray(profile.target_high) && profile.target_high.length > 0) {
        max_bg = profile.target_high[0].value;
      }
      
      // Convert mmol/L to mg/dL if necessary
      if (profile.units === "mmol") {
        if (min_bg) min_bg = min_bg * 18; // Convert min_bg from mmol/L to mg/dL
        if (max_bg) max_bg = max_bg * 18; // Convert max_bg from mmol/L to mg/dL
      }
      
      // Create OpenAPS profile object
      const openAPSProfile = {
        // Core settings with fallbacks as needed
        dia: Number(dia || fallbacks.dia),
        insulinPeakTime: defaultValues.insulinPeakTime || 75,
        current_basal: Number(current_basal || fallbacks.current_basal),
        max_daily_basal: defaultValues.max_daily_basal || 1.0,
        sens: Number(sens || fallbacks.sens),
        carb_ratio: Number(carb_ratio || fallbacks.carb_ratio),
        min_bg: Number(min_bg !== null ? min_bg : fallbacks.min_bg),
        max_bg: Number(max_bg !== null ? max_bg : fallbacks.max_bg),
        max_basal: defaultValues.max_basal || 4,
        out_units: "mg/dL",
        
        // Required by oref0
        type: "current",
        
        // Create basalprofile
        basalprofile: createBasalProfile(profile.basal, current_basal || fallbacks.current_basal),
        
        // Create isfProfile
        isfProfile: createISFProfile(profile.sens, sens || fallbacks.sens, profile.units),
        
        // Create carb_ratios
        carb_ratios: createCarbRatios(profile.carbratio, carb_ratio || fallbacks.carb_ratio),
        
        // Create bg_targets
        bg_targets: createBGTargets(profile.target_low, profile.target_high, 
                                   min_bg !== null ? min_bg : fallbacks.min_bg, 
                                   max_bg !== null ? max_bg : fallbacks.max_bg,
                                   profile.units)
      };
      
      logger.info('Profile transformed from Nightscout:');
      logger.info(`- dia: ${openAPSProfile.dia}`);
      logger.info(`- current_basal: ${openAPSProfile.current_basal}`);
      logger.info(`- sens: ${openAPSProfile.sens}`);
      logger.info(`- carb_ratio: ${openAPSProfile.carb_ratio}`);
      logger.info(`- min_bg: ${openAPSProfile.min_bg}`);
      logger.info(`- max_bg: ${openAPSProfile.max_bg}`);
      
      return openAPSProfile;
    } catch (error) {
      logger.error(`Error transforming profile: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      return createDefaultProfile(defaultValues);
    }
  }
  
// transforms/profile.js (continued)

  /**
   * Create a default OpenAPS profile
   * @param {Object} defaultValues - Default values to use
   * @returns {Object} - Default OpenAPS profile
   */
  function createDefaultProfile(defaultValues) {
    const values = defaultValues || {
      dia: 6,
      insulinPeakTime: 75,
      current_basal: 0.7,
      max_daily_basal: 1.0,
      sens: 36,
      carb_ratio: 10,
      min_bg: 100,
      max_bg: 100,
      max_basal: 4
    };
    
    logger.warn('Creating default profile with hardcoded values');
    
    return {
      // Core settings
      dia: values.dia,
      insulinPeakTime: values.insulinPeakTime,
      current_basal: values.current_basal,
      max_daily_basal: values.max_daily_basal,
      sens: values.sens,
      carb_ratio: values.carb_ratio,
      min_bg: values.min_bg,
      max_bg: values.max_bg,
      max_basal: values.max_basal,
      out_units: "mg/dL",
      
      // Required by oref0
      type: "current",
      
      // Default basalprofile
      basalprofile: [
        {
          i: 0,
          start: "00:00:00",
          minutes: 0,
          rate: values.current_basal
        }
      ],
      
      // Default isfProfile
      isfProfile: {
        first: 1,
        sensitivities: [
          {
            endOffset: 1440,
            offset: 0,
            x: 0,
            sensitivity: values.sens,
            start: "00:00:00",
            i: 0
          }
        ],
        user_preferred_units: "mg/dL",
        units: "mg/dL"
      },
      
      // Default carb_ratios
      carb_ratios: {
        schedule: [
          {
            x: 0,
            i: 0,
            offset: 0,
            ratio: values.carb_ratio,
            r: values.carb_ratio,
            start: "00:00:00"
          }
        ],
        units: "grams"
      },
      
      // Default bg_targets
      bg_targets: {
        first: 1,
        targets: [
          {
            max_bg: values.max_bg,
            min_bg: values.min_bg,
            x: 0,
            offset: 0,
            low: values.min_bg,
            start: "00:00:00",
            high: values.max_bg,
            i: 0
          }
        ],
        user_preferred_units: "mg/dL",
        units: "mg/dL"
      }
    };
  }

  /**
   * Create basal profile for OpenAPS
   * @param {Array} basalArray - Nightscout basal array
   * @param {number} defaultBasal - Default basal rate
   * @returns {Array} - Formatted basal profile
   */
  function createBasalProfile(basalArray, defaultBasal) {
    if (!Array.isArray(basalArray) || basalArray.length === 0) {
      logger.debug('Missing or empty basal array, creating default basal profile');
      return [
        {
          i: 0,
          start: "00:00:00",
          minutes: 0,
          rate: defaultBasal
        }
      ];
    }
    
    logger.debug(`Creating basal profile from ${basalArray.length} entries`);
    
    // Convert Nightscout basal array to OpenAPS format
    const basalProfile = basalArray.map((entry, index) => {
      return {
        i: index,
        start: entry.time + ":00",
        minutes: entry.timeAsSeconds / 60,
        rate: entry.value
      };
    });
    
    // Sort by minutes
    basalProfile.sort((a, b) => a.minutes - b.minutes);
    
    return basalProfile;
  }

  /**
   * Create ISF profile for OpenAPS
   * @param {Array} sensArray - Nightscout sensitivity array
   * @param {number} defaultSens - Default sensitivity factor
   * @param {string} units - Profile units (mmol or mg/dL)
   * @returns {Object} - Formatted ISF profile
   */
  function createISFProfile(sensArray, defaultSens, units) {
    if (!Array.isArray(sensArray) || sensArray.length === 0) {
      logger.debug('Missing or empty sensitivity array, creating default ISF profile');
      return {
        units: "mg/dL",
        user_preferred_units: units === "mmol" ? "mmol/L" : "mg/dL",
        sensitivities: [
          {
            i: 0,
            x: 0,
            sensitivity: defaultSens,
            offset: 0,
            start: "00:00:00",
            endOffset: 1440
          }
        ]
      };
    }
    
    logger.debug(`Creating ISF profile from ${sensArray.length} entries`);
    
    // Convert Nightscout sensitivity array to OpenAPS format
    const isfProfile = {
      units: "mg/dL",
      user_preferred_units: units === "mmol" ? "mmol/L" : "mg/dL",
      sensitivities: []
    };
    
    sensArray.forEach((entry, index) => {
      // Sensitivity value should already be converted to mg/dL by transformProfile
      const sensitivity = units === "mmol" ? entry.value * 18 : entry.value;
      
      isfProfile.sensitivities.push({
        i: index,
        x: index,
        sensitivity: sensitivity,
        offset: entry.timeAsSeconds / 60,
        start: entry.time + ":00",
        endOffset: index < sensArray.length - 1 ? 
          (sensArray[index + 1].timeAsSeconds / 60) : 1440
      });
    });
    
    return isfProfile;
  }

  /**
   * Create carb ratios for OpenAPS
   * @param {Array} carbratio - Nightscout carb ratio array
   * @param {number} defaultRatio - Default carb ratio
   * @returns {Object} - Formatted carb ratios
   */
  function createCarbRatios(carbratioArray, defaultRatio) {
    if (!Array.isArray(carbratioArray) || carbratioArray.length === 0) {
      logger.debug('Missing or empty carb ratio array, creating default carb ratios');
      return {
        units: "grams",
        schedule: [
          {
            x: 0,
            i: 0,
            start: "00:00:00",
            offset: 0,
            ratio: defaultRatio,
            r: defaultRatio
          }
        ]
      };
    }
    
    logger.debug(`Creating carb ratios from ${carbratioArray.length} entries`);
    
    // Convert Nightscout carb ratio array to OpenAPS format
    const carbRatios = {
      units: "grams",
      schedule: []
    };
    
    carbratioArray.forEach((entry, index) => {
      carbRatios.schedule.push({
        x: index,
        i: index,
        start: entry.time + ":00",
        offset: entry.timeAsSeconds / 60,
        ratio: entry.value,
        r: entry.value // Some versions of OpenAPS use 'r' instead of 'ratio'
      });
    });
    
    return carbRatios;
  }

  /**
   * Create BG targets for OpenAPS
   * @param {Array} targetLow - Nightscout target low array
   * @param {Array} targetHigh - Nightscout target high array
   * @param {number} defaultLow - Default low target
   * @param {number} defaultHigh - Default high target
   * @param {string} units - Profile units (mmol or mg/dL)
   * @returns {Object} - Formatted BG targets
   */
  function createBGTargets(targetLow, targetHigh, defaultLow, defaultHigh, units) {
    if (!Array.isArray(targetLow) || !Array.isArray(targetHigh) || 
        targetLow.length === 0 || targetHigh.length === 0) {
      logger.debug('Missing or empty target arrays, creating default BG targets');
      return {
        units: "mg/dL",
        user_preferred_units: units === "mmol" ? "mmol/L" : "mg/dL",
        targets: [
          {
            i: 0,
            x: 0,
            high: defaultHigh,
            start: "00:00:00",
            low: defaultLow,
            offset: 0,
            max_bg: defaultHigh,
            min_bg: defaultLow
          }
        ]
      };
    }
    
    logger.debug(`Creating BG targets from ${targetLow.length} entries`);
    
    // Convert Nightscout target arrays to OpenAPS format
    const bgTargets = {
      units: "mg/dL",
      user_preferred_units: units === "mmol" ? "mmol/L" : "mg/dL",
      targets: []
    };
    
    // Assuming target_low and target_high have the same length and times
    targetLow.forEach((entry, index) => {
      // Convert mmol values to mg/dL for targets if needed
      const low = units === "mmol" ? entry.value * 18 : entry.value;
      const high = units === "mmol" ? targetHigh[index].value * 18 : targetHigh[index].value;
      
      bgTargets.targets.push({
        i: index,
        x: index,
        high: high,
        start: entry.time + ":00",
        low: low,
        offset: entry.timeAsSeconds / 60,
        max_bg: high,
        min_bg: low
      });
    });
    
    return bgTargets;
  }

  /**
   * Add preferences to profile for OpenAPS
   * @param {Object} profile - OpenAPS profile
   * @param {Object} preferences - User preferences
   * @returns {Object} - Profile with preferences added
   */
  function addPreferencesToProfile(profile, preferences) {
    if (!preferences) {
      logger.warn('No preferences provided, returning profile as is');
      return profile;
    }
    
    logger.debug('Adding preferences to profile');
    
    // Create a new profile with preferences added
    return {
      ...profile,
      ...preferences
    };
  }

  return {
    transformProfile,
    createDefaultProfile,
    addPreferencesToProfile
  };
}

module.exports = { createProfileTransforms };