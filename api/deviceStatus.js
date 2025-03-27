// api/deviceStatus.js
const logger = require('../utils/logger');

/**
 * Creates functions for handling device status
 * @param {Object} nightscoutClient - Nightscout client
 * @returns {Object} - Functions for device status operations
 */
function createDeviceStatusAPI(nightscoutClient) {
  /**
   * Upload device status to Nightscout
   * @param {Array} deviceStatuses - Device statuses to upload
   * @returns {Promise<Object>} - Response from Nightscout
   */
  async function uploadDeviceStatus(deviceStatuses) {
    try {
      logger.debug(`Uploading ${deviceStatuses.length} device statuses to Nightscout`);
      
      // Log detailed information about each deviceStatus
      deviceStatuses.forEach((status, index) => {
        logger.debug(`Device Status ${index + 1}:`, {
          totalIOB: status.openaps?.iob?.iob,
          basalIOB: status.openaps?.iob?.basaliob,
          bolusIOB: status.openaps?.iob?.bolusiob,
          pumpBasalIOB: status.openaps?.iob?.pumpBasalIOB,
          time: status.openaps?.iob?.time
        });
      });
  
      return await nightscoutClient.uploadDeviceStatus(deviceStatuses);
    } catch (error) {
      logger.error(`Error uploading device status to Nightscout: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a device status object for uploading
   * @param {Object} data - Current loop data
   * @param {Object} recommendations - Loop recommendations
   * @param {Object} preferences - User preferences
   * @returns {Object} - Formatted device status
   */
  function createDeviceStatus(data, recommendations, preferences) {
    // Fallback values
    const fallbacks = {
      current_basal: 0.7,
      sens: 36,
      carb_ratio: 10,
      min_bg: 100,
      max_iob: 3,
      curve: 'ultra-rapid'
    };
    
    const now = new Date();
    const mills = now.getTime();
    const timeString = now.toISOString();
    
    // Use iobData with fallbacks if needed
    const iobData = data.iob[0] || {
      iob: 0,
      activity: 0,
      basaliob: 0,
      bolusiob: 0,
      time: timeString,
      timestamp: timeString,
      mills: mills
    };
    
    // Get most recent glucose reading with fallback
    const currentBG = data.glucose && data.glucose.length > 0 
      ? data.glucose[0].sgv 
      : 120;
    
    // Track fallback usage 
    let fallbacksUsed = [];
    
    // Get current basal rate with fallback
    const current_basal = data.profile?.current_basal || fallbacks.current_basal;
    if (current_basal === fallbacks.current_basal) {
      fallbacksUsed.push('current_basal');
    }
    
    // Create a complete iob object with no undefined values
    const completeIobObj = {
      iob: iobData.iob || 0,
      activity: iobData.activity || 0,
      basaliob: iobData.basaliob || 0,
      bolusiob: iobData.bolusiob || 0,
      netbasalinsulin: iobData.netbasalinsulin || 0,
      bolusinsulin: iobData.bolusinsulin || 0,
      pumpBasalIOB: iobData.pumpBasalIOB || iobData.basaliob || 0,
      time: iobData.time || timeString,
      iobWithZeroTemp: {
        iob: iobData.iobWithZeroTemp?.iob || iobData.iob || 0,
        activity: iobData.iobWithZeroTemp?.activity || iobData.activity || 0,
        basaliob: iobData.iobWithZeroTemp?.basaliob || iobData.basaliob || 0,
        bolusiob: iobData.iobWithZeroTemp?.bolusiob || iobData.bolusiob || 0,
        netbasalinsulin: iobData.iobWithZeroTemp?.netbasalinsulin || iobData.netbasalinsulin || 0,
        bolusinsulin: iobData.iobWithZeroTemp?.bolusinsulin || iobData.bolusinsulin || 0,
        time: iobData.iobWithZeroTemp?.time || iobData.time || timeString
      },
      lastBolusTime: iobData.lastBolusTime || 0,
      lastTemp: iobData.lastTemp || {
        rate: current_basal,
        timestamp: timeString,
        started_at: timeString,
        date: mills,
        duration: 0
      },
      timestamp: iobData.timestamp || timeString,
      mills: iobData.mills || mills
    };
    
    // Use the predBGs directly from determine_basal
    const predBGs = recommendations.predBGs || {};
    
    // Calculate glucose trend indicators
    let tick = "+0";
    if (data.glucose && data.glucose.length >= 2) {
      const currentBG = data.glucose[0].sgv;
      const prevBG = data.glucose[1].sgv;
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
    
    // Get current COB
    const COB = Math.round(data.meal?.mealCOB || 0);
    
    // Get ISF with fallback
    const isf = data.profile?.sens || fallbacks.sens;
    if (isf === fallbacks.sens) {
      fallbacksUsed.push('sens');
    }
    
    // Get carb ratio with fallback
    const carb_ratio = data.profile?.carb_ratio || fallbacks.carb_ratio;
    if (carb_ratio === fallbacks.carb_ratio) {
      fallbacksUsed.push('carb_ratio');
    }
    
    // Get target BG with fallback
    const target_bg = data.profile?.min_bg || fallbacks.min_bg;
    if (target_bg === fallbacks.min_bg) {
      fallbacksUsed.push('min_bg');
    }
    
    // Log fallback usage if any
    if (fallbacksUsed.length > 0) {
      logger.warn(`Using fallback values in createDeviceStatus for: ${fallbacksUsed.join(', ')}`);
    }
    
    // Build the complete device status object
    const deviceStatus = {
      device: "openaps://cgmsimoref0-node",
      openaps: {
        iob: completeIobObj,
        suggested: {
          temp: "absolute",
          bg: currentBG,
          tick: tick,
          eventualBG: recommendations.eventualBG || currentBG,
          insulinReq: recommendations.insulinReq || 0,
          reservoir: "180.4",
          deliverAt: recommendations.deliverAt || timeString,
          sensitivityRatio: recommendations.sensitivityRatio || 1.0,
          predBGs: predBGs,
          COB: COB,
          IOB: completeIobObj.iob || 0,
          BGI: recommendations.BGI || 0,
          deviation: recommendations.deviation || 0,
          ISF: recommendations.ISF || isf,
          CR: recommendations.CR || carb_ratio,
          target_bg: recommendations.target_bg || target_bg,
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
          predBGs: predBGs,
          COB: COB,
          IOB: completeIobObj.iob || 0
        },
        version: "0.7.1"
      },
      pump: {
        clock: timeString,
        battery: {
          voltage: 1.39,
          status: "normal"
        },
        reservoir: 180.4,
        status: {
          status: "normal",
          bolusing: false,
          suspended: false,
          timestamp: timeString
        }
      },
      preferences: {
        // Use the preferences values if available, otherwise use safe defaults
        max_iob: preferences?.max_iob ?? fallbacks.max_iob,
        max_daily_safety_multiplier: preferences?.max_daily_safety_multiplier ?? 3,
        current_basal_safety_multiplier: preferences?.current_basal_safety_multiplier ?? 4,
        autosens_max: preferences?.autosens_max ?? 1.2,
        autosens_min: preferences?.autosens_min ?? 0.7,
        rewind_resets_autosens: true,
        exercise_mode: preferences?.exercise_mode ?? false,
        sensitivity_raises_target: preferences?.sensitivity_raises_target ?? false,
        resistance_lowers_target: preferences?.resistance_lowers_target ?? false,
        unsuspend_if_no_temp: false,
        enableSMB_always: preferences?.enableSMB_always ?? false,
        enableSMB_with_COB: preferences?.enableSMB_with_COB ?? false,
        enableSMB_with_temptarget: preferences?.enableSMB_with_temptarget ?? false,
        enableSMB_after_carbs: preferences?.enableSMB_after_carbs ?? false,
        enableUAM: preferences?.enableUAM ?? false,
        curve: preferences?.curve ?? fallbacks.curve,
        offline_hotspot: false,
        cgm: "g5-upload",
        timestamp: timeString,
        // Add indicator if we used any fallbacks
        fallbacks_used: fallbacksUsed.length > 0 ? fallbacksUsed : undefined
      },
      uploader: {
        batteryVoltage: 3861,
        battery: 68
      },
      utcOffset: 0,
      mills: mills,
      created_at: timeString
    };
    
    return deviceStatus;
  }

  return {
    uploadDeviceStatus,
    createDeviceStatus
  };
}

module.exports = { createDeviceStatusAPI };