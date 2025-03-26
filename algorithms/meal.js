// algorithms/meal.js
const { logger } = require('../utils/logger');

/**
 * Validate and prepare inputs for meal calculation
 * @param {Object} state - Current loop state
 * @returns {Object} - Prepared inputs for meal calculation
 */
const prepareInputs = (state) => {
  // Ensure all required fields are present and valid
  const inputs = {
    history: state.pumpHistory || [],
    profile: state.profile || {},
    clock: state.clock || new Date().toISOString(),
    glucose: state.glucose || [],
    basalprofile: state.profile.basalprofile || [],
    carbs: state.carbHistory || []
  };

  // Log detailed input validation
  logger.debug('Meal Calculation Input Validation', {
    historyCount: inputs.history.length,
    profileExists: !!inputs.profile,
    glucoseCount: inputs.glucose.length,
    carbCount: inputs.carbs.length
  });

  return inputs;
};

/**
 * Calculate manual Carbs on Board
 * @param {Object} state - Current loop state
 * @returns {number} - Calculated COB
 */
const calculateManualCOB = (state) => {
  const carbEntries = state.carbHistory.filter(entry => entry.carbs > 0);
  const carbAbsorptionRate = state.profile.carb_ratio || 10; // Default 10g/hr
  const currentTime = new Date(state.clock || Date.now());
  const maxCOB = state.profile.maxCOB || 120; // Max COB from profile or default
  
  const totalCOB = carbEntries.reduce((cob, entry) => {
    const carbTime = new Date(entry.timestamp);
    const hoursSinceCarbs = (currentTime - carbTime) / (1000 * 60 * 60);
    
    // Basic absorption calculation
    const carbsAbsorbed = Math.min(entry.carbs, hoursSinceCarbs * carbAbsorptionRate);
    const remainingCOB = Math.min(
      maxCOB, 
      Math.max(0, entry.carbs - carbsAbsorbed)
    );
    
    return cob + remainingCOB;
  }, 0);
  
  return totalCOB;
};

/**
 * Calculate absorbed carbs
 * @param {Object} state - Current loop state
 * @returns {number} - Calculated absorbed carbs
 */
const calculateCarbsAbsorbed = (state) => {
  const carbEntries = state.carbHistory.filter(entry => entry.carbs > 0);
  const carbAbsorptionRate = state.profile.carb_ratio || 10; // Default 10g/hr
  const currentTime = new Date(state.clock || Date.now());
  
  const totalAbsorbed = carbEntries.reduce((absorbed, entry) => {
    const carbTime = new Date(entry.timestamp);
    const hoursSinceCarbs = (currentTime - carbTime) / (1000 * 60 * 60);
    
    // Basic absorption calculation
    const carbsAbsorbed = Math.min(entry.carbs, hoursSinceCarbs * carbAbsorptionRate);
    
    return absorbed + carbsAbsorbed;
  }, 0);
  
  return totalAbsorbed;
};

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
    
    // Prepare and validate inputs
    const inputs = prepareInputs(state);
    
    // Log detailed carb history for debugging
    const carbEntries = inputs.carbs.filter(entry => entry.carbs > 0);
    logger.debug('Carb Entries for Meal Calculation', {
      totalEntries: carbEntries.length,
      entriesDetails: carbEntries.map(entry => ({
        carbs: entry.carbs,
        timestamp: entry.timestamp
      }))
    });
    
    // Find treatments using meal history module
    let mealData;
    try {
      const treatments = findMealInputs(inputs);
      logger.debug('Meal Inputs:', treatments);
      
      // Generate meal data using the oref0 library function
      mealData = generateMeal(inputs);
    } catch (mealCalcError) {
      logger.warn('Oref0 meal calculation failed, using manual calculation', {
        error: mealCalcError.message
      });
      
      // Fallback to manual calculations if oref0 fails
      mealData = {
        carbs: carbEntries.reduce((total, entry) => total + entry.carbs, 0),
        mealCOB: 0,  // Will be replaced by manual calculation
        nsCarbs: 0,
        bwCarbs: 0,
        journalCarbs: 0
      };
    }
    
    // Calculate manual COB and carbs absorbed
    const manualCOB = calculateManualCOB(state);
    const myCarbsAbsorbed = calculateCarbsAbsorbed(state);
    
    // Find the last carb entry
    const lastCarbEntry = carbEntries.length > 0 
      ? carbEntries.reduce((latest, current) => 
          (new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest)
        )
      : null;
    
    // Create final meal data object
    const finalMealData = {
      carbs: mealData.carbs || 0,
      nsCarbs: mealData.nsCarbs || 0,
      bwCarbs: mealData.bwCarbs || 0,
      journalCarbs: mealData.journalCarbs || 0,
      mealCOB: mealData.mealCOB || manualCOB,
      COB: manualCOB,
      currentDeviation: mealData.currentDeviation || 0,
      maxDeviation: mealData.maxDeviation || 0,
      minDeviation: mealData.minDeviation || 0,
      myMealCOB: manualCOB,
      myCarbsAbsorbed: myCarbsAbsorbed,
      lastCarbTime: lastCarbEntry 
        ? lastCarbEntry.timestamp 
        : new Date().toISOString()
    };
    
    logger.info('Meal data calculated', {
      carbs: finalMealData.carbs,
      COB: finalMealData.COB,
      myMealCOB: finalMealData.myMealCOB,
      myCarbsAbsorbed: finalMealData.myCarbsAbsorbed,
      lastCarbTime: finalMealData.lastCarbTime
    });
    
    return finalMealData;
  } catch (error) {
    logger.error('Unexpected error in meal calculation', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    
    // Return a safe default if all calculations fail
    return {
      carbs: 0,
      nsCarbs: 0,
      bwCarbs: 0,
      journalCarbs: 0,
      mealCOB: 0,
      COB: 0,
      currentDeviation: 0,
      maxDeviation: 0,
      minDeviation: 0,
      myMealCOB: 0,
      myCarbsAbsorbed: 0,
      lastCarbTime: new Date().toISOString()
    };
  }
};

module.exports = {
  calculateMeal
};