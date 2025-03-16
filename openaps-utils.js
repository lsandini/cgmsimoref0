// openaps-utils.js
const axios = require('axios');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');

// Direct requires from oref0 library
const iobFromHistory = require('./node_modules/oref0/lib/iob/history');
const determineBasal = require('./node_modules/oref0/lib/determine-basal/determine-basal');
const basalProfile = require('./node_modules/oref0/lib/profile/basal');
const getLastGlucose = require('./node_modules/oref0/lib/glucose-get-last');
const tempBasalFunctions = require('./node_modules/oref0/lib/basal-set-temp');
const processBolus = require('./node_modules/oref0/lib/bolus');
const processTemps = require('./node_modules/oref0/lib/temps');
const round_basal = require('./node_modules/oref0/lib/round-basal');

// Fetch data from Nightscout
async function fetchNightscoutData(nightscoutUrl) {
  try {
    console.log(`Fetching data from ${nightscoutUrl}...`);
    // Fetch data in parallel
    const [entriesResponse, profileResponse, treatmentsResponse] = await Promise.all([
      axios.get(`${nightscoutUrl}/api/v1/entries.json?count=48`),
      axios.get(`${nightscoutUrl}/api/v1/profile.json`),
      axios.get(`${nightscoutUrl}/api/v1/treatments.json?count=100`)
    ]);
    
    console.log(`Fetched ${entriesResponse.data.length} glucose entries`);
    console.log(`Fetched ${treatmentsResponse.data.length} treatments`);
    
    return {
      entries: entriesResponse.data,
      profile: profileResponse.data[0],
      treatments: treatmentsResponse.data
    };
  } catch (error) {
    console.error('Error fetching data from Nightscout:', error);
    throw error;
  }
}

// Improved formatGlucoseStatus function to properly calculate deltas
function formatGlucoseStatus(glucose) {
    if (!glucose || !glucose.glucose) {
      return {
        glucose: 0,
        delta: 0,
        avgDelta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: new Date().getTime(), // Add current timestamp
        device: "fakecgm"
      };
    }
    
    return {
      glucose: glucose.glucose,
      delta: glucose.delta || 0,
      avgDelta: glucose.avgDelta || glucose.delta || 0,
      short_avgdelta: glucose.short_avgdelta || glucose.avgDelta || glucose.delta || 0,
      long_avgdelta: glucose.long_avgdelta || glucose.avgDelta || glucose.delta || 0,
      date: glucose.date || new Date().getTime(), // Ensure date is present
      device: "fakecgm"
    };
  }

  // Function to calculate deltas from glucose data
function calculateGlucoseDeltas(glucoseData) {
    // Sort by date descending (newest first)
    glucoseData.sort((a, b) => b.date - a.date);
    
    if (glucoseData.length < 2) {
      return {
        glucose: glucoseData[0]?.glucose || 0,
        date: glucoseData[0]?.date || new Date().getTime(),
        delta: 0,
        avgDelta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0
      };
    }
    
    // Calculate delta (change from previous reading)
    const delta = glucoseData[0].glucose - glucoseData[1].glucose;
    
    // Calculate short average delta (last ~15 mins, or 3 readings)
    let short_sum = 0;
    let short_count = Math.min(3, glucoseData.length - 1);
    for (let i = 0; i < short_count; i++) {
      short_sum += glucoseData[i].glucose - glucoseData[i + 1].glucose;
    }
    const short_avgdelta = short_sum / short_count;
    
    // Calculate long average delta (last ~45 mins, or 9 readings)
    let long_sum = 0;
    let long_count = Math.min(9, glucoseData.length - 1);
    for (let i = 0; i < long_count; i++) {
      long_sum += glucoseData[i].glucose - glucoseData[i + 1].glucose;
    }
    const long_avgdelta = long_sum / long_count;
    
    return {
      glucose: glucoseData[0].glucose,
      date: glucoseData[0].date,
      delta: delta,
      avgDelta: delta,  // For compatibility
      short_avgdelta: short_avgdelta,
      long_avgdelta: long_avgdelta,
      noise: 0  // Default noise to 0
    };
  }
  
  // Update the getLastGlucose wrapper to ensure all fields are present
  function getLastGlucoseWithDeltas(glucoseData) {
    // First try using the oref0 function
    let glucose = getLastGlucose(glucoseData);
    
    // If missing critical delta fields, calculate them ourselves
    if (glucose && (!glucose.delta || !glucose.short_avgdelta || !glucose.long_avgdelta)) {
      console.log("Recalculating missing glucose delta values");
      const calculatedDeltas = calculateGlucoseDeltas(glucoseData);
      
      // Merge the calculated deltas with the existing glucose data
      glucose = {
        ...glucose,
        delta: glucose.delta || calculatedDeltas.delta,
        avgDelta: glucose.avgDelta || calculatedDeltas.avgDelta,
        short_avgdelta: glucose.short_avgdelta || calculatedDeltas.short_avgdelta,
        long_avgdelta: glucose.long_avgdelta || calculatedDeltas.long_avgdelta
      };
    }
    
    return formatGlucoseStatus(glucose);
  }

// Create a simple meal object based on carb treatments
function calculateMeal(processedData) {
  try {
    // For simplicity, return a basic meal object
    return {
      carbs: 0,
      nsCarbs: 0,
      bwCarbs: 0,
      journalCarbs: 0,
      mealCOB: 0,
      currentDeviation: 0,
      maxDeviation: 0,
      minDeviation: 0
    };
  } catch (error) {
    console.error('Error calculating meal data:', error);
    return {
      carbs: 0,
      nsCarbs: 0,
      bwCarbs: 0,
      journalCarbs: 0,
      mealCOB: 0,
      currentDeviation: 0,
      maxDeviation: 0,
      minDeviation: 0
    };
  }
}

// Process data for oref0
function processForOref0(nightscoutData, preferences) {
    try {
      const { entries, profile, treatments } = nightscoutData;
      console.log("Processing data for oref0...");
      
      // Format CGM data for oref0
      let glucoseData = [];
      entries.forEach(entry => {
        glucoseData.push({
          glucose: entry.sgv,
          dateString: new Date(entry.date).toISOString(),
          date: entry.date,
          // Include type and direction if available
          type: entry.type || 'sgv',
          direction: entry.direction || 'NONE'
        });
      });
      glucoseData.sort((a, b) => b.date - a.date); // Sort descending by date
      console.log(`Processed ${glucoseData.length} glucose entries`);
      
      // Get the most recent glucose reading and glucose status with properly calculated deltas
      const glucose = getLastGlucoseWithDeltas(glucoseData);
      
      // Process treatments using the original OpenAPS modules
      const bolusProcessed = processBolus(treatments);
      
      // Get currently active temp basal if any
      const now = new Date();
      let currentTemp = { duration: 0, temp: 'absolute', rate: 0 };
      const currentTempBasal = treatments.find(t => 
        t.eventType === 'Temp Basal' && 
        moment(now).diff(moment(t.created_at), 'minutes') < t.duration
      );
      
      if (currentTempBasal) {
        currentTemp = {
          duration: currentTempBasal.duration,
          temp: 'absolute',
          rate: parseFloat(currentTempBasal.rate)
        };
        console.log("Current temporary basal found:", currentTemp);
      }
      
      // Process profile data
      try {
        console.log("Processing profile data...");
        console.log("Profile has store:", profile.store ? "yes" : "no");
        console.log("Default profile:", profile.defaultProfile);
        
        const schedules = profile.store[profile.defaultProfile];
        
        // Convert basal profile to the format expected by oref0
        const basalSchedule = schedules.basal.map((item, index) => {
          return {
            minutes: item.timeAsSeconds / 60,
            rate: parseFloat(item.value),
            start: item.time + ":00",
            i: index
          };
        });
        
        // Sort basalSchedule by minutes
        basalSchedule.sort((a, b) => a.minutes - b.minutes);
        
        // Calculate max daily basal - maximum basal rate in the profile
        const maxDailyBasal = Math.max(...basalSchedule.map(item => item.rate));
        
        // Get the current basal rate
        const current_basal = basalProfile.basalLookup(basalSchedule, now);
        
        // Build a complete profile object as expected by determine-basal
        const processedProfile = {
          // Basic profile settings
          dia: schedules.dia,
          current_basal: parseFloat(current_basal), 
          max_daily_basal: maxDailyBasal,
          max_basal: preferences.max_daily_safety_multiplier * maxDailyBasal,
          min_bg: schedules.target_low[0].value,
          max_bg: schedules.target_high[0].value,
          target_bg: Math.round((schedules.target_low[0].value + schedules.target_high[0].value) / 2),
          
          // ISF and carb ratio
          sens: schedules.sens[0].value,
          carb_ratio: schedules.carbratio[0].value,
          
          // Basal profile
          basalprofile: basalSchedule,
          
          // Model - add this to help round_basal function
          model: "522",
          
          // Units and preferences
          out_units: "mg/dL",
          
          // OpenAPS settings
          max_iob: preferences.max_iob || 3,
          max_daily_safety_multiplier: preferences.max_daily_safety_multiplier || 3,
          current_basal_safety_multiplier: preferences.current_basal_safety_multiplier || 4,
          autosens_max: preferences.autosens_max || 1.2,
          autosens_min: preferences.autosens_min || 0.7,
          
          // SMB settings
          enableUAM: preferences.enableUAM || false,
          enableSMB_with_COB: preferences.enableSMB_with_COB || false,
          enableSMB_with_temptarget: preferences.enableSMB_with_temptarget || false,
          enableSMB_always: preferences.enableSMB_always || false,
          maxSMBBasalMinutes: 30,
          
          // Carb settings
          min_5m_carbimpact: 8,
          maxCOB: 120,
          
          // Additional settings for oref0
          curve: preferences.curve || 'rapid-acting',
          useCustomPeakTime: preferences.useCustomPeakTime || false
        };
        
        console.log("Profile processed:", processedProfile);
        
        // Format treatments into pump history exactly as in pumphistory.json
        const formattedPumpHistory = [];
        
        // Process boluses
        bolusProcessed
          .filter(t => t.eventType === 'Meal Bolus' || t.eventType === 'Correction Bolus' && t.insulin)
          .forEach(t => {
            formattedPumpHistory.push({
              _type: "Bolus",
              amount: parseFloat(t.insulin),
              timestamp: t.timestamp || t.created_at,
              duration: 0 // Boluses are instantaneous
            });
          });
        
        // Process temp basals - create paired entries as expected
        treatments
          .filter(t => t.eventType === 'Temp Basal')
          .forEach(t => {
            // Add TempBasal entry
            formattedPumpHistory.push({
              _type: "TempBasal",
              rate: parseFloat(t.rate),
              timestamp: t.created_at,
              temp: 'absolute'
            });
            
            // Add matching TempBasalDuration entry with same timestamp
            formattedPumpHistory.push({
              _type: "TempBasalDuration",
              'duration (min)': parseInt(t.duration),
              timestamp: t.created_at
            });
          });
        
        // Process the pump history with the temps processor
        const tempsProcessed = processTemps(formattedPumpHistory);
        
        console.log(`Formatted ${formattedPumpHistory.length} records for pump history`);
        
        // Format carb treatments for meal data
        const carbTreatments = bolusProcessed
          .filter(t => t.carbs && t.carbs > 0)
          .map(t => {
            return {
              _type: "Meal Bolus",
              carbs: parseFloat(t.carbs),
              timestamp: t.timestamp || t.created_at
            };
          });
        
        console.log(`Formatted ${carbTreatments.length} carb treatments`);
        
        // Create simple autosens data as in autosens.json
        const autosensData = { ratio: 1.0 };
        
        // Format iob.json structure (will be calculated by calculateIOB)
        const clock = now.toISOString();
        
        // Get the formatted glucose status with all required fields
        const glucoseStatus = formatGlucoseStatus(glucose);
        
        return {
          glucose: glucose,
          profile: processedProfile,
          pumpHistory: formattedPumpHistory,
          basalProfile: basalSchedule,
          carbHistory: carbTreatments,
          currentTemp: currentTemp,
          autosens: autosensData,
          glucoseStatus: glucoseStatus,
          clock: clock,
          tempsProcessed: tempsProcessed
        };
      } catch (e) {
        console.error("Error processing profile:", e);
        throw e;
      }
    } catch (error) {
      console.error('Error processing data for oref0:', error);
      throw error;
    }
  }

// Modified calculateIOB function
function calculateIOB(processedData) {
    try {
      // Prepare inputs for IOB calculation
      const iobInputs = {
        history: processedData.pumpHistory,
        profile: processedData.profile,
        clock: processedData.clock
      };
      
      // Calculate IOB - get the full array of predictions
      let iobResults = iobFromHistory(iobInputs);
      
      // Also calculate IOB with a zero temp for 240 minutes (4 hours)
      const zeroTempDuration = 240; // 4 hours
      let iobWithZeroTemp = iobFromHistory(iobInputs, zeroTempDuration);
      
      // Ensure we have valid arrays
      if (!Array.isArray(iobResults) || iobResults.length === 0) {
        console.error("Invalid IOB results, creating default array");
        iobResults = [{ 
          iob: 0, 
          activity: 0,
          time: new Date() 
        }];
      }
      
      if (!Array.isArray(iobWithZeroTemp) || iobWithZeroTemp.length === 0) {
        console.error("Invalid IOB with zero temp results, creating default array");
        iobWithZeroTemp = [{ 
          iob: 0, 
          activity: 0,
          time: new Date() 
        }];
      }
      
      // Fix any missing properties in the IOB data
      for (let i = 0; i < iobResults.length; i++) {
        // If the iobResults contains insulin but not iob, convert it
        if (iobResults[i].insulin !== undefined && iobResults[i].iob === undefined) {
          iobResults[i].iob = iobResults[i].insulin;
        }
        
        // Ensure activity is present
        if (iobResults[i].activity === undefined) {
          iobResults[i].activity = 0;
        }
        
        // Add time property if missing
        if (!iobResults[i].time && iobResults[i].date) {
          iobResults[i].time = new Date(iobResults[i].date);
        } else if (!iobResults[i].time) {
          iobResults[i].time = new Date();
        }
        
        // Add the zero temp IOB data if available
        if (i < iobWithZeroTemp.length) {
          iobResults[i].iobWithZeroTemp = iobWithZeroTemp[i];
        }
        
        // Fix the iobWithZeroTemp structure
        if (iobResults[i].iobWithZeroTemp) {
          if (iobResults[i].iobWithZeroTemp.insulin !== undefined && 
              iobResults[i].iobWithZeroTemp.iob === undefined) {
            iobResults[i].iobWithZeroTemp.iob = iobResults[i].iobWithZeroTemp.insulin;
          }
          
          if (iobResults[i].iobWithZeroTemp.activity === undefined) {
            iobResults[i].iobWithZeroTemp.activity = 0;
          }
          
          // Ensure iobWithZeroTemp has time property
          if (!iobResults[i].iobWithZeroTemp.time) {
            if (iobResults[i].iobWithZeroTemp.date) {
              iobResults[i].iobWithZeroTemp.time = new Date(iobResults[i].iobWithZeroTemp.date);
            } else {
              iobResults[i].iobWithZeroTemp.time = iobResults[i].time || new Date();
            }
          }
        }
      }
      
      // Add a fake lastBolusTime to prevent NaN in SMB calculations
      const now = new Date().getTime();
      iobResults.lastBolusTime = now - (3 * 60 * 1000); // Set last bolus to 3 minutes ago
      
      console.log("IOB array length:", iobResults.length);
      console.log("First IOB entry:", JSON.stringify(iobResults[0], null, 2));
      
      return iobResults;
    } catch (error) {
      console.error('Error calculating IOB:', error);
      // Return a default IOB array if calculation fails
      const defaultIOB = [{ 
        iob: 0, 
        activity: 0,
        time: new Date() 
      }];
      defaultIOB.lastBolusTime = new Date().getTime() - (3 * 60 * 1000);
      return defaultIOB;
    }
  }
  
  // Modified runOref0 function
  function runOref0(processedData) {
    try {
      // Calculate IOB (now returns the full array)
      const iobArray = calculateIOB(processedData);
      
      // Calculate meal data
      const meal = calculateMeal(processedData);
      
      console.log("determine-basal function available:", typeof determineBasal === 'function');
      console.log("Calling determine-basal with properly formatted inputs");
      
      try {
        // Call determine-basal with all expected parameters
        // Use the entire IOB array, not just the first element
        const microBolusAllowed = true; // Allow microboluses
        const reservoir_data = null; // Don't worry about reservoir data
        const currentTime = new Date(); // Use current time
        
        // Debug logging for troubleshooting prediction arrays
        console.log("Glucose status:", JSON.stringify(processedData.glucoseStatus));
        console.log("Current temp:", JSON.stringify(processedData.currentTemp));
        console.log("IOB array first element:", JSON.stringify(iobArray[0]));
        console.log("Profile:", JSON.stringify(processedData.profile));
        console.log("Autosens:", JSON.stringify(processedData.autosens));
        console.log("Meal data:", JSON.stringify(meal));
        
        // Make sure to pass parameters in the correct order
        const tempBasalRecommendation = determineBasal(
          processedData.glucoseStatus,
          processedData.currentTemp,
          iobArray, // Pass the full IOB array
          processedData.profile,
          processedData.autosens,
          meal,
          tempBasalFunctions,
          microBolusAllowed,
          reservoir_data,
          currentTime
        );
        
        console.log("Basal recommendation generated");
        
        // Log the prediction arrays if they were generated
        if (tempBasalRecommendation.predBGs) {
          console.log("Prediction arrays successfully generated:");
          if (tempBasalRecommendation.predBGs.IOB) {
            console.log("IOB predictions:", tempBasalRecommendation.predBGs.IOB);
          }
          if (tempBasalRecommendation.predBGs.ZT) {
            console.log("Zero-temp predictions:", tempBasalRecommendation.predBGs.ZT);
          }
          if (tempBasalRecommendation.predBGs.COB) {
            console.log("COB predictions:", tempBasalRecommendation.predBGs.COB);
          }
          if (tempBasalRecommendation.predBGs.UAM) {
            console.log("UAM predictions:", tempBasalRecommendation.predBGs.UAM);
          }
        } else {
          console.log("Warning: No prediction arrays were generated");
        }
        
        return tempBasalRecommendation;
      } catch (e) {
        console.error('Error running determine-basal:', e);
        console.log("Falling back to simplified algorithm");
        
        // Use our simplified algorithm if determine-basal fails
        return runSimplifiedAlgorithm(processedData.glucose, processedData.profile, iobArray[0]);
      }
    } catch (error) {
      console.error('Error running oref0 algorithms:', error);
      throw error;
    }
  }

// Run simplified algorithm if determine-basal doesn't work
function runSimplifiedAlgorithm(glucose, profile, iob) {
  const bg = glucose.glucose;
  const tempBasalRecommendation = {
    rate: profile.current_basal,
    duration: 30,
    reason: "Simple algorithm: "
  };
  
  // Calculate total insulin on board
  const totalIOB = iob.iob || 0;
  
  // Simple algorithm:
  // - If BG is low, reduce basal rate
  // - If BG is high, increase basal rate
  // - Consider IOB in the calculation
  if (bg < profile.min_bg) {
    // The lower the BG, the more we reduce basal
    const lowFactor = Math.max(0, (profile.min_bg - bg) / 40); // For each 40 mg/dL below target
    tempBasalRecommendation.rate = Math.max(0, profile.current_basal * (1 - lowFactor));
    tempBasalRecommendation.reason += `BG ${bg} < target ${profile.min_bg}, IOB ${totalIOB.toFixed(2)}. Reducing basal by ${Math.round(lowFactor*100)}%`;
  } else if (bg > profile.max_bg) {
    // The higher the BG, the more we increase basal
    // But take IOB into account
    const highFactor = Math.min(1, (bg - profile.max_bg) / 40); // For each 40 mg/dL above target
    const iobFactor = Math.max(0, 1 - totalIOB / 2); // Reduce the increase if IOB is high
    
    const adjustedIncrease = highFactor * iobFactor;
    tempBasalRecommendation.rate = Math.min(profile.max_basal, profile.current_basal * (1 + adjustedIncrease));
    tempBasalRecommendation.reason += `BG ${bg} > target ${profile.max_bg}, IOB ${totalIOB.toFixed(2)}. Increasing basal by ${Math.round(adjustedIncrease*100)}%`;
  } else {
    tempBasalRecommendation.reason += `BG ${bg} in range [${profile.min_bg}-${profile.max_bg}], IOB ${totalIOB.toFixed(2)}. No change needed.`;
  }
  
  // Round rate to 2 decimal places
  tempBasalRecommendation.rate = round_basal(tempBasalRecommendation.rate, profile);
  
  return tempBasalRecommendation;
}

// Simulate uploading recommendations to Nightscout
function uploadToNightscout(recommendation) {
  const treatments = [];
  
  // Check if there's an error in the recommendation
  if (recommendation.error) {
    console.error("Error in recommendation:", recommendation.error);
    return [];
  }
  
  // Format the recommendation as a Nightscout treatment
  if (recommendation.rate !== undefined) {
    treatments.push({
      eventType: 'Temp Basal',
      duration: recommendation.duration,
      rate: recommendation.rate,
      reason: recommendation.reason,
      created_at: new Date().toISOString()
    });
  }
  
  // If there's an SMB recommendation
  if (recommendation.units && recommendation.units > 0) {
    treatments.push({
      eventType: 'Bolus',
      insulin: recommendation.units,
      notes: 'Super Micro Bolus',
      created_at: new Date().toISOString()
    });
  }
  
  if (treatments.length > 0) {
    console.log('Recommendations that would be uploaded to Nightscout:');
    console.log(JSON.stringify(treatments, null, 2));
  } else {
    console.log('No recommendations to upload');
  }
  
  return treatments;
}

module.exports = {
  fetchNightscoutData,
  processForOref0,
  calculateIOB,
  runOref0,
  uploadToNightscout
};