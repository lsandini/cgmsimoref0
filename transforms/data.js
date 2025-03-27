// transforms/data.js
const logger = require('../utils/logger');

/**
 * Creates functions for transforming data between Nightscout and OpenAPS formats
 * @returns {Object} - Data transformation functions
 */
function createDataTransforms() {
  /**
   * Transform Nightscout CGM entries to the format expected by OpenAPS
   * @param {Array} entries - Raw Nightscout CGM entries
   * @returns {Array} - Formatted CGM data
   */
  function formatCGMData(entries) {
    if (!entries || !Array.isArray(entries)) {
      logger.warn('Invalid CGM entries data received');
      return [];
    }
    
    logger.debug(`Formatting ${entries.length} CGM entries`);
    
    // Convert to format expected by oref0 and mark as fakecgm
    return entries.map(entry => ({
      sgv: entry.sgv,
      date: entry.date,
      dateString: entry.dateString,
      direction: entry.direction,
      type: entry.type || 'sgv',
      device: "fakecgm" // Add this to bypass the flat CGM check
    }));
  }

  /**
   * Transform Nightscout treatments to pump history format expected by OpenAPS
   * @param {Array} treatments - Raw Nightscout treatments
   * @param {number} hoursBack - Number of hours to look back
   * @returns {Object} - Object with pumpHistory and carbHistory arrays
   */
  function formatPumpHistory(treatments, hoursBack = 24) {
    if (!treatments || !Array.isArray(treatments)) {
      logger.warn('Invalid treatments data received');
      return { pumpHistory: [], carbHistory: [] };
    }
    
    logger.debug(`Formatting ${treatments.length} treatments into pump history`);
    
    // Filter to the specified hours only
    const timeBack = new Date();
    timeBack.setHours(timeBack.getHours() - hoursBack);
    const recentTreatments = treatments.filter(t => new Date(t.created_at) >= timeBack);
    
    logger.debug(`Found ${recentTreatments.length} treatments in the last ${hoursBack} hours`);

    // Convert Nightscout treatments to pump history format
    const pumpHistory = [];
    const carbHistory = [];

    recentTreatments.forEach(treatment => {
      const timestamp = treatment.created_at || treatment.timestamp || new Date().toISOString();
      const dateNum = new Date(timestamp).getTime();

      // Convert bolus treatments
      if (treatment.insulin && 
          (treatment.eventType === 'Bolus' || 
           treatment.eventType === 'Meal Bolus' || 
           treatment.eventType === 'Snack Bolus' || 
           treatment.eventType === 'Correction Bolus' || 
           treatment.eventType === 'SMB')) {
        
        pumpHistory.push({
          _type: 'Bolus',
          timestamp: timestamp,
          amount: parseFloat(treatment.insulin),
          programmed: parseFloat(treatment.insulin),
          unabsorbed: 0,
          duration: 0,
          date: dateNum
        });
      }
    
      // Convert temp basals
      if (treatment.eventType === 'Temp Basal') {
        // TempBasal entry
        pumpHistory.push({
          _type: 'TempBasal',
          timestamp: timestamp,
          rate: parseFloat(treatment.rate || treatment.absolute),
          temp: 'absolute',
          date: dateNum
        });

        // TempBasalDuration entry
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
          _type: 'Meal',
          timestamp: timestamp,
          carbs: parseInt(treatment.carbs),
          created_at: timestamp,
          date: dateNum
        };

        pumpHistory.push(carbEntry);
        carbHistory.push(carbEntry);
      }
    });
    
    logger.debug(`Converted ${pumpHistory.length} pump history records and ${carbHistory.length} carb entries`);
    
    return {
      pumpHistory,
      carbHistory
    };
  }

  return {
    formatCGMData,
    formatPumpHistory
  };
}

module.exports = { createDataTransforms };