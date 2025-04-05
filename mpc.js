// app.js (updated with upload functionality)
const { loadConfig } = require('./utils/config');
const logger = require('./utils/logger');
const { createNightscoutClient } = require('./api/nightscout');
const { createDataTransforms } = require('./transforms/data');
const { createProfileTransforms } = require('./transforms/profile');
const { createInsulinCalculations } = require('./algorithms/insulin');
const { createMealCalculations } = require('./algorithms/meal');
const { createBasalCalculations } = require('./algorithms/basal');
const { createSensitivityCalculations } = require('./algorithms/sensitivity');
const { createDeviceStatusAPI } = require('./api/deviceStatus');
const { createTreatmentsAPI } = require('./api/treatments');

async function main() {
  try {
    logger.info('Starting cgmsimoref0-node...');
    
    // Load configuration
    const config = await loadConfig();
    logger.info('Configuration loaded');
    
    // Create Nightscout client
    const nightscoutClient = createNightscoutClient(config.nightscout);
    
    // Create data transforms
    const dataTransforms = createDataTransforms();
    
    // Create profile transforms
    const profileTransforms = createProfileTransforms();
    
    // Create algorithm modules
    const insulinCalculations = createInsulinCalculations();
    const mealCalculations = createMealCalculations();
    const basalCalculations = createBasalCalculations();
    const sensitivityCalculations = createSensitivityCalculations();
    
    // Create API modules for uploading
    const deviceStatusAPI = createDeviceStatusAPI(nightscoutClient);
    const treatmentsAPI = createTreatmentsAPI(nightscoutClient);
    
    // Fetch and process CGM data
    logger.info('Fetching CGM data...');
    const rawEntries = await nightscoutClient.getEntries();
    const formattedCGMData = dataTransforms.formatCGMData(rawEntries);
    logger.info(`Processed ${formattedCGMData.length} CGM readings`);
    
    // Log the latest glucose value
    if (formattedCGMData.length > 0) {
      const latest = formattedCGMData[0];
      logger.info(`Latest glucose: ${latest.sgv} mg/dL (${latest.direction})`);
    }
    
    // Fetch and process treatments data
    logger.info('Fetching treatment data...');
    const rawTreatments = await nightscoutClient.getTreatments();
    const { pumpHistory, carbHistory } = dataTransforms.formatPumpHistory(rawTreatments);
    logger.info(`Processed ${pumpHistory.length} pump history records and ${carbHistory.length} carb entries`);
    
    // Fetch and process profile data
    logger.info('Fetching profile data...');
    const rawProfile = await nightscoutClient.getProfile();
    
    // Create default values to use as fallbacks
    const defaultValues = {
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
    
    // Transform the profile
    const openAPSProfile = profileTransforms.transformProfile(rawProfile, defaultValues);
    
    // Add preferences to profile
    const profileWithPrefs = profileTransforms.addPreferencesToProfile(openAPSProfile, config.preferences);
    
    logger.info('Profile transformation complete');
    
    // Calculate autosens
    logger.info('Calculating autosensitivity...');
    const autosensData = sensitivityCalculations.calculateAutosens({
      glucose: formattedCGMData,
      pumpHistory: pumpHistory,
      profile: profileWithPrefs,
      carbHistory: carbHistory
    });
    
    // Log autosens results
    logger.info('Autosens result:', {
      ratio: autosensData.ratio.toFixed(2),
      newISF: autosensData.newisf ? autosensData.newisf.toFixed(1) : 'unchanged'
    });
    
    // Calculate IOB
    logger.info('Calculating Insulin on Board (IOB)...');
    const iobData = insulinCalculations.calculateIOB({
      pumpHistory: pumpHistory,
      profile: profileWithPrefs,
      autosens: autosensData
    });
    
    // Log IOB information
    if (iobData && iobData.length > 0) {
      logger.info('Current IOB:', {
        total: iobData[0].iob.toFixed(2) + 'U',
        basal: iobData[0].basaliob.toFixed(2) + 'U',
        bolus: iobData[0].bolusiob.toFixed(2) + 'U'
      });
    } else {
      logger.warn('No IOB data available');
    }
    
    // Calculate meal data (COB)
    logger.info('Calculating Carbs on Board (COB)...');
    const mealData = mealCalculations.calculateMeal({
      pumpHistory: pumpHistory,
      profile: profileWithPrefs,
      glucose: formattedCGMData,
      basalProfile: profileWithPrefs.basalprofile,
      carbHistory: carbHistory
    });
    
    // Log COB information
    logger.info('Current COB:', {
      total: mealData.mealCOB.toFixed(0) + 'g',
      carbs: mealData.carbs + 'g'
    });
    
    // Define current temporary basal state
    // In a full implementation, this would be maintained between loop iterations
    // For now, we'll check the most recent temp basal in pump history
    const currentTemp = findCurrentTempBasal(pumpHistory) || {
      duration: 0,
      rate: 0,
      temp: "absolute"
    };
    
    // Calculate basal recommendation
    logger.info('Calculating basal recommendation...');
    const basalRecommendation = basalCalculations.determineBasal({
      glucose: formattedCGMData,
      currentTemp: currentTemp,
      iob: iobData,
      profile: profileWithPrefs,
      autosens: autosensData,
      meal: mealData
    });
    
    // Log basal recommendation
    logger.info('Basal recommendation:', {
      rate: basalRecommendation.rate + 'U/hr',
      duration: basalRecommendation.duration + 'min',
      reason: basalRecommendation.reason
    });
    
    // Log detailed prediction arrays in a format similar to real OpenAPS
    if (basalRecommendation.predBGs) {
      // Log UAM predictions (unannounced meals)
      if (basalRecommendation.predBGs.UAM) {
        logger.info(`UAM: [${basalRecommendation.predBGs.UAM.join(',')}]`);
      }
      
      // Log IOB predictions (insulin only)
      if (basalRecommendation.predBGs.IOB) {
        logger.info(`IOB: [${basalRecommendation.predBGs.IOB.join(',')}]`);
      }
      
      // Log Zero Temp predictions
      if (basalRecommendation.predBGs.ZT) {
        logger.info(`ZT:  [${basalRecommendation.predBGs.ZT.join(',')}]`);
      }
      
      // Additional algorithm data from the recommendation
      const currentBG = formattedCGMData[0]?.sgv || 0;
      const delta = formattedCGMData[0]?.sgv - formattedCGMData[1]?.sgv || 0;
      const tick = delta >= 0 ? `+${delta}` : delta.toString();
      const isf = basalRecommendation.ISF || profileWithPrefs.sens;
      const cr = basalRecommendation.CR || profileWithPrefs.carb_ratio;
      
      // Log the algorithm's decision in a similar format to real OpenAPS
      logger.info(`"${basalRecommendation.reason}"`);
      
      // Log algorithm data similar to OpenAPS
      logger.info(`BG: ${currentBG}, Tick: ${tick}, IOB: ${iobData[0]?.iob.toFixed(3) || 0}, COB: ${mealData.mealCOB}, ISF: ${isf}, CR: ${cr.toFixed(2)}`);
      
      // Log minimum predicted values
      if (basalRecommendation.minPredBG) {
        logger.info(`minPredBG: ${basalRecommendation.minPredBG}, minIOBPredBG: ${basalRecommendation.minIOBPredBG || 'n/a'}, minZTGuardBG: ${basalRecommendation.minZTGuardBG || 'n/a'}, minUAMPredBG: ${basalRecommendation.minUAMPredBG || 'n/a'}, avgPredBG: ${basalRecommendation.avgPredBG || 'n/a'}`);
      }
      
      // Log eventualBG and related calculations
      if (basalRecommendation.eventualBG) {
        logger.info(`Eventual BG: ${basalRecommendation.eventualBG}, insulinReq: ${basalRecommendation.insulinReq || 0}`);
      }
    }
    
    // Extract SMB if present
    const smb = basalCalculations.extractSMB(basalRecommendation);
    if (smb) {
      logger.info('SMB recommendation:', {
        amount: smb.amount + 'U'
      });
    }
    
    // Enact basal recommendation
    logger.info('Enacting basal recommendation...');
    const enactedData = basalCalculations.enactTempBasal(basalRecommendation, {
      profile: profileWithPrefs,
      currentTemp: currentTemp
    });
    
    // Log the enacted temp
    logger.info(`Temp: ${enactedData?.tempBasal?.rate || currentTemp.rate} U/hr, Duration: ${enactedData?.tempBasal?.duration || currentTemp.duration} min`);
    
    // Create the treatments to upload
    const treatmentsToUpload = [];
    
    // Add SMB bolus if present
    if (smb && smb.amount > 0) {
      logger.info(`Uploading SMB bolus: ${smb.amount}U`);
      const bolusTreatment = treatmentsAPI.createBolusTreatment(smb.amount, 'SMB from OpenAPS algorithm');
      treatmentsToUpload.push(bolusTreatment);
    }
    
    // Add temp basal if enacted
    if (enactedData && enactedData.tempBasal) {
      logger.info(`Uploading temp basal: ${enactedData.tempBasal.rate}U/hr for ${enactedData.tempBasal.duration} min`);
      const tempBasalTreatment = treatmentsAPI.createTempBasalTreatment(
        enactedData.tempBasal.rate,
        enactedData.tempBasal.duration
      );
      treatmentsToUpload.push(tempBasalTreatment);
    }
    
    // Upload treatments if any
    if (treatmentsToUpload.length > 0) {
      try {
        //logger.info(`Uploading ${treatmentsToUpload.length} treatments to Nightscout`);
        await treatmentsAPI.uploadTreatments(treatmentsToUpload);
        logger.info('Treatments uploaded successfully');
      } catch (error) {
        logger.error(`Failed to upload treatments: ${error.message}`);
      }
    } else {
      logger.info('No treatments to upload');
    }
    
    // Create and upload device status
    try {
        logger.info('Preparing device status for upload');
        
        // Create device status with directly accessible profile values
        const deviceStatus = deviceStatusAPI.createDeviceStatus(
        {
            glucose: formattedCGMData,
            iob: iobData,
            meal: mealData,
            // Add profile values directly at the top level
            current_basal: profileWithPrefs.current_basal,
            sens: profileWithPrefs.sens,
            carb_ratio: profileWithPrefs.carb_ratio,
            min_bg: profileWithPrefs.min_bg,
            // Also keep the full profile for other properties
            profile: profileWithPrefs,
            autosens: autosensData
        },
        basalRecommendation,
        config.preferences
        );
        
        logger.info('Uploading device status to Nightscout');
        await deviceStatusAPI.uploadDeviceStatus([deviceStatus]);
        logger.info('Device status uploaded successfully');
    } catch (error) {
        logger.error(`Failed to upload device status: ${error.message}`);
    }
    
    logger.info('Loop iteration completed successfully');
    
    // Log critical profile settings with autosens adjustments
    logger.info('Critical profile settings (as used in calculations):');
    logger.info(`- DIA: ${profileWithPrefs.dia}`);

    // Show both original and autosens-adjusted ISF
    const autosensRatio = autosensData?.ratio || 1.0;
    const adjustedISF = Math.round(profileWithPrefs.sens / autosensRatio);
    logger.info(`- ISF: ${adjustedISF} mg/dL/U (original: ${profileWithPrefs.sens} mg/dL/U with autosens: ${autosensRatio.toFixed(2)})`);

    // Show carb ratio
    logger.info(`- Carb Ratio: ${profileWithPrefs.carb_ratio} g/U`);

    // Show both original and autosens-adjusted basal
    const adjustedBasal = (profileWithPrefs.current_basal * autosensRatio).toFixed(2);
    logger.info(`- Basal Rate: ${adjustedBasal} U/hr (original: ${profileWithPrefs.current_basal} U/hr)`);

    // Show target range
    logger.info(`- Target Range: ${profileWithPrefs.min_bg}-${profileWithPrefs.max_bg} mg/dL`);
    
    return {
      glucose: formattedCGMData,
      pumpHistory,
      carbHistory,
      profile: profileWithPrefs,
      autosens: autosensData,
      iob: iobData,
      meal: mealData,
      recommended: basalRecommendation,
      enacted: enactedData?.enacted || null,
      tempBasal: enactedData?.tempBasal || currentTemp,
      smb: smb,
      treatmentsUploaded: treatmentsToUpload.length,
      deviceStatusUploaded: true
    };
  } catch (error) {
    logger.error(`Error in main function: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

/**
 * Find the current temporary basal from pump history
 * @param {Array} pumpHistory - Pump history records
 * @returns {Object|null} - Current temp basal or null if none found
 */
function findCurrentTempBasal(pumpHistory) {
  try {
    if (!pumpHistory || !Array.isArray(pumpHistory) || pumpHistory.length === 0) {
      return null;
    }
    
    // Filter out temp basal entries
    const tempBasalEntries = pumpHistory.filter(entry => 
      entry._type === 'TempBasal'
    );
    
    if (tempBasalEntries.length === 0) {
      return null;
    }
    
    // Sort by date descending (most recent first)
    tempBasalEntries.sort((a, b) => {
      const dateA = a.date || new Date(a.timestamp).getTime();
      const dateB = b.date || new Date(b.timestamp).getTime();
      return dateB - dateA;
    });
    
    const latestTempBasal = tempBasalEntries[0];
    
    // Find corresponding duration entry exactly matching timestamp
    const durationEntry = pumpHistory.find(entry => 
      entry._type === 'TempBasalDuration' && 
      entry.timestamp === latestTempBasal.timestamp
    );
    
    if (!durationEntry) {
      return null;
    }
    
    const now = new Date();
    const startTime = latestTempBasal.date || new Date(latestTempBasal.timestamp).getTime();
    const durationMinutes = durationEntry['duration (min)'] || durationEntry.duration || 0;
    const endTime = startTime + (durationMinutes * 60 * 1000);
    
    // Check if the temp basal is still active
    if (now.getTime() < endTime) {
      const remainingDuration = Math.round((endTime - now.getTime()) / (60 * 1000));
      
      return {
        duration: remainingDuration,
        rate: latestTempBasal.rate,
        temp: 'absolute'
      };
    }
    
    return null;
  } catch (error) {
    logger.error(`Error finding current temp basal: ${error.message}`);
    return null;
  }
}

// Run the main function only if this file is executed directly
if (require.main === module) {
  main().then(data => {
    logger.info('Application completed successfully');
  }).catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  });
}

// Run the main function only if this file is executed directly
if (require.main === module) {
  main().then(data => {
    logger.info('Application completed successfully');
  }).catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  });
}

// Export the main function for use in app.js
module.exports = main;