// algorithms/insulin.js
const generate = require('oref0/lib/iob');
const logger = require('../utils/logger');

/**
 * Creates functions for insulin-related calculations
 * @returns {Object} - Functions for calculating IOB and related metrics
 */
function createInsulinCalculations() {
  /**
   * Calculate IOB from pump history
   * @param {Object} data - Current data 
   * @param {Array} data.pumpHistory - Pump history records
   * @param {Object} data.profile - OpenAPS profile
   * @returns {Array} - Array of IOB data objects
   */
  function calculateIOB(data) {
    try {
      logger.debug('Calculating IOB from pump history');
      
      if (!data.pumpHistory || !Array.isArray(data.pumpHistory)) {
        logger.warn('Missing or invalid pump history, returning zero IOB');
        return createDefaultIOB();
      }

      if (!data.profile) {
        logger.warn('Missing profile, returning zero IOB');
        return createDefaultIOB();
      }
      
      // Log basal settings for debugging
      logger.debug('Profile basal settings:', {
        current_basal: data.profile.current_basal,
        max_daily_basal: data.profile.max_daily_basal,
        basalprofile: data.profile.basalprofile ? 
          `${data.profile.basalprofile.length} entries` : 'undefined'
      });
  
      // Create a copy for the 24 hour history
      const pumphistory24 = [...data.pumpHistory]; 
      
      // Format clock exactly as the original implementation would
      const now = new Date();
      const clockTime = now.toISOString();
      
      // Set up inputs exactly as oref0-calculate-iob would
      const inputs = {
        history: data.pumpHistory,
        history24: pumphistory24,
        profile: data.profile,
        clock: clockTime
      };
      
      // Log the inputs for debugging
      logger.debug('IOB Calculation Inputs:', {
        clock: inputs.clock,
        historyCount: inputs.history.length,
        history24Count: inputs.history24?.length || 0,
        autosensRatio: data.autosens?.ratio || "undefined"
      });
      
      // Add autosens data if available
      if (data.autosens) {
        inputs.autosens = data.autosens;
      }
      
      // Generate IOB using the full calculation chain
      const iobData = generate(inputs);
      
      // Log the result for debugging
      if (iobData.length > 0) {
        logger.debug('IOB Calculation Result:', {
          iob: iobData[0].iob,
          basaliob: iobData[0].basaliob,
          bolusiob: iobData[0].bolusiob,
          netbasalinsulin: iobData[0].netbasalinsulin,
          bolusinsulin: iobData[0].bolusinsulin,
          time_diff_minutes: Math.round((new Date() - new Date(iobData[0].time)) / 60000)
        });
        
        // Add additional fields for OpenAPS
        
        // Find the most recent bolus for lastBolusTime
        const bolusEntries = data.pumpHistory.filter(entry => 
          entry._type === 'Bolus' && entry.amount > 0
        );
        
        if (bolusEntries.length > 0) {
          // Sort by date descending
          bolusEntries.sort((a, b) => {
            const dateA = a.date || new Date(a.timestamp).getTime();
            const dateB = b.date || new Date(b.timestamp).getTime();
            return dateB - dateA;
          });
          
          const lastBolusTime = bolusEntries[0].date || new Date(bolusEntries[0].timestamp).getTime();
          iobData[0].lastBolusTime = lastBolusTime;
          
          logger.debug('Last bolus info:', {
            amount: bolusEntries[0].amount,
            time: new Date(lastBolusTime).toISOString(),
            minutesAgo: Math.round((Date.now() - lastBolusTime) / 60000)
          });
        } else {
          logger.debug('No recent boluses found in pump history');
        }
        
        // Find the most recent temp basal
        const tempBasalEntries = data.pumpHistory.filter(entry => 
          entry._type === 'TempBasal'
        );
        
        if (tempBasalEntries.length > 0) {
          // Sort by date descending
          tempBasalEntries.sort((a, b) => {
            const dateA = a.date || new Date(a.timestamp).getTime();
            const dateB = b.date || new Date(b.timestamp).getTime();
            return dateB - dateA;
          });
          
          const latestTempBasal = tempBasalEntries[0];
          
          // Find corresponding duration entry exactly matching timestamp
          const durationEntry = data.pumpHistory.find(entry => 
            entry._type === 'TempBasalDuration' && 
            entry.timestamp === latestTempBasal.timestamp
          );
          
          // Format exactly as original implementation expects
          const lastTemp = {
            rate: latestTempBasal.rate || 0,
            timestamp: latestTempBasal.timestamp,
            started_at: latestTempBasal.timestamp,
            date: latestTempBasal.date || new Date(latestTempBasal.timestamp).getTime(),
            duration: durationEntry ? (durationEntry['duration (min)'] || durationEntry.duration || 30) : 30
          };
          
          iobData[0].lastTemp = lastTemp;
          
          logger.debug('Last temp basal:', {
            rate: lastTemp.rate,
            duration: lastTemp.duration,
            started: lastTemp.timestamp
          });
        } else {
          // Default lastTemp object if no temp basal found
          const now = new Date();
          const lastTemp = {
            rate: data.profile.current_basal,
            timestamp: now.toISOString(),
            started_at: now.toISOString(),
            date: now.getTime(),
            duration: 0
          };
          
          iobData[0].lastTemp = lastTemp;
          logger.debug('No recent temp basals, using profile basal');
        }
        
        // Make sure timestamp and mills fields are set
        const now = new Date();
        iobData[0].timestamp = iobData[0].timestamp || now.toISOString();
        iobData[0].mills = iobData[0].mills || now.getTime();
        
        // Ensure that iobWithZeroTemp is properly defined
        if (!iobData[0].iobWithZeroTemp || typeof iobData[0].iobWithZeroTemp.iob === 'undefined') {
          logger.debug('Recreating iobWithZeroTemp structure');
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
      
      logger.info('IOB Calculation Complete:', {
        totalIOB: iobData[0]?.iob || 0,
        basalIOB: iobData[0]?.basaliob || 0,
        bolusIOB: iobData[0]?.bolusiob || 0
      });
      
      return iobData;
    } catch (error) {
      logger.error('Error calculating IOB', error);
      return createDefaultIOB();
    }
  }

  /**
   * Create default IOB data with zero values
   * @returns {Array} - Default IOB data array
   */
  function createDefaultIOB() {
    const now = new Date();
    const mills = now.getTime();
    const timeString = now.toISOString();
    
    logger.warn('Using default IOB with zero values');
    
    return [{
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
        rate: 0.7, // Default basal rate
        timestamp: timeString,
        started_at: timeString,
        date: mills,
        duration: 0
      },
      timestamp: timeString,
      mills: mills
    }];
  }

  return {
    calculateIOB,
    createDefaultIOB
  };
}

module.exports = { createInsulinCalculations };