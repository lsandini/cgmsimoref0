// algorithms/basal.js
const tempBasalFunctions = require('oref0/lib/basal-set-temp');
const determine_basal = require('oref0/lib/determine-basal/determine-basal');
const getLastGlucose = require('oref0/lib/glucose-get-last');
const logger = require('../utils/logger');

/**
 * Creates functions for basal rate calculations and adjustments
 * @returns {Object} - Functions for determining basal rates
 */
function createBasalCalculations() {
  /**
   * Calculate recommended basal adjustment
   * @param {Object} data - Current data
   * @param {Array} data.glucose - Glucose readings
   * @param {Object} data.currentTemp - Current temporary basal
   * @param {Array} data.iob - IOB data
   * @param {Object} data.profile - OpenAPS profile
   * @param {Object} data.autosens - Autosens data
   * @param {Object} data.meal - Meal data
   * @returns {Object} - Basal recommendations
   */
  function determineBasal(data) {
    try {
      logger.debug('Running determine-basal algorithm...');
      
      // Define fallback values for essential profile properties
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
      
      // Make sure we have glucose data
      if (!data.glucose || !Array.isArray(data.glucose) || data.glucose.length === 0) {
        logger.warn('Missing or invalid glucose data');
        return getDefaultRecommendation(data.profile);
      }
      
      // Get glucose status (delta, etc.)
      const glucose_status = getLastGlucose(data.glucose);
      
      // Add fallback for missing glucose data
      if (!glucose_status || !glucose_status.glucose) {
        logger.warn('Missing or invalid glucose status, using default value of 120 mg/dL');
        glucose_status.glucose = 120;
        glucose_status.delta = 0;
        glucose_status.avgdelta = 0;
      }
      
      // Get the current glucose reading
      const current_glucose = data.glucose[0] || { sgv: 120 };
      const bg = current_glucose.sgv;
      
      logger.debug(`Current BG: ${bg} mg/dl`);
      
      // Make sure we have a valid profile
      let profile = data.profile;
      if (!profile) {
        logger.warn('Missing profile');
        return getDefaultRecommendation();
      }
      
      // Validate essential profile properties and use fallbacks if needed
      profile.dia = profile.dia || fallbacks.dia;
      profile.current_basal = profile.current_basal || fallbacks.current_basal;
      profile.sens = profile.sens || fallbacks.sens;
      profile.carb_ratio = profile.carb_ratio || fallbacks.carb_ratio;
      profile.min_bg = profile.min_bg || fallbacks.min_bg;
      profile.max_bg = profile.max_bg || fallbacks.max_bg;
      profile.max_iob = profile.max_iob || fallbacks.max_iob;
      profile.curve = profile.curve || fallbacks.curve;
      profile.insulinPeakTime = profile.insulinPeakTime || fallbacks.insulinPeakTime;
      profile.useCustomPeakTime = profile.useCustomPeakTime !== undefined ? 
        profile.useCustomPeakTime : fallbacks.useCustomPeakTime;
      
      // Ensure complex structures exist
      if (!profile.basalprofile || !Array.isArray(profile.basalprofile) || profile.basalprofile.length === 0) {
        logger.warn('Missing or empty basalprofile, creating default');
        profile.basalprofile = [
          {
            i: 0,
            start: "00:00:00",
            minutes: 0,
            rate: profile.current_basal
          }
        ];
      }
      
      if (!profile.isfProfile || !profile.isfProfile.sensitivities || 
          !Array.isArray(profile.isfProfile.sensitivities) || 
          profile.isfProfile.sensitivities.length === 0) {
        logger.warn('Missing or invalid isfProfile, creating default');
        profile.isfProfile = {
          first: 1,
          units: "mg/dL",
          user_preferred_units: "mg/dL",
          sensitivities: [
            {
              i: 0,
              x: 0,
              sensitivity: profile.sens,
              offset: 0,
              start: "00:00:00",
              endOffset: 1440
            }
          ]
        };
      }
      
      // Log key settings for debugging
      logger.debug('Glucose status:', {
        glucose: glucose_status.glucose,
        delta: glucose_status.delta,
        avgdelta: glucose_status.avgdelta
      });
      
      logger.debug('Profile key settings:', {
        dia: profile.dia,
        curve: profile.curve,
        insulinPeakTime: profile.insulinPeakTime,
        useCustomPeakTime: profile.useCustomPeakTime,
        current_basal: profile.current_basal,
        isf: profile.sens
      });
      
      // Current temporary basal
      const temp = data.currentTemp || {
        duration: 0,
        rate: 0,
        temp: "absolute"
      };
      
      // IOB data as an array (required format)
      const iob_data = data.iob && data.iob.length > 0 ? 
        data.iob : 
        [{ iob: 0, activity: 0, basaliob: 0, bolusiob: 0 }];
      
      // Meal data
      const meal_data = data.meal || {
        carbs: 0,
        mealCOB: 0,
        currentDeviation: 0,
        maxDeviation: 0,
        minDeviation: 0
      };
      
      // Standard autosens
      const autosens_data = data.autosens || { ratio: 1.0 };
      
      logger.debug('Determine Basal Input:', {
        bg: bg,
        iob: iob_data[0].iob,
        cob: meal_data.mealCOB,
        autosensRatio: autosens_data.ratio
      });
      
      logger.debug("Effective ISF:", {
        profileSens: profile.sens,
        firstSensitivity: profile.isfProfile.sensitivities[0].sensitivity,
        autosensRatio: autosens_data.ratio,
        effectiveISF: profile.sens * autosens_data.ratio
      });
      
      // Ensure SMB settings are properly set from preferences
      logger.debug("SMB settings:", {
        enableSMB_always: profile.enableSMB_always,
        enableSMB_with_COB: profile.enableSMB_with_COB,
        enableSMB_with_bolus: profile.enableSMB_with_bolus,
        enableSMB_after_carbs: profile.enableSMB_after_carbs,
        enableUAM: profile.enableUAM
      });

      // After getting glucose status but before calling determine_basal:
      logger.info(`BG: ${bg}, Delta: ${glucose_status.delta || 0}, Avg Delta: ${glucose_status.avgdelta || 0}`);

      // After calculating autosens but before calling determine_basal:
      logger.info(`Autosens ratio: ${autosens_data.ratio.toFixed(2)}; ${autosens_data.ratio !== 1 ? `Adjusting basal from ${profile.current_basal} to ${(profile.current_basal * autosens_data.ratio).toFixed(2)}; ISF from ${profile.sens} to ${Math.round(profile.sens / autosens_data.ratio)}` : 'Basal and ISF unchanged'}`);

      // Log current temp basal details:
      logger.info(`Current temp: duration: ${temp.duration} min, rate: ${temp.rate} U/hr`);

      // Log profile settings:
      logger.info(`Profile settings: DIA: ${profile.dia}, ISF: ${profile.sens} mg/dL/U, CR: ${profile.carb_ratio} g/U, Target: ${profile.min_bg} mg/dL`);
      
      // Call determine-basal with all required inputs
      const determineBasalResult = determine_basal(
        glucose_status,
        temp,
        iob_data,
        profile,
        autosens_data,
        meal_data,
        tempBasalFunctions,
        true // microBolusAllowed
      );
      
      // Handle case where determine_basal returns null or undefined
      if (!determineBasalResult) {
        logger.error("determine-basal returned null or undefined");
        return getDefaultRecommendation(profile);
      }
      
      // Handle mmol/L conversion for ISF if needed
      if (determineBasalResult && profile.out_units === "mmol/L") {
        // Store the original ISF value before it gets converted to a string
        determineBasalResult.ISF_mgdl = determineBasalResult.ISF ? 
          (parseFloat(determineBasalResult.ISF) * 18).toFixed(1) : null;
      }
      
      // Add missing fields when "doing nothing"
      if (determineBasalResult.rate === undefined) {
        determineBasalResult.rate = profile.current_basal; // Use current basal
      }
      
      if (determineBasalResult.duration === undefined) {
        determineBasalResult.duration = 0; // No temp basal duration
      }
      
      determineBasalResult.deliverAt = determineBasalResult.deliverAt || new Date();
      
      // Make sure eventualBG is set (this affects prediction data)
      if (determineBasalResult.eventualBG === undefined) {
        // Extract eventualBG from the reason string if possible
        const reasonStr = determineBasalResult.reason || '';
        const eventualBGMatch = reasonStr.match(/eventualBG (\d+)/);
        if (eventualBGMatch && eventualBGMatch[1]) {
          determineBasalResult.eventualBG = parseInt(eventualBGMatch[1]);
        } else {
          // Default to current BG if we can't extract it
          determineBasalResult.eventualBG = glucose_status.glucose;
        }
      }
      
      logger.info('Determine Basal Result:', {
        rate: determineBasalResult.rate + 'U/hr',
        duration: determineBasalResult.duration + 'min',
        reason: determineBasalResult.reason || 'No reason provided',
        eventualBG: determineBasalResult.eventualBG
      });
      
      // Log prediction data
      if (determineBasalResult.predBGs) {
        logger.debug("Predictions:", 
          Object.keys(determineBasalResult.predBGs).join(', ')
        );
        
        // If we have IOB predictions, log the first and last values
        if (determineBasalResult.predBGs.IOB && determineBasalResult.predBGs.IOB.length) {
          logger.debug("IOB predictions:", {
            length: determineBasalResult.predBGs.IOB.length,
            first: determineBasalResult.predBGs.IOB[0],
            last: determineBasalResult.predBGs.IOB[determineBasalResult.predBGs.IOB.length-1]
          });
        }
        
        // If we have ZT predictions, log the first and last values
        if (determineBasalResult.predBGs.ZT && determineBasalResult.predBGs.ZT.length) {
          logger.debug("ZT predictions:", {
            length: determineBasalResult.predBGs.ZT.length,
            first: determineBasalResult.predBGs.ZT[0],
            last: determineBasalResult.predBGs.ZT[determineBasalResult.predBGs.ZT.length-1]
          });
        }
      }
      
      return determineBasalResult;
    } catch (error) {
      logger.error('Error determining basal', error);
      return getDefaultRecommendation(data.profile);
    }
  }

  /**
   * Get a default recommendation when the algorithm fails
   * @param {Object} profile - Current profile or null
   * @returns {Object} - Safe default recommendation
   */
  function getDefaultRecommendation(profile = null) {
    // Hardcoded fallback values
    const fallbackBasalRate = 0.7;
    const fallbackBG = 120;
    
    // Get current basal rate from profile if available
    const current_basal = profile?.current_basal || fallbackBasalRate;
    
    // Get current BG if available
    const current_bg = profile?.min_bg || fallbackBG;
    
    // Log the usage of fallback values
    if (current_basal === fallbackBasalRate) {
      logger.warn('Using fallback basal rate of ' + fallbackBasalRate + ' U/h');
    }
    
    if (current_bg === fallbackBG) {
      logger.warn('Using fallback BG value of ' + fallbackBG + ' mg/dL');
    }
    
    logger.warn('Using default recommendation due to algorithm error');
    
    return {
      reason: "Error in determine-basal algorithm. Using safe defaults.",
      rate: current_basal,
      duration: 0,
      temp: "absolute",
      deliverAt: new Date(),
      eventualBG: current_bg
    };
  }

  /**
   * Enact a recommended temporary basal
   * @param {Object} recommendation - Basal recommendation
   * @param {Object} data - Current data
   * @param {Object} data.profile - Current profile
   * @param {Object} data.currentTemp - Current temporary basal
   * @returns {Object} - Enacted data
   */
  function enactTempBasal(recommendation, data) {
    try {
      logger.debug('Enacting temp basal:', {
        rate: recommendation.rate + 'U/hr',
        duration: recommendation.duration + 'min'
      });
      
      // Ensure recommendation has valid properties
      const safeRecommendation = {
        ...recommendation,
        rate: recommendation.rate !== undefined ? 
          recommendation.rate : data.profile.current_basal,
        duration: recommendation.duration !== undefined ? 
          recommendation.duration : 0
      };
      
      // Prepare enacted data
      const enactedData = { 
        ...safeRecommendation, 
        enacted: true, 
        timestamp: new Date().toISOString(),
        received: true
      };
      
      // Check if we need to set a temp basal
      if (safeRecommendation.duration > 0 || safeRecommendation.rate !== data.profile.current_basal) {
        // Create a new temp basal state
        const newTempBasal = {
          duration: safeRecommendation.duration,
          rate: safeRecommendation.rate,
          temp: 'absolute',
          timestamp: new Date().toISOString()
        };
        
        logger.info('Setting temp basal:', {
          rate: safeRecommendation.rate + 'U/hr',
          duration: safeRecommendation.duration + 'min'
        });
        
        return {
          enacted: enactedData,
          tempBasal: newTempBasal
        };
      } else {
        // Cancel any existing temp basal
        logger.info('Cancelling any existing temp basal');
        
        return {
          enacted: enactedData,
          tempBasal: {
            duration: 0,
            rate: 0,
            temp: 'absolute',
            timestamp: new Date().toISOString()
          }
        };
      }
    } catch (error) {
      logger.error('Error enacting temp basal', error);
      return null;
    }
  }

  /**
   * Extract microbolus (SMB) from recommendation
   * @param {Object} recommendation - Basal recommendation
   * @returns {Object|null} - Microbolus data if present
   */
  function extractSMB(recommendation) {
    if (!recommendation || !recommendation.reason) {
      return null;
    }
    
    // Extract the microbolus amount from the reason string
    const microbolusMatch = recommendation.reason.match(/Microbolusing (\d+\.?\d*)U/);
    if (microbolusMatch && microbolusMatch[1]) {
      const microbolusAmount = parseFloat(microbolusMatch[1]);
      
      logger.info('Extracted SMB from recommendation:', {
        amount: microbolusAmount + 'U'
      });
      
      return {
        amount: microbolusAmount,
        timestamp: new Date().toISOString()
      };
    }
    
    return null;
  }

  return {
    determineBasal,
    getDefaultRecommendation,
    enactTempBasal,
    extractSMB
  };
}

module.exports = { createBasalCalculations };