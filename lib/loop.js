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
          // Extract from raw data if available
          const tempType = treatment.raw_rate ? treatment.raw_rate._type : 'TempBasal';
          const durationtype = treatment.raw_duration ? treatment.raw_duration._type : 'TempBasalDuration';
          
          pumpHistory.push({
            type: tempType,
            _type: tempType,  // Add both for compatibility
            timestamp: timestamp,
            rate: parseFloat(treatment.rate || treatment.absolute),
            duration: parseInt(treatment.duration),
            temp: 'absolute'
          });
          
          // Add a TempBasalDuration event with the specific field name expected by the algorithm
          pumpHistory.push({
            type: durationtype,
            _type: durationtype,  // Add both for compatibility
            timestamp: timestamp,
            duration: parseInt(treatment.duration),
            'duration (min)': parseInt(treatment.duration)  // This specific field name is needed
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

  // async calculateIOB() {
  //   console.log('Calculating IOB...');
  //   try {
  //     process.chdir(path.join(__dirname, '..'));
      
  //     const cmd = `npx oref0-calculate-iob data/monitor/pumphistory-24h-zoned.json data/settings/profile.json data/monitor/clock-zoned.json data/settings/autosens.json`;
      
  //     const result = execSync(cmd).toString();
  //     const iobData = JSON.parse(result);
      
  //     // Post-process the lastTemp object to match real OpenAPS format
  //     if (iobData && iobData.length > 0 && iobData[0].lastTemp) {
  //       const lastTemp = iobData[0].lastTemp;
        
  //       // If lastTemp only has a date and no other properties, it's not properly detecting temp basals
  //       if (Object.keys(lastTemp).length === 1 && lastTemp.date) {
  //         // Try to find the most recent temp basal from pump history
  //         try {
  //           const pumpHistoryPath = path.join(process.cwd(), 'data/monitor/pumphistory-24h-zoned.json');
  //           const pumpHistory = JSON.parse(fs.readFileSync(pumpHistoryPath));
            
  //           // Filter for TempBasal entries
  //           const tempBasals = pumpHistory.filter(entry => entry._type === 'TempBasal');
            
  //           if (tempBasals.length > 0) {
  //             // Get the most recent temp basal
  //             const recentTemp = tempBasals[0];
              
  //             // Find the matching TempBasalDuration
  //             const durationEntries = pumpHistory.filter(
  //               entry => entry._type === 'TempBasalDuration' && 
  //               entry.timestamp === recentTemp.timestamp
  //             );
              
  //             if (durationEntries.length > 0) {
  //               const duration = durationEntries[0].duration || 
  //                               durationEntries[0]['duration (min)'];
                
  //               // Create a properly formatted lastTemp object
  //               iobData[0].lastTemp = {
  //                 rate: recentTemp.rate,
  //                 timestamp: recentTemp.timestamp,
  //                 started_at: new Date(recentTemp.timestamp).toISOString(),
  //                 date: new Date(recentTemp.timestamp).getTime(),
  //                 duration: Math.round(duration * 100) / 100  // Round to 2 decimal places
  //               };
  //             }
  //           }
  //         } catch (error) {
  //           console.error('Error enhancing lastTemp:', error);
  //         }
  //       } else {
  //         // Ensure the lastTemp has the correct format
  //         if (lastTemp.duration) {
  //           lastTemp.duration = Math.round(lastTemp.duration * 100) / 100;
  //         }
          
  //         // Make sure started_at is properly formatted
  //         if (lastTemp.timestamp && !lastTemp.started_at) {
  //           lastTemp.started_at = new Date(lastTemp.timestamp).toISOString();
  //         }
  //       }
  //     }
      
  //     fs.writeFileSync('data/monitor/iob.json', JSON.stringify(iobData));
  //     return iobData;
  //   } catch (error) {
  //     console.error('Error calculating IOB:', error);
  //     // Error handling code...
  //   }
  // }

  async calculateIOB() {
    console.log('Calculating IOB...');
    try {
      // Change directory to project root before running command
      process.chdir(path.join(__dirname, '..'));
      
      const cmd = `npx oref0-calculate-iob data/monitor/pumphistory-24h-zoned.json data/settings/profile.json data/monitor/clock-zoned.json data/settings/autosens.json`;
      
      const result = execSync(cmd).toString();
      const iobData = JSON.parse(result);
      
      // Ensure we're working with the first (most recent) IOB entry
      const currentIOB = iobData[0];
      
      // Read pump history to enhance IOB data
      const pumpHistoryPath = path.join(process.cwd(), 'data/monitor/pumphistory-24h-zoned.json');
      const pumpHistory = JSON.parse(fs.readFileSync(pumpHistoryPath));
      
      // Find the most recent bolus
      const bolusEntries = pumpHistory.filter(entry => 
        (entry._type === 'Bolus' || entry.type === 'Bolus') && 
        entry.amount && entry.amount > 0
      );
      
      // Find the most recent temp basal
      const tempBasalEntries = pumpHistory.filter(entry => 
        (entry._type === 'TempBasal' || entry.type === 'TempBasal')
      );
      
      // Enhance IOB data with additional fields
      const enhancedIOB = {
        // Basic IOB fields
        iob: currentIOB.iob || 0,
        activity: currentIOB.activity || 0,
        
        // Basal IOB components
        basaliob: currentIOB.basaliob || 0,
        bolusiob: currentIOB.bolusiob || 0,
        
        // Additional insulin tracking
        netbasalinsulin: currentIOB.netbasalinsulin || 0,
        bolusinsulin: currentIOB.bolusinsulin || 0,
        
        // Timestamp information
        time: currentIOB.time || new Date().toISOString(),
        timestamp: currentIOB.timestamp || new Date().toISOString(),
        mills: currentIOB.mills || Date.now(),
        
        // Zero Temp IOB (mirror main IOB if not specified)
        iobWithZeroTemp: {
          iob: currentIOB.iobWithZeroTemp?.iob || currentIOB.iob || 0,
          activity: currentIOB.iobWithZeroTemp?.activity || currentIOB.activity || 0,
          basaliob: currentIOB.iobWithZeroTemp?.basaliob || currentIOB.basaliob || 0,
          bolusiob: currentIOB.iobWithZeroTemp?.bolusiob || currentIOB.bolusiob || 0,
          netbasalinsulin: currentIOB.iobWithZeroTemp?.netbasalinsulin || currentIOB.netbasalinsulin || 0,
          bolusinsulin: currentIOB.iobWithZeroTemp?.bolusinsulin || currentIOB.bolusinsulin || 0,
          time: currentIOB.iobWithZeroTemp?.time || currentIOB.time || new Date().toISOString()
        }
      };
      
      // Add last bolus information if available
      if (bolusEntries.length > 0) {
        const lastBolus = bolusEntries[0];
        enhancedIOB.lastBolusTime = new Date(lastBolus.timestamp || lastBolus.date).getTime();
        enhancedIOB.lastBolusAmount = lastBolus.amount;
      }
      
      // Add last temp basal information if available
      if (tempBasalEntries.length > 0) {
        const lastTempBasal = tempBasalEntries[0];
        
        // Find corresponding TempBasalDuration
        const durationEntry = pumpHistory.find(entry => 
          (entry._type === 'TempBasalDuration' || entry.type === 'TempBasalDuration') &&
          entry.timestamp === lastTempBasal.timestamp
        );
        
        enhancedIOB.lastTemp = {
          rate: lastTempBasal.rate || 0,
          timestamp: lastTempBasal.timestamp,
          started_at: lastTempBasal.timestamp,
          date: new Date(lastTempBasal.timestamp).getTime(),
          duration: (durationEntry ? 
            (durationEntry.duration || durationEntry['duration (min)'] || 0) : 0)
        };
      }
      
      // Replace the first IOB entry with the enhanced version
      iobData[0] = enhancedIOB;
      
      // Write enhanced IOB data
      fs.writeFileSync('data/monitor/iob.json', JSON.stringify(iobData));
      
      console.log('IOB Calculation Complete:', {
        totalIOB: enhancedIOB.iob,
        basalIOB: enhancedIOB.basaliob,
        bolusIOB: enhancedIOB.bolusiob
      });
      
      return iobData;
    } catch (error) {
      console.error('Error calculating IOB:', error);
      
      // Fallback to a minimal IOB object
      const fallbackIOB = [{
        iob: 0,
        activity: 0,
        basaliob: 0,
        bolusiob: 0,
        netbasalinsulin: 0,
        bolusinsulin: 0,
        time: new Date().toISOString(),
        iobWithZeroTemp: {
          iob: 0,
          activity: 0,
          basaliob: 0,
          bolusiob: 0
        }
      }];
      
      fs.writeFileSync('data/monitor/iob.json', JSON.stringify(fallbackIOB));
      return fallbackIOB;
    }
  }

  async determineBasal() {
    console.log('Determining basal...');
    try {
      process.chdir(path.join(__dirname, '..'));
      
      // Read the current temp basal from file
      const currentTemp = JSON.parse(
        fs.readFileSync(path.join(MONITOR_DIR, 'temp_basal.json'))
      );
      
      // Debug: Log the currentTemp object
      console.log('Current temp object passed to determine-basal:', JSON.stringify(currentTemp));      
      
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
      console.log(`COB: ${recommendations.COB} g, IOB: ${recommendations.IOB}U`);
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
        temp: 'absolute',
        timestamp: new Date().toISOString()  // Add timestamp
      };
      
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'temp_basal.json'),
        JSON.stringify(tempBasal)
      );
      
      // Also add to pump history to ensure consistency
      const now = new Date().toISOString();
      const newTempBasal = {
        type: 'TempBasal',
        _type: 'TempBasal',
        timestamp: now,
        rate: recommendations.rate,
        duration: recommendations.duration,
        temp: 'absolute'
      };
      
      const newTempDuration = {
        type: 'TempBasalDuration',
        _type: 'TempBasalDuration',
        timestamp: now,
        duration: recommendations.duration
      };
      
      // Read existing history
      let pumpHistory = JSON.parse(fs.readFileSync(
        path.join(MONITOR_DIR, 'pumphistory-24h-zoned.json')
      ));
      
      // Add new entries
      pumpHistory.unshift(newTempDuration);
      pumpHistory.unshift(newTempBasal);
      
      // Write updated history
      fs.writeFileSync(
        path.join(MONITOR_DIR, 'pumphistory-24h-zoned.json'),
        JSON.stringify(pumpHistory)
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
          enteredBy: 'cgmsimoref0',
          // Add these fields to match real OpenAPS format
          raw_rate: {
            _type: 'TempBasal',
            timestamp: new Date().toISOString(),
            temp: 'absolute',
            rate: recommendations.rate
          },
          raw_duration: {
            _type: 'TempBasalDuration',
            timestamp: new Date().toISOString(),
            duration: recommendations.duration
          }
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
        battery: { voltage: 1.45, status: "normal" },
        reservoir: 250, // Simulated value
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
      

      const mills = now.getTime();
      
      // Create the full devicestatus object
      // const deviceStatus = {
      //   device: "openaps://cgmsimoref0",
      //   openaps: {
      //     iob: {
      //       iob: iobData[0].iob,
      //       activity: iobData[0].activity || 0,
      //       basaliob: iobData[0].basaliob || 0,
      //       bolusiob: iobData[0].bolusiob || 0,
      //       netbasalinsulin: iobData[0].netbasalinsulin || 0,
      //       bolusinsulin: iobData[0].bolusinsulin || 0,
      //       iobWithZeroTemp: iobData[0].iobWithZeroTemp || {
      //         iob: iobData[0].iob,
      //         activity: iobData[0].activity || 0,
      //         basaliob: iobData[0].basaliob || 0,
      //         bolusiob: iobData[0].bolusiob || 0,
      //         netbasalinsulin: iobData[0].netbasalinsulin || 0,
      //         bolusinsulin: iobData[0].bolusinsulin || 0,
      //         time: iobData[0].time
      //       },
      //       lastBolusTime: iobData[0].lastBolusTime || 0,
      //       lastTemp: iobData[0].lastTemp || {
      //         rate: 0,
      //         timestamp: now.toISOString(),
      //         started_at: now.toISOString(),
      //         date: mills,
      //         duration: 0
      //       },
      //       time: iobData[0].time,
      //       timestamp: now.toISOString(),
      //       mills: mills
      //     },
      //     suggested: {
      //       reason: recommendations.reason,
      //       timestamp: now.toISOString(),
      //       mills: mills
      //     },
      //     enacted: {
      //       reason: recommendations.reason,
      //       temp: "absolute",
      //       deliverAt: now.toISOString(),
      //       rate: recommendations.rate || 0,
      //       duration: recommendations.duration || 0,
      //       received: true,
      //       timestamp: now.toISOString(),
      //       enacted: true,
      //       bg: currentBG,
      //       tick: bgTrend,
      //       eventualBG: recommendations.eventualBG,
      //       mills: mills
      //     },
      //     version: "0.7.1"
      //   },
      //   pump: {
      //     clock: now.toISOString(),
      //     battery: {
      //       voltage: 1.45,
      //       status: "normal"
      //     },
      //     reservoir: 250,
      //     status: {
      //       status: "normal",
      //       bolusing: false,
      //       suspended: false,
      //       timestamp: now.toISOString()
      //     }
      //   },
      //   uploader: {
      //     batteryVoltage: 3867,
      //     battery: 69
      //   },
      //   preferences: {
      //     max_iob: profileData.max_iob || 6,
      //     max_daily_safety_multiplier: profileData.max_daily_safety_multiplier || 4,
      //     current_basal_safety_multiplier: profileData.current_basal_safety_multiplier || 5,
      //     autosens_max: profileData.autosens_max || 2,
      //     autosens_min: profileData.autosens_min || 0.5,
      //     rewind_resets_autosens: true,
      //     exercise_mode: false,
      //     sensitivity_raises_target: true,
      //     unsuspend_if_no_temp: false,
      //     enableSMB_always: profileData.enableSMB_always || true,
      //     enableSMB_with_COB: profileData.enableSMB_with_COB || true,
      //     enableSMB_with_temptarget: profileData.enableSMB_with_temptarget || false,
      //     enableUAM: profileData.enableUAM || true,
      //     curve: profileData.curve || "ultra-rapid",
      //     offline_hotspot: false,
      //     cgm: "g5-upload",
      //     timestamp: "2025-03-16T11:58:55.625Z"
      //   },
      //   utcOffset: 0,
      //   created_at: now.toISOString(),
      //   mills: mills
      // };

      const deviceStatus = {
        device: "openaps://cgmsimoref0",
        openaps: {
          iob: {
            iob: iobData[0].iob,
            activity: iobData[0].activity || 0,
            basaliob: iobData[0].basaliob || 0,
            bolusiob: iobData[0].bolusiob || 0,
            netbasalinsulin: iobData[0].netbasalinsulin || 0,
            bolusinsulin: iobData[0].bolusinsulin || 0,
            iobWithZeroTemp: {
              iob: iobData[0].iobWithZeroTemp?.iob || iobData[0].iob,
              activity: iobData[0].iobWithZeroTemp?.activity || 0,
              basaliob: iobData[0].iobWithZeroTemp?.basaliob || 0,
              bolusiob: iobData[0].iobWithZeroTemp?.bolusiob || 0,
              netbasalinsulin: iobData[0].iobWithZeroTemp?.netbasalinsulin || 0,
              bolusinsulin: iobData[0].iobWithZeroTemp?.bolusinsulin || 0,
              time: iobData[0].iobWithZeroTemp?.time || now.toISOString()
            },
            lastBolusTime: iobData[0].lastBolusTime || 0,
            lastTemp: iobData[0].lastTemp || {
              rate: 0,
              timestamp: now.toISOString(),
              started_at: now.toISOString(),
              date: mills,
              duration: 0
            },
            time: iobData[0].time || now.toISOString(),
            timestamp: now.toISOString(),
            mills: mills
          },
          suggested: {
            reason: recommendations.reason,
            timestamp: now.toISOString(),
            mills: mills,
            temp: "absolute",
            bg: currentBG,
            tick: bgTrend,
            eventualBG: recommendations.eventualBG,
            insulinReq: recommendations.insulinReq || 0,
            reservoir: recommendations.reservoir || "250.0",
            deliverAt: now.toISOString(),
            sensitivityRatio: recommendations.sensitivityRatio || 1.0,
            predBGs: recommendations.predBGs || {
              IOB: [],
              ZT: [],
              COB: [],
              UAM: []
            },
            COB: recommendations.COB || 0,
            IOB: recommendations.IOB || iobData[0].iob,
            BGI: recommendations.BGI || 0,
            deviation: recommendations.deviation || 0,
            ISF: recommendations.ISF || profileData.sens,
            CR: recommendations.CR || profileData.carb_ratio,
            target_bg: profileData.min_bg || recommendations.target_bg
          },
          enacted: {
            reason: recommendations.reason,
            temp: "absolute",
            deliverAt: now.toISOString(),
            rate: recommendations.rate || 0,
            duration: recommendations.duration || 0,
            received: true,
            timestamp: now.toISOString(),
            enacted: true,
            bg: currentBG,
            tick: bgTrend,
            eventualBG: recommendations.eventualBG,
            mills: mills,
            predBGs: recommendations.predBGs || {
              IOB: [],
              ZT: [],
              COB: [],
              UAM: []
            },
            COB: recommendations.COB || 0,
            IOB: recommendations.IOB || iobData[0].iob,
            BGI: recommendations.BGI || 0,
            deviation: recommendations.deviation || 0,
            ISF: recommendations.ISF || profileData.sens,
            CR: recommendations.CR || profileData.carb_ratio,
            target_bg: profileData.min_bg || recommendations.target_bg,
            insulinReq: recommendations.insulinReq || 0,
            reservoir: recommendations.reservoir || "250.0",
            sensitivityRatio: recommendations.sensitivityRatio || 1.0,
            ...(recommendations.units ? { units: recommendations.units } : {})
          },
          version: "0.7.1"
        },
        pump: {
          clock: now.toISOString(),
          battery: {
            voltage: 1.45,
            status: "normal"
          },
          reservoir: 250,
          status: {
            status: "normal",
            bolusing: false,
            suspended: false,
            timestamp: now.toISOString()
          }
        },
        uploader: {
          batteryVoltage: 3867,
          battery: 69
        },
        preferences: {
          max_iob: profileData.max_iob || 6,
          max_daily_safety_multiplier: profileData.max_daily_safety_multiplier || 4,
          current_basal_safety_multiplier: profileData.current_basal_safety_multiplier || 5,
          autosens_max: profileData.autosens_max || 2,
          autosens_min: profileData.autosens_min || 0.5,
          rewind_resets_autosens: true,
          exercise_mode: false,
          sensitivity_raises_target: true,
          unsuspend_if_no_temp: false,
          enableSMB_always: profileData.enableSMB_always || true,
          enableSMB_with_COB: profileData.enableSMB_with_COB || true,
          enableSMB_with_temptarget: profileData.enableSMB_with_temptarget || false,
          enableUAM: profileData.enableUAM || true,
          curve: profileData.curve || "ultra-rapid",
          offline_hotspot: false,
          cgm: "g5-upload",
          timestamp: now.toISOString() // Dynamic timestamp
        },
        utcOffset: 0,
        created_at: now.toISOString(),
        mills: mills
      };
      
      // In enactTreatments method
      if (recommendations.predBGs) {
        // Directly use predictions from determine-basal without modification
        deviceStatus.openaps.enacted.predBGs = recommendations.predBGs;
        
        // Optional: Add logging to understand prediction generation
        Object.keys(recommendations.predBGs).forEach(key => {
          console.log(`${key} Predictions: ${recommendations.predBGs[key].length} points`);
        });
      }
      
      // Add COB to deviceStatus (enacted only)
      if (recommendations.COB !== undefined) {
        deviceStatus.openaps.enacted.COB = recommendations.COB;
      }
      
      // Add IOB to deviceStatus (enacted only)
      if (recommendations.IOB !== undefined) {
        deviceStatus.openaps.enacted.IOB = recommendations.IOB;
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