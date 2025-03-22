const tempBasalFunctions = require('oref0/lib/basal-set-temp');
const determine_basal = require('oref0/lib/determine-basal/determine-basal');
const getLastGlucose = require('oref0/lib/glucose-get-last');
const iob = require('oref0/lib/iob');
const getMealData = require('oref0/lib/meal/total');
const NightscoutClient = require('./nightscout');
const findMealInputs = require('oref0/lib/meal/history');

// Default profile settings at the top of the file for easy access and modification
const DEFAULT_PROFILE = {
  // Type designation
  type: "current",
  
  // Insulin parameters
  dia: 6,
  curve: "rapid-acting",
  useCustomPeakTime: false,
  insulinPeakTime: 75,
  
  // Basal settings - SINGLE VALUE, not array
  current_basal: 1.0,
  max_daily_basal: 1.0,
  
  // Sensitivity - SINGLE VALUE, not array
  sens: 50,
  
  // Carb ratio - SINGLE VALUE, not array
  carb_ratio: 10,
  
  // Target BG values - SINGLE VALUES, not arrays
  min_bg: 100,
  max_bg: 100,
  
  // Safety parameters
  max_iob: 6,
  max_basal: 4,
  max_daily_safety_multiplier: 4,
  current_basal_safety_multiplier: 5,
  
  // Autosens settings
  autosens_max: 2,
  autosens_min: 0.5,
  
  // SMB parameters
  enableUAM: true,
  enableSMB_with_bolus: true,
  enableSMB_with_COB: true,
  enableSMB_with_temptarget: false,
  enableSMB_after_carbs: true,
  maxSMBBasalMinutes: 75,
  
  // Other parameters
  min_5m_carbimpact: 8,
  remainingCarbsCap: 90,
  maxCOB: 120,
  out_units: "mg/dL",
  
  // Structured profiles (exact format matters)
  basalprofile: [
    {
      minutes: 0,
      rate: 1.0,
      start: "00:00:00",
      i: 0
    }
  ],
  
  // ISF profile
  isfProfile: {
    first: 1,
    sensitivities: [
      {
        endOffset: 1440,
        offset: 0,
        x: 0,
        sensitivity: 50,
        start: "00:00:00",
        i: 0
      }
    ],
    user_preferred_units: "mg/dL",
    units: "mg/dL"
  },
  
  // Carb ratios
  carb_ratios: {
    schedule: [
      {
        x: 0,
        i: 0,
        offset: 0,
        ratio: 10,
        r: 10,
        start: "00:00:00"
      }
    ],
    units: "grams"
  },
  
  // BG targets
  bg_targets: {
    first: 1,
    targets: [
      {
        max_bg: 100,
        min_bg: 100,
        x: 0,
        offset: 0,
        low: 100,
        start: "00:00:00",
        high: 100,
        i: 0
      }
    ],
    user_preferred_units: "mg/dL",
    units: "mg/dL"
  }
};

class InMemoryLoop {
  constructor(config) {
    this.config = config;
    this.nightscout = new NightscoutClient(config.nightscout);
    this.running = false;
    
    // Use default profile settings (can be overridden from config)
    this.profileSettings = {
      ...DEFAULT_PROFILE,
      ...(config.profile || {})
    };
    
    // In-memory data store (replaces all file I/O)
    this.data = {
      settings: {
        profile: {
          // Core settings with defaults (will be overridden by Nightscout profile)
          ...this.profileSettings,
          // Required by oref0
          type: "current",
          // Will be populated from Nightscout profile
          isfProfile: {
            sensitivities: [{ offset: 0, sensitivity: this.profileSettings.sens }]
          }
        },
        basal_profile: [{ minutes: 0, rate: this.profileSettings.current_basal }],
        autosens: { ratio: 1.0 }
      },
      monitor: {
        glucose: [],
        pumphistory: [],
        clock: new Date().toISOString(),
        temp_basal: { duration: 0, rate: 0, temp: 'absolute' },
        meal: {
          carbs: 0,
          nsCarbs: 0,
          bwCarbs: 0,
          journalCarbs: 0,
          mealCOB: 0,
          currentDeviation: 0,
          maxDeviation: 0,
          minDeviation: 0
        },
        carbhistory: [],
        iob: []
      },
      enact: {
        suggested: null,
        enacted: null
      }
    };
  }

  async initialize() {
    console.log('Initializing in-memory loop...');
    
    try {
      // Fetch profile from Nightscout
      const nsProfile = await this.nightscout.getProfile();
      this.updateProfileFromNightscout(nsProfile);
      
      // Initialize with data from Nightscout
      await this.fetchCGMData();
      await this.fetchPumpHistory();
      
      console.log('Loop initialized with in-memory data');
      return true;
    } catch (error) {
      console.error('Error initializing loop:', error);
      return false;
    }
  }
  
  // Extract and map Nightscout profile to oref0 profile format
  updateProfileFromNightscout(nsProfile) {
    if (!nsProfile || !nsProfile.store) {
      console.warn('Invalid or missing Nightscout profile');
      return;
    }
    
    try {
      // Get first profile from store
      const profileName = Object.keys(nsProfile.store)[0];
      const profile = nsProfile.store[profileName];
      
      if (!profile) return;
      
      // Map Nightscout profile to oref0 profile
      this.data.settings.profile.dia = profile.dia || this.profileSettings.dia;
      this.data.settings.profile.carb_ratio = profile.carbratio || this.profileSettings.carb_ratio;
      this.data.settings.profile.sens = profile.sens || this.profileSettings.sens;
      this.data.settings.profile.current_basal = profile.basal || this.profileSettings.current_basal;
      this.data.settings.profile.max_iob = profile.max_iob || this.profileSettings.max_iob;
      this.data.settings.profile.max_basal = profile.max_basal || this.profileSettings.max_basal;
      
      // Target BG
      if (profile.target_low && profile.target_high) {
        this.data.settings.profile.min_bg = profile.target_low;
        this.data.settings.profile.max_bg = profile.target_high;
      }
      
      // Update basal profile
      if (profile.basal) {
        this.data.settings.basal_profile = [{ minutes: 0, rate: profile.basal }];
      }
      
      // Update ISF profile
      this.data.settings.profile.isfProfile = {
        sensitivities: [{ offset: 0, sensitivity: this.data.settings.profile.sens }]
      };
      
      console.log('Profile updated from Nightscout');
    } catch (error) {
      console.error('Error updating profile from Nightscout:', error);
    }
  }

  async fetchCGMData() {
    try {
      const entries = await this.nightscout.getEntries();
      
      // Convert to format expected by oref0
      this.data.monitor.glucose = entries.map(entry => ({
        sgv: entry.sgv,
        date: entry.date,
        dateString: entry.dateString,
        direction: entry.direction,
        type: entry.type || 'sgv'
      }));
      
      console.log(`Fetched ${this.data.monitor.glucose.length} glucose readings`);
      return this.data.monitor.glucose;
    } catch (error) {
      console.error('Error fetching CGM data:', error);
      return [];
    }
  }

  async fetchPumpHistory() {
    try {
      // Get treatments from the last 24 hours
      const treatments = await this.nightscout.getTreatments(1000);
  
      // Filter to last 24 hours only
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const recentTreatments = treatments.filter(t => new Date(t.created_at) >= oneDayAgo);
  
      // Convert Nightscout treatments to pump history format
      const pumpHistory = [];
      const carbHistory = [];
  
      recentTreatments.forEach(treatment => {
        const timestamp = treatment.created_at || treatment.timestamp || new Date().toISOString();
        const dateNum = new Date(timestamp).getTime(); // Ensure date is a number
  
        // Convert bolus treatments
        if (treatment.insulin && treatment.eventType === 'Bolus') {
          pumpHistory.push({
            _type: 'Bolus',
            timestamp: timestamp,
            amount: parseFloat(treatment.insulin),
            insulin: parseFloat(treatment.insulin),
            date: dateNum
          });
        }
  
        // Convert temp basals
        if (treatment.eventType === 'Temp Basal') {
          pumpHistory.push({
            _type: 'TempBasal',
            timestamp: timestamp,
            rate: parseFloat(treatment.rate || treatment.absolute),
            duration: parseInt(treatment.duration),
            temp: 'absolute',
            date: dateNum
          });
  
          // Add duration entry
          pumpHistory.push({
            _type: 'TempBasalDuration',
            timestamp: timestamp,
            'duration (min)': parseInt(treatment.duration),
            date: dateNum
          });
        }
  
        // Convert carb entries
        if (treatment.carbs) {
          const carbEntry = {
            _type: 'Meal', // Add _type field
            timestamp: timestamp, // Add timestamp field
            carbs: parseInt(treatment.carbs),
            created_at: timestamp,
            date: dateNum
          };
  
          pumpHistory.push(carbEntry);
          carbHistory.push(carbEntry);
        }
      });
  
      // Store in memory
      this.data.monitor.pumphistory = pumpHistory;
      this.data.monitor.carbhistory = carbHistory;
  
      console.log(`Fetched ${pumpHistory.length} pump history records`);
  
      return pumpHistory;
    } catch (error) {
      console.error('Error fetching pump history:', error);
      return [];
    }
  }

calculateMeal() {
  try {
    // Import meal data generation function
    const generateMealData = require('oref0/lib/meal');

    console.log('AAA carbhistory in calculateMeal:', this.data.monitor.carbhistory);

    // Prepare inputs with defensive checks
    const mealInputs = {
      history: this.data.monitor.pumphistory || [],
      carbs: this.data.monitor.carbhistory || [], // Ensure carbs is an array
      profile: this.data.settings.profile
    };

    console.log('BBB mealInputs in calculateMeal (first only):', mealInputs.history[0]);

    // Find treatments using imported findMealInputs function
    const treatments = findMealInputs(mealInputs);

    console.log('CCC treatments in calculateMeal:', treatments);

    // Prepare final inputs for meal data generation
    const mealDataInputs = {
      treatments: treatments,
      profile: this.data.settings.profile,
      history: this.data.monitor.pumphistory || [],
      glucose: this.data.monitor.glucose || [],
      basalprofile: this.data.settings.profile.basalprofile,
      clock: this.data.monitor.clock || new Date().toISOString()
    };

    console.log('DDD-tr mealDataInputs in calculateMeal:', mealDataInputs.treatments[0]);
    console.log('DDD-pr mealDataInputs in calculateMeal:', mealDataInputs.profile[0]);
    console.log('DDD-hi mealDataInputs in calculateMeal:', mealDataInputs.history[0]);
    console.log('DDD-gl mealDataInputs in calculateMeal:', mealDataInputs.glucose[0]);
    console.log('DDD-ba mealDataInputs in calculateMeal:', mealDataInputs.basalprofile[0]);
    console.log('DDD-cl mealDataInputs in calculateMeal:', mealDataInputs.clock
      ? new Date(mealDataInputs.clock).toISOString()
      : 'N/A');
    console.log('====================================================');

    // Generate meal data
    const mealData = generateMealData(mealDataInputs);

    console.log('EEE generated mealData:', mealData);

    // Store the meal data in the monitor
    this.data.monitor.meal = mealData;

    console.log('Meal data calculated:', {
      carbs: mealData.carbs,
      COB: mealData.mealCOB,
      lastCarbTime: mealData.lastCarbTime ? new Date(mealData.lastCarbTime).toISOString() : 'N/A'
    });

    return mealData;
  } catch (error) {
    console.error('Error calculating meal data:', error);
    console.error('Error stack:', error.stack);

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

  calculateIOB() {
    try {
      // Use oref0 iob module directly
      const iobData = iob({
        profile: this.data.settings.profile,
        clock: new Date().toISOString()
      }, false, this.data.monitor.pumphistory);
      
      this.data.monitor.iob = iobData;
      
      console.log('IOB Calculation:', {
        totalIOB: iobData[0]?.iob || 0,
        basalIOB: iobData[0]?.basaliob || 0,
        bolusIOB: iobData[0]?.bolusiob || 0
      });
      
      return iobData;
    } catch (error) {
      console.error('Error calculating IOB:', error);
      return [{ iob: 0, activity: 0, basaliob: 0, bolusiob: 0 }];
    }
  }

  determineBasal() {
    try {
      // Get glucose status (delta, etc.)
      const glucose_status = getLastGlucose(this.data.monitor.glucose);
      
      // Get the current glucose reading
      const current_glucose = this.data.monitor.glucose[0] || { sgv: 120 };
      const bg = current_glucose.sgv;
      
      console.log(`Current BG: ${bg} mg/dl`);
      
      // Use the complete profile structure from our settings
      // No need to rebuild - use the structure directly
      const profile = {
        ...this.profileSettings,
        type: "current"
      };
      
      // Log key settings for debugging
      console.log('$$$ Glucose status:', JSON.stringify(glucose_status, null, 2));
      console.log('$$$ IOB data:', JSON.stringify(this.data.monitor.iob[0], null, 2));
      console.log('Profile key settings:');
      console.log('- Insulin action curve (DIA):', profile.dia);
      console.log('- Insulin curve type:', profile.curve);
      console.log('- Insulin peak time:', profile.insulinPeakTime);
      console.log('- Custom peak time enabled:', profile.useCustomPeakTime);
      console.log('- Current basal rate:', profile.current_basal);
      console.log('- ISF:', profile.sens);
      console.log('- Has basal profile:', Array.isArray(profile.basalprofile));
      
      // Current temporary basal
      const temp = {
        duration: this.data.monitor.temp_basal.duration || 0,
        rate: this.data.monitor.temp_basal.rate || 0,
        temp: "absolute"
      };
      
      // IOB data as an array (required format)
      const iob_data = this.data.monitor.iob.length > 0 ? 
        this.data.monitor.iob : 
        [{ iob: 0, activity: 0, basaliob: 0, bolusiob: 0 }];
      
      // Meal data
      const meal_data = this.data.monitor.meal || {
        carbs: 0,
        mealCOB: 0,
        currentDeviation: 0,
        maxDeviation: 0,
        minDeviation: 0
      };
      
      // Standard autosens
      const autosens_data = {
        ratio: 1.0
      };
      
      console.log(`Determine Basal Input - BG: ${bg}, IOB: ${iob_data[0].iob}, COB: ${meal_data.mealCOB}`);
      
      // Call determine-basal with all required inputs
      const determineBasalResult = determine_basal(
        glucose_status,
        temp,
        iob_data,
        profile,
        autosens_data,
        meal_data,
        tempBasalFunctions
      );
      
      // Ensure we have required fields
      if (!determineBasalResult) {
        console.error("determine-basal returned null");
        return {
          reason: "Error: could not determine basal rate",
          rate: 0,
          duration: 0,
          temp: "absolute",
          deliverAt: new Date()
        };
      }
      
      // Add missing fields
      determineBasalResult.deliverAt = determineBasalResult.deliverAt || new Date();
      
      console.log('Determine Basal Result:', {
        rate: determineBasalResult.rate,
        duration: determineBasalResult.duration,
        reason: determineBasalResult.reason,
        eventualBG: determineBasalResult.eventualBG
      });
      
      // Save the suggestion
      this.data.enact.suggested = determineBasalResult;
      
      return determineBasalResult;
    } catch (error) {
      console.error('Error determining basal:', error.stack || error);
      return {
        reason: "Error in determine-basal algorithm. Using safe defaults.",
        rate: 0,
        duration: 0,
        temp: "absolute",
        deliverAt: new Date()
      };
    }
  }

  async enactTreatments(recommendations) {
    console.log('Enacting treatments...');
    
    try {
      // Prepare enacted data
      const enactedData = { 
        ...recommendations, 
        enacted: true, 
        timestamp: new Date().toISOString(),
        received: true
      };
      
      this.data.enact.enacted = enactedData;
      
      // Log the predBGs from recommendations
      if (recommendations.predBGs) {
        console.log('Prediction data found:', Object.keys(recommendations.predBGs));
        console.log('IOB prediction length:', recommendations.predBGs.IOB ? recommendations.predBGs.IOB.length : 0);
        console.log('ZT prediction length:', recommendations.predBGs.ZT ? recommendations.predBGs.ZT.length : 0);
      }
      
      // Create and upload devicestatus
      const deviceStatus = this.createDeviceStatus(recommendations);
      await this.nightscout.uploadDeviceStatus([deviceStatus]);
      
      return enactedData;
    } catch (error) {
      console.error('Error enacting treatments:', error);
      return null;
    }
  }

  createDeviceStatus(recommendations) {
    const now = new Date();
    const iobData = this.data.monitor.iob[0] || { iob: 0, activity: 0 };
    
    // Get most recent glucose reading
    const currentBG = this.data.monitor.glucose[0]?.sgv;
    
    // Calculate pump basal IOB (this might need adjustment based on your specific requirements)
    const pumpBasalIOB = iobData.basaliob || 0;
    
    return {
      device: "openaps-node",
      openaps: {
        iob: {
          iob: iobData.iob || 0,
          activity: iobData.activity || 0,
          basaliob: iobData.basaliob || 0,
          bolusiob: iobData.bolusiob || 0,
          pumpBasalIOB: pumpBasalIOB, // Add this line
          time: now.toISOString(), // Add this line
          timestamp: now.toISOString()
        },
        suggested: {
          timestamp: now.toISOString(),
          temp: "absolute",
          bg: currentBG,
          eventualBG: recommendations.eventualBG,
          reason: recommendations.reason,
          rate: recommendations.rate,
          duration: recommendations.duration,
          COB: this.data.monitor.meal.mealCOB,
          IOB: iobData.iob,
          predBGs: recommendations.predBGs || {}
        },
        enacted: {
          timestamp: now.toISOString(),
          rate: recommendations.rate,
          duration: recommendations.duration,
          bg: currentBG,
          reason: recommendations.reason,
          eventualBG: recommendations.eventualBG,
          enacted: true,
          received: true
        },
        version: "0.7.1"
      },
      created_at: now.toISOString()
    };
  }

  async runCycle() {
    const cycleStartTime = new Date();
    console.log('=== START OF LOOP CYCLE ===');
    console.log('Cycle Start Time:', cycleStartTime.toISOString());
    
    try {
      // 1. Update clock
      this.data.monitor.clock = new Date().toISOString();
      
      // 2. Fetch fresh data from Nightscout
      await this.fetchCGMData();
      await this.fetchPumpHistory();
      
      // 3. Calculate meal data directly
      this.calculateMeal();
      
      // 4. Calculate IOB directly
      this.calculateIOB();
      
      // 5. Determine basal recommendations
      const recommendations = this.determineBasal();
      
      // 6. Enact treatments & upload to Nightscout
      await this.enactTreatments(recommendations);
      
      const cycleEndTime = new Date();
      console.log('Cycle End Time:', cycleEndTime.toISOString());
      console.log('Cycle Duration:', (cycleEndTime - cycleStartTime) / 1000, 'seconds');
      console.log('=== END OF LOOP CYCLE ===');
      
      return recommendations;
    } catch (error) {
      console.error('Error in loop cycle:', error);
      return null;
    }
  }

  async start() {
    if (this.running) return;
    
    console.log('Starting in-memory loop...');
    this.running = true;
    
    // Initialize the loop
    await this.initialize();
    
    // Run the first cycle immediately
    await this.runCycle();
    
    // Schedule recurring cycles (every 5 minutes)
    this.loopInterval = setInterval(async () => {
      await this.runCycle();
    }, 5 * 60 * 1000);
  }

  stop() {
    if (!this.running) return;
    
    clearInterval(this.loopInterval);
    this.running = false;
    console.log('Loop stopped');
  }
}

module.exports = InMemoryLoop;