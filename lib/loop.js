const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const nightscout = require('./nightscout');

// Directory structure (relative paths)
const DATA_DIR = path.join(__dirname, '../data');
const SETTINGS_DIR = path.join(DATA_DIR, 'settings');
const MONITOR_DIR = path.join(DATA_DIR, 'monitor');
const ENACT_DIR = path.join(DATA_DIR, 'enact');

// Ensure directories exist
[DATA_DIR, SETTINGS_DIR, MONITOR_DIR, ENACT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

class Loop {
  constructor(config) {
    this.config = config;
    this.nightscout = new nightscout(config.nightscout);
    this.running = false;
  }

  async initialize() {
    // Create initial settings files
    console.log('Initializing settings...');
    // TODO: Create default profile, targets, etc.
    
    // Initialize clock file
    const clockData = new Date().toISOString();
    fs.writeFileSync(
      path.join(MONITOR_DIR, 'clock-zoned.json'),
      JSON.stringify(clockData)
    );
    
    // Initialize empty pump history if not exists
    if (!fs.existsSync(path.join(MONITOR_DIR, 'pumphistory-24h-zoned.json'))) {
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'pumphistory-24h-zoned.json'),
        JSON.stringify([])
      );
    }
    
    // Initialize empty temp basal if not exists
    if (!fs.existsSync(path.join(MONITOR_DIR, 'temp_basal.json'))) {
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'temp_basal.json'),
        JSON.stringify({ duration: 0, rate: 0, temp: 'absolute' })
      );
    }
    
    // Initialize empty meal data if not exists
    if (!fs.existsSync(path.join(MONITOR_DIR, 'meal.json'))) {
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'meal.json'),
        JSON.stringify({ carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0, mealCOB: 0, currentDeviation: 0, maxDeviation: 0, minDeviation: 0 })
      );
    }
    
    // Initialize empty carb history if not exists
    if (!fs.existsSync(path.join(MONITOR_DIR, 'carbhistory.json'))) {
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'carbhistory.json'),
        JSON.stringify([])
      );
    }
    
    // TODO: Load profile from Nightscout if possible
    if (!fs.existsSync(path.join(SETTINGS_DIR, 'profile.json'))) {
      try {
        const profile = await this.nightscout.getProfile();
        fs.writeFileSync(
          path.join(SETTINGS_DIR, 'profile.json'),
          JSON.stringify(profile)
        );
      } catch (error) {
        console.warn('Could not fetch profile from Nightscout. Using default profile.');
        // Create basic default profile
        const defaultProfile = {
          dia: 4,
          basal: 0.5,
          sens: 40,
          carb_ratio: 10,
          // Add more default values as needed
        };
        fs.writeFileSync(
          path.join(SETTINGS_DIR, 'profile.json'),
          JSON.stringify(defaultProfile)
        );
      }
    }
    
    // Initialize empty temptargets if not exists
    if (!fs.existsSync(path.join(SETTINGS_DIR, 'temptargets.json'))) {
      fs.writeFileSync(
        path.join(SETTINGS_DIR, 'temptargets.json'),
        JSON.stringify([])
      );
    }
    
    // Initialize basic autosens if not exists
    if (!fs.existsSync(path.join(SETTINGS_DIR, 'autosens.json'))) {
      fs.writeFileSync(
        path.join(SETTINGS_DIR, 'autosens.json'),
        JSON.stringify({ ratio: 1.0 })
      );
    }
    
    // Initialize insulin sensitivities if not exists
    if (!fs.existsSync(path.join(SETTINGS_DIR, 'insulin_sensitivities.json'))) {
      fs.writeFileSync(
        path.join(SETTINGS_DIR, 'insulin_sensitivities.json'),
        JSON.stringify({ 
          "units": "mg/dL",
          "sensitivities": [
            { "i": 0, "start": "00:00:00", "sensitivity": 40, "offset": 0, "x": 0, "endOffset": 1440 }
          ]
        })
      );
    }
    
    // Initialize basal profile if not exists
    if (!fs.existsSync(path.join(SETTINGS_DIR, 'basal_profile.json'))) {
      fs.writeFileSync(
        path.join(SETTINGS_DIR, 'basal_profile.json'),
        JSON.stringify([
          { "i": 0, "start": "00:00:00", "rate": 0.5, "minutes": 0 }
        ])
      );
    }
  }

  async runCycle() {
    console.log('Starting loop cycle at', new Date().toISOString());
    
    try {
      // Update clock file
      const clockData = new Date().toISOString();
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'clock-zoned.json'),
        JSON.stringify(clockData)
      );
      
      // 1. Fetch CGM data from Nightscout
      await this.fetchCGMData();
      
      // 2. Fetch pump history from Nightscout treatments
      await this.fetchPumpHistory();
      
      // 3. Calculate meal data / COB
      console.log('Calculating meal data...');
      try {
        process.chdir(path.join(__dirname, '..'));
        
        const cmd = `npx oref0-meal data/monitor/pumphistory-24h-zoned.json data/settings/profile.json data/monitor/clock-zoned.json data/monitor/glucose.json data/settings/basal_profile.json data/monitor/carbhistory.json`;
        
        const result = execSync(cmd).toString();
        fs.writeFileSync('data/monitor/meal.json', result);
      } catch (error) {
        console.error('Error calculating meal data:', error);
        // Use default meal data if calculation fails
        const defaultMeal = {
          carbs: 0,
          nsCarbs: 0,
          bwCarbs: 0,
          journalCarbs: 0,
          mealCOB: 0,
          currentDeviation: 0,
          maxDeviation: 0,
          minDeviation: 0
        };
        fs.writeFileSync(
          path.join(MONITOR_DIR, 'meal.json'),
          JSON.stringify(defaultMeal)
        );
      }
      
      // 4. Run autosens periodically (every hour instead of every loop)
      const autosensFile = path.join(SETTINGS_DIR, 'autosens.json');
      if (!fs.existsSync(autosensFile) || 
          (new Date() - fs.statSync(autosensFile).mtime) > 1440 * 60 * 1000) {
        console.log('Running autosens (daily update)...');
        await this.runAutosens();
      } else {
        console.log('Using existing autosens data (updated within last hour)');
      }
      
      // 5. Calculate IOB
      await this.calculateIOB();
      
      // 6. Determine basal recommendations
      const recommendations = await this.determineBasal();
      
      // 7. Simulate pump actions & upload to Nightscout
      await this.enactTreatments(recommendations);
      
      console.log('Loop cycle completed successfully');
    } catch (error) {
      console.error('Error in loop cycle:', error);
    }
  }

  async fetchCGMData() {
    console.log('Fetching CGM data...');
    try {
      const entries = await this.nightscout.getEntries();
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'glucose.json'), 
        JSON.stringify(entries)
      );
      return entries;
    } catch (error) {
      console.error('Error fetching CGM data:', error);
      // Use sample data if fetch fails
      if (!fs.existsSync(path.join(MONITOR_DIR, 'glucose.json'))) {
        const sampleGlucose = [
          {
            "sgv": 120,
            "date": Date.now(),
            "dateString": new Date().toISOString(),
            "trend": 4,
            "direction": "Flat",
            "device": "cgmsimoref0",
            "type": "sgv"
          }
        ];
        fs.writeFileSync(
          path.join(MONITOR_DIR, 'glucose.json'),
          JSON.stringify(sampleGlucose)
        );
        return sampleGlucose;
      }
      // Return existing data if available
      return JSON.parse(fs.readFileSync(path.join(MONITOR_DIR, 'glucose.json')));
    }
  }
  
  async fetchPumpHistory() {
    console.log('Fetching pump history from Nightscout treatments...');
    try {
      // Get treatments from the last 24 hours
      const treatments = await this.nightscout.getTreatments(1000); // Get a large number to ensure we get 24 hours
      
      // Filter to last 24 hours only
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const recentTreatments = treatments.filter(t => new Date(t.created_at) >= oneDayAgo);
      
      // Convert Nightscout treatments to pump history format
      const pumpHistory = [];
      
      recentTreatments.forEach(treatment => {
        const timestamp = treatment.created_at || treatment.timestamp || new Date().toISOString();
        
        // Convert bolus treatments
        if (treatment.insulin && treatment.eventType === 'Bolus') {
          pumpHistory.push({
            type: 'Bolus',
            _type: 'Bolus',  // Add _type field 
            timestamp: timestamp,
            amount: parseFloat(treatment.insulin),
            programmed: parseFloat(treatment.insulin),
            unabsorbed: 0,
            duration: 0
          });
        }
        
        // Convert temp basals
        if (treatment.eventType === 'Temp Basal') {
          pumpHistory.push({
            type: 'TempBasal',
            _type: 'TempBasal',  // Add _type field
            timestamp: timestamp,
            rate: parseFloat(treatment.rate || treatment.absolute),
            duration: parseInt(treatment.duration),
            temp: 'absolute'
          });
          
          // Add a TempBasalDuration event as oref0 expects
          pumpHistory.push({
            type: 'TempBasalDuration',
            _type: 'TempBasalDuration',  // Add _type field
            timestamp: timestamp,
            duration: parseInt(treatment.duration)
          });
        }
        
        // Convert carb entries to wizard records
        if (treatment.carbs && treatment.eventType === 'Meal Bolus') {
          pumpHistory.push({
            type: 'Meal',
            _type: 'Meal',  // Add _type field
            timestamp: timestamp,
            carbs: parseInt(treatment.carbs),
            amount: parseFloat(treatment.insulin || 0)
          });
          
          // If there was insulin with carbs, also add a wizard record
          if (treatment.insulin) {
            pumpHistory.push({
              type: 'BolusWizard',
              _type: 'BolusWizard',  // Add _type field
              timestamp: timestamp,
              carbs: parseInt(treatment.carbs),
              amount: parseFloat(treatment.insulin),
              bg: treatment.bg ? parseInt(treatment.bg) : 0,
              insulinCarbRatio: 0, // These would be determined from profile
              insulinSensitivity: 0,
              bgTarget: 0,
              carbInput: parseInt(treatment.carbs)
            });
          }
        }
      });
      
      // Sort by timestamp, most recent first
      pumpHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Save to file
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'pumphistory-24h-zoned.json'),
        JSON.stringify(pumpHistory)
      );
      
      // Also extract carb entries for carbhistory.json
      const carbEntries = recentTreatments.filter(t => t.carbs)
        .map(t => ({
          carbs: parseInt(t.carbs),
          created_at: t.created_at,
          date: new Date(t.created_at).getTime()
        }));
      
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'carbhistory.json'),
        JSON.stringify(carbEntries)
      );
      
      return pumpHistory;
    } catch (error) {
      console.error('Error fetching pump history:', error);
      // Create empty history if fetch fails
      const emptyHistory = [];
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'pumphistory-24h-zoned.json'),
        JSON.stringify(emptyHistory)
      );
      return emptyHistory;
    }
  }

  async runAutosens() {
    console.log('Running autosens...');
    try {
      // Change directory to project root before running command
      process.chdir(path.join(__dirname, '..'));
      
      // Use relative paths from project root
      const cmd = `npx oref0-detect-sensitivity data/monitor/glucose.json data/monitor/pumphistory-24h-zoned.json data/settings/insulin_sensitivities.json data/settings/basal_profile.json data/settings/profile.json data/monitor/carbhistory.json data/settings/temptargets.json`;
      
      const result = execSync(cmd).toString();
      fs.writeFileSync('data/settings/autosens.json', result);
      return JSON.parse(result);
    } catch (error) {
      console.error('Error running autosens:', error);
      // Create default autosens data if failed
      const defaultAutosens = { ratio: 1.0 };
      fs.writeFileSync(
        path.join(SETTINGS_DIR, 'autosens.json'),
        JSON.stringify(defaultAutosens)
      );
      return defaultAutosens;
    }
  }

  async calculateIOB() {
    console.log('Calculating IOB...');
    try {
      process.chdir(path.join(__dirname, '..'));
      
      // Debug pump history
      const pumpHistoryPath = path.join(process.cwd(), 'data/monitor/pumphistory-24h-zoned.json');
      const profilePath = path.join(process.cwd(), 'data/settings/profile.json');
      const clockPath = path.join(process.cwd(), 'data/monitor/clock-zoned.json');
      const autosensPath = path.join(process.cwd(), 'data/settings/autosens.json');
      
      console.log('Debugging IOB calculation:');
      console.log('Pump history exists:', fs.existsSync(pumpHistoryPath));
      console.log('Profile exists:', fs.existsSync(profilePath));
      console.log('Clock exists:', fs.existsSync(clockPath));
      console.log('Autosens exists:', fs.existsSync(autosensPath));
      
      // Debug recent pump history
      const pumpHistory = JSON.parse(fs.readFileSync(pumpHistoryPath));
      console.log('Recent pump history (last 5 entries):');
      console.log(JSON.stringify(pumpHistory.slice(0, 5), null, 2));
      
      // Check profile DIA
      const profile = JSON.parse(fs.readFileSync(profilePath));
      console.log('Profile DIA:', profile.dia);
      
      // Current time reference
      const clock = JSON.parse(fs.readFileSync(clockPath));
      console.log('Current clock time:', clock);
      
      const cmd = `npx oref0-calculate-iob data/monitor/pumphistory-24h-zoned.json data/settings/profile.json data/monitor/clock-zoned.json data/settings/autosens.json`;
      
      const result = execSync(cmd).toString();
      console.log('IOB calculation raw result (first 200 chars):', result.substring(0, 200));
      
      fs.writeFileSync('data/monitor/iob.json', result);
      return JSON.parse(result);
    } catch (error) {
      console.error('Error calculating IOB:', error);
      // Return empty IOB array if calculation fails
      const emptyIOB = [{ iob: 0, basaliob: 0, bolusiob: 0, activity: 0, time: new Date().toISOString() }];
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'iob.json'),
        JSON.stringify(emptyIOB)
      );
      return emptyIOB;
    }
  }

  async determineBasal() {
    console.log('Determining basal...');
    try {
      process.chdir(path.join(__dirname, '..'));
      
      const cmd = `npx oref0-determine-basal data/monitor/iob.json data/monitor/temp_basal.json data/monitor/glucose.json data/settings/profile.json --auto-sens data/settings/autosens.json --meal data/monitor/meal.json --microbolus`;
      
      const result = execSync(cmd).toString();
      fs.writeFileSync('data/enact/suggested.json', result);
      return JSON.parse(result);
    } catch (error) {
      console.error('Error determining basal:', error);
      // Return a safe default if determination fails
      const defaultRecommendation = {
        reason: "Error in determine-basal algorithm. Using safe defaults.",
        rate: 0,
        duration: 0,
        temp: 'absolute',
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(
        path.join(ENACT_DIR, 'suggested.json'),
        JSON.stringify(defaultRecommendation)
      );
      return defaultRecommendation;
    }
  }

  async enactTreatments(recommendations) {
    console.log('Enacting treatments...');
    
    // First, ensure we have full recommendations with all prediction data
    // If the recommendations don't have predBGs, try to parse them from the reason
    if (!recommendations.predBGs && recommendations.reason) {
      try {
        // Extract prediction data if available in the reason
        if (recommendations.reason.includes('predBG')) {
          // Add placeholder for prediction arrays if not found
          recommendations.predBGs = {};
        }
      } catch (error) {
        console.error('Error parsing prediction data:', error);
      }
    }
    
    // Enhance console logging with more details
    if (recommendations.bg) {
      console.log(`Current BG: ${recommendations.bg}, Eventual BG: ${recommendations.eventualBG}`);
    }
    if (recommendations.COB) {
      console.log(`COB: ${recommendations.COB}g, IOB: ${recommendations.IOB}U`);
    }
    if (recommendations.sensitivityRatio) {
      console.log(`Sensitivity Ratio: ${recommendations.sensitivityRatio}, ISF: ${recommendations.ISF}, CR: ${recommendations.CR}`);
    }
    
    // Simulate pump actions
    const enactedData = { 
      ...recommendations, 
      enacted: true, 
      timestamp: new Date().toISOString(),
      received: true
    };
    
    fs.writeFileSync(
      path.join(ENACT_DIR, 'enacted.json'),
      JSON.stringify(enactedData)
    );
    
    // Update temp_basal.json with the new temporary basal
    if (recommendations.rate !== undefined && recommendations.duration !== undefined) {
      const tempBasal = {
        duration: recommendations.duration,
        rate: recommendations.rate,
        temp: 'absolute'
      };
      
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'temp_basal.json'),
        JSON.stringify(tempBasal)
      );
    }
    
    // If we have an SMB, add it to pump history
    if (recommendations.units > 0) {
      // ... [existing SMB code] ...
    }
    
    // Upload treatments to Nightscout
    try {
      if (recommendations.rate !== undefined && recommendations.duration !== undefined) {
        const nsTemp = {
          eventType: 'Temp Basal',
          duration: recommendations.duration,
          rate: recommendations.rate,
          absolute: recommendations.rate,
          created_at: new Date().toISOString(),
          enteredBy: 'cgmsimoref0'
        };
        
        await this.nightscout.uploadTreatments([nsTemp]);
      }
      
      if (recommendations.units > 0) {
        const nsBolus = {
          eventType: 'Bolus',
          insulin: recommendations.units,
          created_at: new Date().toISOString(),
          enteredBy: 'cgmsimoref0'
        };
        
        await this.nightscout.uploadTreatments([nsBolus]);
      }
      
      // Create and upload devicestatus
      const now = new Date();
      const iobData = JSON.parse(fs.readFileSync(path.join(MONITOR_DIR, 'iob.json')));
      const pumpStatus = {
        clock: now.toISOString(),
        battery: { voltage: 1.33, status: "normal" },
        reservoir: 150, // Simulated value
        status: {
          status: "normal",
          bolusing: false,
          suspended: false,
          timestamp: now.toISOString()
        }
      };
      
      // Read current glucose value
      let glucoseData = [];
      try {
        glucoseData = JSON.parse(fs.readFileSync(path.join(MONITOR_DIR, 'glucose.json')));
      } catch (error) {
        console.error('Error reading glucose data:', error);
      }
      
      // Get current BG and trend if available
      let currentBG = null;
      let bgTrend = null;
      if (glucoseData.length > 0) {
        currentBG = glucoseData[0].sgv;
        if (glucoseData.length > 1) {
          const delta = currentBG - glucoseData[1].sgv;
          bgTrend = delta > 0 ? '+' + delta : delta.toString();
        }
      }
      
      // Read meal data
      let mealData = {};
      try {
        mealData = JSON.parse(fs.readFileSync(path.join(MONITOR_DIR, 'meal.json')));
      } catch (error) {
        console.error('Error reading meal data:', error);
      }
      
      // Read profile data
      let profileData = {};
      try {
        profileData = JSON.parse(fs.readFileSync(path.join(SETTINGS_DIR, 'profile.json')));
      } catch (error) {
        console.error('Error reading profile data:', error);
      }
      
      // Enhanced suggested data with predictions
      const enhancedSuggested = {
        ...recommendations,
        deliverAt: now.toISOString(),
        bg: currentBG,
        tick: bgTrend,
        COB: mealData.mealCOB || recommendations.COB,
        IOB: iobData[0].iob,
        // Add estimated ISF, CR from profile if not in recommendations
        ISF: recommendations.ISF || profileData.sens,
        CR: recommendations.CR || profileData.carb_ratio,
        target_bg: profileData.min_bg,
        sensitivityRatio: recommendations.sensitivityRatio || 1.0
      };
      
      // Create the enhanced device status object
      const deviceStatus = {
        device: "openaps://cgmsimoref0",
        openaps: {
          iob: iobData[0],
          suggested: enhancedSuggested,
          enacted: {
            ...enactedData,
            bg: currentBG,
            tick: bgTrend,
            COB: mealData.mealCOB || recommendations.COB,
            IOB: iobData[0].iob,
            ISF: recommendations.ISF || profileData.sens,
            CR: recommendations.CR || profileData.carb_ratio,
            target_bg: profileData.min_bg,
            sensitivityRatio: recommendations.sensitivityRatio || 1.0
          },
          version: "0.7.1"
        },
        pump: pumpStatus,
        created_at: now.toISOString(),
        uploader: {
          batteryVoltage: 3867,
          battery: 69
        }
      };
      
      // Add predictions if available 
      if (recommendations.predBGs) {
        deviceStatus.openaps.suggested.predBGs = recommendations.predBGs;
        deviceStatus.openaps.enacted.predBGs = recommendations.predBGs;
      } else {
        // Create simple prediction arrays if none available
        const predictionHorizon = 36; // 3 hours with 5min intervals
        const simplePredictions = {
          IOB: [],
          ZT: [],
          COB: [],
          UAM: []
        };
        
        // Generate simple prediction arrays
        let simBG = currentBG;
        for (let i = 0; i < predictionHorizon; i++) {
          // Basic IOB prediction (insulin effect)
          simplePredictions.IOB.push(Math.round(simBG - (iobData[0].iob * 50 * i/12)));
          
          // Zero temp prediction
          simplePredictions.ZT.push(Math.round(simBG));
          
          // COB prediction (carb effect)
          if (mealData.mealCOB > 0) {
            simplePredictions.COB.push(Math.round(simBG + (mealData.mealCOB * 4 * i/12)));
          } else {
            simplePredictions.COB.push(Math.round(simBG));
          }
          
          // UAM prediction
          simplePredictions.UAM.push(Math.round(simBG));
          
          // Basic BG drift for next iteration
          simBG += (mealData.mealCOB > 0) ? 1 : -1;
        }
        
        deviceStatus.openaps.suggested.predBGs = simplePredictions;
        deviceStatus.openaps.enacted.predBGs = simplePredictions;
      }

      // Enhance console logging with more details

      console.log('Enhanced treatment data:');
      console.log(`Current BG: ${currentBG || 'unknown'}`);
      console.log(`COB: ${mealData.mealCOB || recommendations.COB || 'unknown'}g`);
      
      // Add more explicit debugging and handling for IOB
      const iobValue = iobData[0] && typeof iobData[0].iob !== 'undefined' ? iobData[0].iob : 'unknown';
      console.log(`IOB raw value type: ${typeof iobData[0].iob}`); 
      console.log(`IOB: ${iobValue}U`);
      
      console.log(`Target BG: ${profileData.min_bg || 'unknown'} mg/dL`);
      console.log(`Insulin Sensitivity: ${profileData.sens || recommendations.ISF || 'unknown'} mg/dL/U`);
      console.log(`Carb Ratio: ${profileData.carb_ratio || recommendations.CR || 'unknown'} g/U`);

        // Add prediction summary if available
        if (recommendations.predBGs && recommendations.predBGs.COB && recommendations.predBGs.COB.length > 0) {
          const lastCOBPrediction = recommendations.predBGs.COB[recommendations.predBGs.COB.length - 1];
          console.log(`Predicted eventual BG with carbs: ${lastCOBPrediction} mg/dL`);
        }
      
      await this.nightscout.uploadDeviceStatus([deviceStatus]);
      
    } catch (error) {
      console.error('Error uploading to Nightscout:', error);
    }
    
    return recommendations;
  }

  async start() {
    if (this.running) return;
    
    this.running = true;
    console.log('Starting loop...');
    
    await this.initialize();
    
  }

  stop() {
    if (!this.running) return;
    
    this.running = false;
    console.log('Loop stopped');
  }
}

module.exports = Loop;