// algorithms/meal.js
const { logger } = require('../utils/logger');

/**
 * Calculate meal data including Carbs on Board (COB)
 * @param {Object} state - Current loop state
 * @returns {Object} - Meal data including COB
 */
const calculateMeal = (state) => {
  try {
    logger.info('Calculating meal data');
    
    // Import oref0 meal modules
    const findMealInputs = require('oref0/lib/meal/history');
    const generateMeal = require('oref0/lib/meal');
    
    // Structure inputs exactly as the oref0-meal.js command expects
    const inputs = {
      history: state.pumpHistory,
      profile: state.profile,
      clock: state.clock || new Date().toISOString(),
      glucose: state.glucose,
      basalprofile: state.profile.basalprofile,
      carbs: filterCarbHistory(state.pumpHistory)
    };
    
    // Find treatments using meal history module
    const treatments = findMealInputs(inputs);
    logger.debug('Meal Inputs:', { count: treatments.length });
    
    // Check for duplicate entries
    checkForDuplicates(treatments);
    
    // Generate meal data using the oref0 library function
    const mealData = generateMeal(inputs);
    
    logger.info('Meal data calculated', {
      carbs: mealData.carbs,
      COB: mealData.mealCOB,
      lastCarbTime: mealData.lastCarbTime ? 
        new Date(mealData.lastCarbTime).toISOString() : 'N/A'
    });
    
    return mealData;
  } catch (error) {
    logger.error('Error calculating meal data:', error);
    
    // Return a safe default if calculation fails
    return createDefaultMeal();
  }
};

/**
 * Filter pump history to extract only carb entries
 * @param {Array} pumpHistory - Pump history data
 * @returns {Array} - Carb entries
 */
const filterCarbHistory = (pumpHistory) => {
  return pumpHistory.filter(entry => 
    entry._type === 'Meal' || (entry.carbs && entry.carbs > 0)
  );
};

/**
 * Check for and log duplicate treatment entries
 * @param {Array} treatments - Treatment entries
 */
const checkForDuplicates = (treatments) => {
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
    logger.warn(`Found ${duplicateCount} duplicate treatment entries`);
  }
};

/**
 * Create default meal data with safe values
 * @returns {Object} - Default meal data
 */
const createDefaultMeal = () => {
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
};

module.exports = {
  calculateMeal
};
