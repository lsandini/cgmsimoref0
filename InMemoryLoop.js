const tempBasalFunctions = require('oref0/lib/basal-set-temp');
const determine_basal = require('oref0/lib/determine-basal/determine-basal');
const getLastGlucose = require('oref0/lib/glucose-get-last');
const iob = require('oref0/lib/iob');
const getMealData = require('oref0/lib/meal/total');
const NightscoutClient = require('./nightscout');
const findMealInputs = require('oref0/lib/meal/history');
const generateMeal = require('oref0/lib/meal');

// Default profile settings at the top of the file for easy access and modification
const DEFAULT_PROFILE = {
  // Type designation
  type: "current",
  
  // Insulin parameters
  dia: 6,
  curve: "ultra-rapid",
  useCustomPeakTime: false,
  insulinPeakTime: 75,
  
  // Basal settings - SINGLE VALUE, not array
  current_basal: 0.7,
  max_daily_basal: 1.0,
  
  // Sensitivity - SINGLE VALUE, not array
  sens: 36,
  
  // Carb ratio - SINGLE VALUE, not array
  carb_ratio: 10,
  
  // Target BG values - SINGLE VALUES, not arrays
  min_bg: 100,
  max_bg: 100,
  
  // Safety parameters
  max_iob: 6,
  max_basal: 4,
  max_daily_safety_multiplier: 3,
  current_basal_safety_multiplier: 4,
  
  // Autosens settings
  autosens_max: 2,
  autosens_min: 0.5,
  
  // SMB parameters
  enableUAM: true,
  enableSMB_always: true,
  enableSMB_with_bolus: true,
  enableSMB_with_COB: true,
  enableSMB_with_temptarget: false,
  enableSMB_after_carbs: true,
  maxSMBBasalMinutes: 75,
  maxUAMSMBBasalMinutes: 30,
  
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
        sensitivity: 36,
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
        autosens: { ratio: 0.78 }
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
      
      if (!profile) {
        console.error("No profile found in Nightscout profile store");
        return;
      }
      
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
          console.log("Original ISF from Nightscout (mmol/L):", sens);
          // Store the value in mg/dL for internal use
          sens = sens * 18; // Convert from mmol/L to mg/dL
          console.log("Converted ISF for OpenAPS (mg/dL):", sens);
        } else {
          console.log("Using ISF directly (already in mg/dL):", sens);
        }
      }

      // Set the ISF directly - don't convert again later
      this.data.settings.profile.sens = sens;
      
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
      
      // Update profile with extracted values
      this.data.settings.profile.dia = Number(dia || this.profileSettings.dia);
      this.data.settings.profile.current_basal = Number(current_basal || this.profileSettings.current_basal);
      this.data.settings.profile.isfProfile.sensitivities.forEach(entry => {
        entry.sensitivity = sens; // Use the converted value for all sensitivity entries
      });
      this.data.settings.profile.carb_ratio = Number(carb_ratio || this.profileSettings.carb_ratio);
      
      // Set min_bg and max_bg
      if (min_bg !== null && max_bg !== null) {
        this.data.settings.profile.min_bg = Number(min_bg);
        this.data.settings.profile.max_bg = Number(max_bg);
      }
      
      // Force internal calculations to display in mg/dL
      this.data.settings.profile.out_units = "mg/dL";
      
      // Create proper nested structures required by determine_basal
      
      // Create basalprofile
      this.data.settings.profile.basalprofile = [];
      if (Array.isArray(profile.basal)) {
        profile.basal.forEach((entry, index) => {
          this.data.settings.profile.basalprofile.push({
            i: index,
            start: entry.time + ":00",
            minutes: entry.timeAsSeconds / 60,
            rate: entry.value
          });
        });
      } else {
        // Default profile if none exists
        this.data.settings.profile.basalprofile = [
          {
            i: 0,
            start: "00:00:00",
            minutes: 0,
            rate: this.data.settings.profile.current_basal
          }
        ];
      }
      
      // Create isfProfile in the expected format
      this.data.settings.profile.isfProfile = {
        units: "mg/dL",
        user_preferred_units: profile.units === "mmol" ? "mmol/L" : "mg/dL",
        sensitivities: []
      };
      
      if (Array.isArray(profile.sens)) {
        profile.sens.forEach((entry, index) => {
          // Already converted above, use directly
          const sensitivity = sens;
          
          this.data.settings.profile.isfProfile.sensitivities.push({
            i: index,
            x: index,
            sensitivity: sensitivity,
            offset: entry.timeAsSeconds / 60,
            start: entry.time + ":00",
            endOffset: index < profile.sens.length - 1 ? 
              (profile.sens[index + 1].timeAsSeconds / 60) : 1440
          });
        });
      } else {
        // Default sensitivity if none exists
        this.data.settings.profile.isfProfile.sensitivities = [
          {
            i: 0,
            x: 0,
            sensitivity: this.data.settings.profile.sens,
            offset: 0,
            start: "00:00:00",
            endOffset: 1440
          }
        ];
      }
      
      // Create bg_targets in the expected format
      this.data.settings.profile.bg_targets = {
        units: "mg/dL",
        user_preferred_units: profile.units === "mmol" ? "mmol/L" : "mg/dL",
        targets: []
      };
      
      if (Array.isArray(profile.target_low) && Array.isArray(profile.target_high)) {
        // Assuming target_low and target_high have the same length and times
        profile.target_low.forEach((entry, index) => {
          // Convert mmol values to mg/dL for targets if needed
          const low = profile.units === "mmol" ? entry.value * 18 : entry.value;
          const high = profile.units === "mmol" ? profile.target_high[index].value * 18 : profile.target_high[index].value;
          
          this.data.settings.profile.bg_targets.targets.push({
            i: index,
            x: index, // x is used for plotting
            high: high,
            start: entry.time + ":00",
            low: low,
            offset: entry.timeAsSeconds / 60,
            max_bg: high,
            min_bg: low
          });
        });
      } else {
        // Default targets if none exist
        this.data.settings.profile.bg_targets.targets = [
          {
            i: 0,
            x: 0,
            high: this.data.settings.profile.max_bg,
            start: "00:00:00",
            low: this.data.settings.profile.min_bg,
            offset: 0,
            max_bg: this.data.settings.profile.max_bg,
            min_bg: this.data.settings.profile.min_bg
          }
        ];
      }
      
      // Create carb_ratios in the expected format
      this.data.settings.profile.carb_ratios = {
        units: "grams",
        schedule: []
      };
      
      if (Array.isArray(profile.carbratio)) {
        profile.carbratio.forEach((entry, index) => {
          this.data.settings.profile.carb_ratios.schedule.push({
            x: index,
            i: index,
            start: entry.time + ":00",
            offset: entry.timeAsSeconds / 60,
            ratio: entry.value,
            r: entry.value // Some versions of OpenAPS use 'r' instead of 'ratio'
          });
        });
      } else {
        // Default carb ratio if none exists
        this.data.settings.profile.carb_ratios.schedule = [
          {
            x: 0,
            i: 0,
            start: "00:00:00",
            offset: 0,
            ratio: this.data.settings.profile.carb_ratio,
            r: this.data.settings.profile.carb_ratio
          }
        ];
      }

      // Ensure basal profile is in the exact format expected
      if (this.data.settings.profile.basalprofile && this.data.settings.profile.basalprofile.length > 0) {
        console.log("Ensuring basal profile is in correct format for IOB calculations");
        
        // Make sure each entry has the right properties
        this.data.settings.profile.basalprofile.forEach(entry => {
          // Ensure all required properties exist
          entry.i = entry.i || 0;
          entry.start = entry.start || "00:00:00";
          entry.minutes = entry.minutes || 0;
          entry.rate = parseFloat(entry.rate);
        });
        
        // Sort by minutes
        this.data.settings.profile.basalprofile.sort((a, b) => a.minutes - b.minutes);
      }

      // Log critical profile settings for IOB calculation
      console.log("Profile values used for IOB:", {
        dia: this.data.settings.profile.dia,
        current_basal: this.data.settings.profile.current_basal,
        basal_profile_count: this.data.settings.profile.basalprofile?.length || 0,
        curve: this.data.settings.profile.curve,
        useCustomPeakTime: this.data.settings.profile.useCustomPeakTime,
        insulinPeakTime: this.data.settings.profile.insulinPeakTime
      });
      
      console.log('Profile updated correctly from Nightscout:');
      console.log('- dia:', this.data.settings.profile.dia);
      console.log('- current_basal:', this.data.settings.profile.current_basal);
      console.log('- sens:', this.data.settings.profile.sens);
      console.log('- carb_ratio:', this.data.settings.profile.carb_ratio);
      console.log('- min_bg:', this.data.settings.profile.min_bg);
      console.log('- max_bg:', this.data.settings.profile.max_bg);
      console.log('- out_units:', this.data.settings.profile.out_units);
      console.log('- ISF extracted from profile:', this.data.settings.profile.sens, 'mg/dL per U');
    } catch (error) {
      console.error('Error updating profile from Nightscout:', error);
    }
  }

  async fetchCGMData() {
    try {
      const entries = await this.nightscout.getEntries();
      
      // Convert to format expected by oref0 and mark as fakecgm
      this.data.monitor.glucose = entries.map(entry => ({
        sgv: entry.sgv,
        date: entry.date,
        dateString: entry.dateString,
        direction: entry.direction,
        type: entry.type || 'sgv',
        device: "fakecgm" // Add this to bypass the flat CGM check
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
  
        // Convert bolus treatments - match format exactly
        if (treatment.insulin && treatment.eventType === 'Bolus') {
          pumpHistory.push({
            _type: 'Bolus',
            timestamp: timestamp,
            amount: parseFloat(treatment.insulin),
            programmed: parseFloat(treatment.insulin), // Add this field
            unabsorbed: 0, // Add this field
            duration: 0, // Add this field
            date: dateNum
          });
        }
  
        // Convert temp basals - match format exactly
        if (treatment.eventType === 'Temp Basal') {
          // TempBasal entry
          pumpHistory.push({
            _type: 'TempBasal',
            timestamp: timestamp,
            rate: parseFloat(treatment.rate || treatment.absolute),
            temp: 'absolute', // Ensure this is consistent
            date: dateNum
          });
  
          // TempBasalDuration entry with specific format
          pumpHistory.push({
            _type: 'TempBasalDuration',
            timestamp: timestamp,
            'duration (min)': parseInt(treatment.duration), // Must use this exact property name
            date: dateNum
          });
        }
  
        // Convert carb entries - match format exactly
        if (treatment.carbs) {
          const carbEntry = {
            _type: 'Meal', // This might need to be different
            timestamp: timestamp,
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
      console.log('Calculating meal data...');
      
      // Structure inputs exactly as the oref0-meal.js command expects
      const inputs = {
        history: this.data.monitor.pumphistory,
        profile: this.data.settings.profile,
        clock: this.data.monitor.clock,
        glucose: this.data.monitor.glucose,
        basalprofile: this.data.settings.basal_profile,
        carbs: this.data.monitor.carbhistory
      };
      
      // Find treatments using meal history module
      const treatments = findMealInputs(inputs);
      console.log('Custom Meal Inputs:', treatments);
      
      // Count duplicate entries
      const uniqueTimestamps = new Set();
      let duplicateCount = 0;
      
      treatments.forEach(t => {
        if (uniqueTimestamps.has(t.timestamp)) {
          duplicateCount++;
        } else {
          uniqueTimestamps.add(t.timestamp);
        }
      });
      
      console.log(`Found ${duplicateCount} duplicate entries`);
      
      // Generate meal data using the oref0 library function
      const mealData = generateMeal(inputs);
      
      // Store results
      this.data.monitor.meal = mealData;
      
      console.log('Meal data calculated:', {
        carbs: mealData.carbs,
        COB: mealData.mealCOB,
        lastCarbTime: mealData.lastCarbTime ? 
          new Date(mealData.lastCarbTime).toISOString() : 'N/A'
      });
      
      return mealData;
    } catch (error) {
      console.error('Error calculating meal data:', error);
      console.error('Error stack:', error.stack);
      
      // Return a safe default if calculation fails
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
      // Profile basal settings logging
      console.log("Profile basal settings:", {
        current_basal: this.data.settings.profile.current_basal,
        max_daily_basal: this.data.settings.profile.max_daily_basal,
        basalprofile: this.data.settings.profile.basalprofile
      });
  
      // Import the full OpenAPS IOB calculation chain
      const generate = require('oref0/lib/iob');
      
      // Create a copy for the 24 hour history
      const pumphistory24 = [...this.data.monitor.pumphistory]; 
      
      // Format clock exactly as the original implementation would
      const now = new Date();
      const clockTime = now.toISOString(); // Ensure UTC timestamps
      
      // Set up inputs exactly as oref0-calculate-iob would
      const inputs = {
        history: this.data.monitor.pumphistory,
        history24: pumphistory24, // Add 24-hour history
        profile: this.data.settings.profile,
        clock: clockTime
      };
      
      // Log the exact inputs
      console.log("IOB Calculation Inputs:", {
        clock: inputs.clock,
        historyCount: inputs.history.length,
        history24Count: inputs.history24?.length || 0,
        autosensRatio: inputs.autosens?.ratio || "undefined"
      });
      
      // Add autosens data if available
      if (this.data.settings.autosens) {
        inputs.autosens = this.data.settings.autosens;
      }
      
      // Generate IOB using the full calculation chain
      const iobData = generate(inputs);
      
      // Log the raw result for debugging
      console.log('Raw IOB calculation result from generate():', 
        iobData.length > 0 ? JSON.stringify(iobData[0]) : 'No IOB data'
      );
      
      // Add detailed logging for IOB calculation
      if (iobData.length > 0) {
        console.log("IOB Calculation Details:", {
          iob: iobData[0].iob,
          basaliob: iobData[0].basaliob,
          bolusiob: iobData[0].bolusiob,
          netbasalinsulin: iobData[0].netbasalinsulin,
          bolusinsulin: iobData[0].bolusinsulin,
          time_diff_minutes: Math.round((new Date() - new Date(iobData[0].time)) / 60000)
        });
        
        // Add any additional fields your system needs
        // Find the most recent bolus for lastBolusTime
        const bolusEntries = this.data.monitor.pumphistory.filter(entry => 
          entry._type === 'Bolus' && entry.amount > 0
        );
        
        let lastBolusTime = 0;
        if (bolusEntries.length > 0) {
          // Sort by date descending
          bolusEntries.sort((a, b) => {
            const dateA = a.date || new Date(a.timestamp).getTime();
            const dateB = b.date || new Date(b.timestamp).getTime();
            return dateB - dateA;
          });
          lastBolusTime = bolusEntries[0].date || new Date(bolusEntries[0].timestamp).getTime();
          iobData[0].lastBolusTime = lastBolusTime;
          
          // Log bolus info for debugging
          console.log(`Last bolus: ${bolusEntries[0].amount}U at ${new Date(lastBolusTime).toISOString()}`);
          console.log(`Minutes since last bolus: ${Math.round((Date.now() - lastBolusTime) / 60000)}`);
        } else {
          console.log('No recent boluses found in pump history');
        }
        
        // Find the most recent temp basal
        const tempBasalEntries = this.data.monitor.pumphistory.filter(entry => 
          entry._type === 'TempBasal'
        );
        
        // Log recent temp basals for debugging
        if (tempBasalEntries.length > 0) {
          console.log("Recent temp basals:", tempBasalEntries.slice(0, 3).map(t => ({
            rate: t.rate,
            timestamp: t.timestamp,
            duration: t.duration || "unknown"
          })));
        }
        
        let lastTemp = null;
        if (tempBasalEntries.length > 0) {
          // Sort by date descending
          tempBasalEntries.sort((a, b) => {
            const dateA = a.date || new Date(a.timestamp).getTime();
            const dateB = b.date || new Date(b.timestamp).getTime();
            return dateB - dateA;
          });
          const latestTempBasal = tempBasalEntries[0];
          
          // Find corresponding duration entry exactly matching timestamp
          const durationEntry = this.data.monitor.pumphistory.find(entry => 
            entry._type === 'TempBasalDuration' && 
            entry.timestamp === latestTempBasal.timestamp
          );
          
          // Format exactly as original implementation expects
          lastTemp = {
            rate: latestTempBasal.rate || 0,
            timestamp: latestTempBasal.timestamp,
            started_at: latestTempBasal.timestamp, // Make sure these match exactly
            date: latestTempBasal.date || new Date(latestTempBasal.timestamp).getTime(),
            duration: durationEntry ? (durationEntry['duration (min)'] || durationEntry.duration || 30) : 30
          };
          
          iobData[0].lastTemp = lastTemp;
        } else {
          // Default lastTemp object if no temp basal found
          const now = new Date();
          lastTemp = {
            rate: this.data.settings.profile.current_basal,
            timestamp: now.toISOString(),
            started_at: now.toISOString(),
            date: now.getTime(),
            duration: 0
          };
          
          iobData[0].lastTemp = lastTemp;
        }
        
        // Make sure timestamp and mills fields are set
        const now = new Date();
        iobData[0].timestamp = iobData[0].timestamp || now.toISOString();
        iobData[0].mills = iobData[0].mills || now.getTime();
        
        // Ensure that iobWithZeroTemp is properly defined
        if (!iobData[0].iobWithZeroTemp || typeof iobData[0].iobWithZeroTemp.iob === 'undefined') {
          console.log("Recreating iobWithZeroTemp structure");
          iobData[0].iobWithZeroTemp = {
            iob: iobData[0].iob,
            activity: iobData[0].activity,
            basaliob: iobData[0].basaliob,
            bolusiob: iobData[0].bolusiob,
            netbasalinsulin: iobData[0].netbasalinsulin || 0,
            bolusinsulin: iobData[0].bolusinsulin || 0,
            time: iobData[0].time
          };
        }
      }
      
      this.data.monitor.iob = iobData;
      
      console.log('IOB Breakdown:', {
        totalIOB: iobData[0]?.iob || 0,
        basalIOB: iobData[0]?.basaliob || 0,
        bolusIOB: iobData[0]?.bolusiob || 0,
        netBasalInsulin: iobData[0]?.netbasalinsulin || 0,
        zeroTempIOB: iobData[0]?.iobWithZeroTemp?.iob || 0,
        historyWindow: "24 hours"
      });
      
      return iobData;
    } catch (error) {
      console.error('Error calculating IOB:', error);
      
      // Return a safe default with all required fields
      const now = new Date();
      const mills = now.getTime();
      const timeString = now.toISOString();
      
      const safeDefault = [{
        iob: 0,
        activity: 0,
        basaliob: 0,
        bolusiob: 0,
        netbasalinsulin: 0,
        bolusinsulin: 0,
        pumpBasalIOB: 0,
        time: timeString,
        iobWithZeroTemp: {
          iob: 0,
          activity: 0,
          basaliob: 0,
          bolusiob: 0,
          netbasalinsulin: 0,
          bolusinsulin: 0,
          time: timeString
        },
        lastBolusTime: 0,
        lastTemp: {
          rate: this.data.settings.profile.current_basal,
          timestamp: timeString,
          started_at: timeString,
          date: mills,
          duration: 0
        },
        timestamp: timeString,
        mills: mills
      }];
      
      this.data.monitor.iob = safeDefault;
      return safeDefault;
    }
  }

  // Helper method to create default recommendation
  getDefaultRecommendation() {
    return {
      reason: "Error in determine-basal algorithm. Using safe defaults.",
      rate: this.data.settings.profile.current_basal,
      duration: 0,
      temp: "absolute",
      deliverAt: new Date(),
      eventualBG: this.data.monitor.glucose[0]?.sgv || 120
    };
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
      const profile = this.data.settings.profile;
      
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
        ratio: 0.78
      };
      
      console.log(`Determine Basal Input - BG: ${bg}, IOB: ${iob_data[0].iob}, COB: ${meal_data.mealCOB}`);

      console.log("Pre-determine_basal - Effective ISF:", {
        profileSens: profile.sens,
        firstSensitivity: profile.isfProfile.sensitivities[0].sensitivity,
        autosensRatio: autosens_data.ratio,
        effectiveISF: profile.sens * autosens_data.ratio
      });

      // Ensure SMB settings are properly set before calling determine_basal
      console.log("SMB settings check:", {
        enableSMB_always: profile.enableSMB_always,
        enableSMB_with_COB: profile.enableSMB_with_COB,
        enableUAM: profile.enableUAM
      });

      // If not already set in the profile, ensure they're enabled:
      profile.enableSMB_always = true;
      profile.enableSMB_with_COB = true; 
      profile.enableUAM = true;
      
      // Call determine-basal with all required inputs
      const determineBasalResult = determine_basal(
        glucose_status,
        temp,
        iob_data,
        profile,
        autosens_data,
        meal_data,
        tempBasalFunctions,
        true
      );

      console.log("Raw determine_basal result ISF:", {
        isfInResult: determineBasalResult.ISF,
        typeOfISF: typeof determineBasalResult.ISF,
        valueInMgDl: determineBasalResult.ISF
      });

      if (determineBasalResult && profile.out_units === "mmol/L") {
        // Store the original ISF value before it gets converted to a string
        determineBasalResult.ISF_mgdl = determineBasalResult.ISF ? 
          (parseFloat(determineBasalResult.ISF) * 18).toFixed(1) : null;
        
        console.log("Preserving ISF in mg/dL:", {
          displayISF: determineBasalResult.ISF,
          internalISF_mgdl: determineBasalResult.ISF_mgdl
        });
      }
      
      // Ensure we have required fields
      if (!determineBasalResult) {
        console.error("determine-basal returned null");
        return this.getDefaultRecommendation();
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
        const eventualBGMatch = determineBasalResult.reason.match(/eventualBG (\d+)/);
        if (eventualBGMatch && eventualBGMatch[1]) {
          determineBasalResult.eventualBG = parseInt(eventualBGMatch[1]);
        } else {
          // Default to current BG if we can't extract it
          determineBasalResult.eventualBG = glucose_status.glucose;
        }
      }
      
      console.log('Determine Basal Result:', {
        rate: determineBasalResult.rate,
        duration: determineBasalResult.duration,
        reason: determineBasalResult.reason,
        eventualBG: determineBasalResult.eventualBG
      });

          
    // Log prediction data to see what's being returned
    console.log("Predictions from determine_basal:", determineBasalResult.predBGs);
    console.log("Keys in predBGs:", determineBasalResult.predBGs ? Object.keys(determineBasalResult.predBGs) : "none");
    
    if (determineBasalResult.predBGs) {
      // If we have IOB predictions, log the first and last values
      if (determineBasalResult.predBGs.IOB) {
        console.log("IOB predictions length:", determineBasalResult.predBGs.IOB.length);
        console.log("IOB predictions first:", determineBasalResult.predBGs.IOB[0]);
        console.log("IOB predictions last:", determineBasalResult.predBGs.IOB[determineBasalResult.predBGs.IOB.length-1]);
      }
      
      // If we have ZT predictions, log the first and last values
      if (determineBasalResult.predBGs.ZT) {
        console.log("ZT predictions length:", determineBasalResult.predBGs.ZT.length);
        console.log("ZT predictions first:", determineBasalResult.predBGs.ZT[0]);
        console.log("ZT predictions last:", determineBasalResult.predBGs.ZT[determineBasalResult.predBGs.ZT.length-1]);
      }
    }
    
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
      return this.getDefaultRecommendation();
    }
  }

  async enactTreatments(recommendations) {
    console.log('Enacting treatments...');
    
    try {
      // Ensure recommendations has valid properties
      const safeRecommendations = {
        ...recommendations,
        rate: recommendations.rate !== undefined ? 
          recommendations.rate : this.data.settings.profile.current_basal,
        duration: recommendations.duration !== undefined ? 
          recommendations.duration : 0,
        eventualBG: recommendations.eventualBG || 
          this.data.monitor.glucose[0]?.sgv || 120
      };
      
      // Prepare enacted data
      const enactedData = { 
        ...safeRecommendations, 
        enacted: true, 
        timestamp: new Date().toISOString(),
        received: true
      };
      
      this.data.enact.enacted = enactedData;
      
      // Create and upload devicestatus
      const deviceStatus = this.createDeviceStatus(safeRecommendations);
      
      console.log('=== UPLOADING DEVICE STATUSES ===');
      console.log('Number of device statuses:', 1);
      
      // Extract all key fields first to make sure they exist before logging
      const iobObj = deviceStatus.openaps.iob;
      const basicIOBInfo = {
        totalIOB: iobObj.iob || 0,
        basalIOB: iobObj.basaliob || 0,
        bolusIOB: iobObj.bolusiob || 0,
        pumpBasalIOB: iobObj.pumpBasalIOB || 0,
        time: iobObj.time || 'undefined'
      };
      
      // Log a safe subset of the data for debugging
      console.log('Device Status 1:', {
        fullIOBObject: JSON.stringify(iobObj, null, 2),
        ...basicIOBInfo
      });
      
      const uploadResponse = await this.nightscout.uploadDeviceStatus([deviceStatus]);
      console.log('Upload Response:', uploadResponse);
      
      return enactedData;
    } catch (error) {
      console.error('Error enacting treatments:', error);
      return null;
    }
  }

  createDeviceStatus(recommendations) {
    const now = new Date();
    const mills = now.getTime();
    const timeString = now.toISOString();
    const iobData = this.data.monitor.iob[0] || {
      iob: 0,
      activity: 0,
      basaliob: 0,
      bolusiob: 0,
      time: timeString,
      timestamp: timeString,
      mills: mills
    };
    
    // Get most recent glucose reading
    const currentBG = this.data.monitor.glucose[0]?.sgv;
    
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
        rate: this.data.settings.profile.current_basal,
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
    if (this.data.monitor.glucose.length >= 2) {
      const currentBG = this.data.monitor.glucose[0].sgv;
      const prevBG = this.data.monitor.glucose[1].sgv;
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
    const COB = Math.round(this.data.monitor.meal.mealCOB || 0);
    
    // Build the complete device status object
    return {
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
          ISF: recommendations.ISF || this.data.settings.profile.sens,
          CR: recommendations.CR || this.data.settings.profile.carb_ratio,
          target_bg: recommendations.target_bg || this.data.settings.profile.min_bg,
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
        max_iob: this.data.settings.profile.max_iob || 6,
        max_daily_safety_multiplier: this.data.settings.profile.max_daily_safety_multiplier || 4,
        current_basal_safety_multiplier: this.data.settings.profile.current_basal_safety_multiplier || 5,
        autosens_max: this.data.settings.profile.autosens_max || 2,
        autosens_min: this.data.settings.profile.autosens_min || 0.7,
        rewind_resets_autosens: true,
        exercise_mode: false,
        sensitivity_raises_target: true,
        unsuspend_if_no_temp: false,
        enableSMB_always: this.data.settings.profile.enableSMB_always || true,
        enableSMB_with_COB: this.data.settings.profile.enableSMB_with_COB || true,
        enableSMB_with_temptarget: this.data.settings.profile.enableSMB_with_temptarget || false,
        enableUAM: this.data.settings.profile.enableUAM || true,
        curve: this.data.settings.profile.curve || "ultra-rapid",
        offline_hotspot: false,
        cgm: "g5-upload",
        timestamp: timeString
      },
      uploader: {
        batteryVoltage: 3861,
        battery: 68
      },
      utcOffset: 0,
      mills: mills,
      created_at: timeString
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