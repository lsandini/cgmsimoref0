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
      
      // 3. Run autosens periodically (every hour instead of every loop)
      const autosensFile = path.join(SETTINGS_DIR, 'autosens.json');
      if (!fs.existsSync(autosensFile) || 
          (new Date() - fs.statSync(autosensFile).mtime) > 1440 * 60 * 1000) {
        console.log('Running autosens (daily update)...');
        await this.runAutosens();
      } else {
        console.log('Using existing autosens data (updated within last hour)');
      }
      
      // 4. Calculate IOB
      await this.calculateIOB();
      
      // 5. Determine basal recommendations
      const recommendations = await this.determineBasal();
      
      // 6. Simulate pump actions & upload to Nightscout
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
            timestamp: timestamp,
            rate: parseFloat(treatment.rate || treatment.absolute),
            duration: parseInt(treatment.duration),
            temp: 'absolute'
          });
          
          // Add a TempBasalDuration event as oref0 expects
          pumpHistory.push({
            type: 'TempBasalDuration',
            timestamp: timestamp,
            duration: parseInt(treatment.duration)
          });
        }
        
        // Convert carb entries to wizard records
        if (treatment.carbs && treatment.eventType === 'Meal Bolus') {
          pumpHistory.push({
            type: 'Meal',
            timestamp: timestamp,
            carbs: parseInt(treatment.carbs),
            amount: parseFloat(treatment.insulin || 0)
          });
          
          // If there was insulin with carbs, also add a wizard record
          if (treatment.insulin) {
            pumpHistory.push({
              type: 'BolusWizard',
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
      
      const cmd = `npx oref0-calculate-iob data/monitor/pumphistory-24h-zoned.json data/settings/profile.json data/monitor/clock-zoned.json data/settings/autosens.json`;
      
      const result = execSync(cmd).toString();
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
      
      const deviceStatus = {
        device: "openaps://cgmsimoref0",
        openaps: {
          iob: iobData[0],
          suggested: recommendations,
          enacted: enactedData,
          version: "0.7.1" // Match your oref0 version
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
    
    // Run loop at specified interval
    const interval = this.config.loops?.interval || 5 * 60 * 1000; // default 5 minutes
    this.intervalId = setInterval(() => this.runCycle(), interval);
    
    // Run first cycle immediately
    this.runCycle();
  }

  stop() {
    if (!this.running) return;
    
    clearInterval(this.intervalId);
    this.running = false;
    console.log('Loop stopped');
  }
}

module.exports = Loop;