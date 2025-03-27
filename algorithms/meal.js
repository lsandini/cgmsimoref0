// algorithms/meal.js
const findMealInputs = require('oref0/lib/meal/history');
const generateMeal = require('oref0/lib/meal');
const logger = require('../utils/logger');

/**
 * Creates functions for meal data calculations
 * @returns {Object} - Functions for calculating meal-related metrics
 */
function createMealCalculations() {
  /**
   * Calculate meal data including COB
   * @param {Object} data - Current data
   * @param {Array} data.pumpHistory - Pump history records
   * @param {Array} data.glucose - Glucose readings
   * @param {Object} data.profile - OpenAPS profile
   * @param {Array} data.basalProfile - Basal profile
   * @param {Array} data.carbHistory - Carb history records
   * @returns {Object} - Meal data including COB
   */
  function calculateMeal(data) {
    try {
      logger.debug('Calculating meal data...');
      
      // Validate required inputs
      if (!data.pumpHistory || !Array.isArray(data.pumpHistory)) {
        logger.warn('Missing or invalid pump history, returning zero COB');
        return createDefaultMeal();
      }
      
      if (!data.glucose || !Array.isArray(data.glucose) || data.glucose.length === 0) {
        logger.warn('Missing or invalid glucose data, returning zero COB');
        return createDefaultMeal();
      }
      
      if (!data.profile) {
        logger.warn('Missing profile, returning zero COB');
        return createDefaultMeal();
      }
      
      // Structure inputs exactly as the oref0-meal.js command expects
      const inputs = {
        history: data.pumpHistory,
        profile: data.profile,
        clock: new Date().toISOString(),
        glucose: data.glucose,
        basalprofile: data.basalProfile || data.profile.basalprofile,
        carbs: data.carbHistory || []
      };
      
      // Find treatments using meal history module
      const treatments = findMealInputs(inputs);
      logger.debug(`Found ${treatments.length} meal inputs`);
      
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
      
      if (duplicateCount > 0) {
        logger.debug(`Found ${duplicateCount} duplicate meal entries`);
      }
      
      // Generate meal data using the oref0 library function
      const mealData = generateMeal(inputs);
      
      // Log the results
      logger.info('Meal data calculated:', {
        carbs: mealData.carbs,
        COB: mealData.mealCOB,
        lastCarbTime: mealData.lastCarbTime ? 
          new Date(mealData.lastCarbTime).toISOString() : 'N/A'
      });
      
      return mealData;
    } catch (error) {
      logger.error('Error calculating meal data', error);
      return createDefaultMeal();
    }
  }

  /**
   * Create default meal data with zero values
   * @returns {Object} - Default meal data
   */
  function createDefaultMeal() {
    logger.warn('Using default meal data with zero COB');
    
    return {
      carbs: 0,
      nsCarbs: 0,
      bwCarbs: 0,
      journalCarbs: 0,
      mealCOB: 0,
      currentDeviation: 0,
      maxDeviation: 0,
      minDeviation: 0,
      lastCarbTime: 0
    };
  }

  return {
    calculateMeal,
    createDefaultMeal
  };
}

module.exports = { createMealCalculations };