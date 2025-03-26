// algorithms/meal.js
const { logger } = require('../utils/logger');

/**
 * Prepare and validate inputs for meal calculation
 * @param {Object} state - Current loop state
 * @returns {Object} - Prepared inputs
 */
const prepareInputs = (state) => {
  // Prepare carb inputs with additional processing
  const carbEntries = state.carbHistory.filter(entry => entry.carbs > 0)
    .map(entry => {
      const carbTime = new Date(entry.timestamp);
      return {
        ...entry,
        timestamp: carbTime.toISOString(),
        date: carbTime.getTime(),
        carbs: entry.carbs,
        nsCarbs: entry.carbs,
        _type: 'Meal',
        eventType: 'Carb Entry'
      };
    });

  // Sort carb entries by timestamp (most recent first)
  carbEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    history: state.pumpHistory || [],
    profile: state.profile || {},
    clock: state.clock || new Date().toISOString(),
    glucose: state.glucose || [],
    basalprofile: state.profile.basalprofile || [],
    carbs: carbEntries
  };
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
    
    // Prepare inputs
    const inputs = prepareInputs(state);
    
    // Manually log the inputs to debug
    logger.info('Carb Entries for Meal Calculation', {
      carbEntries: JSON.stringify(inputs.carbs, null, 2)
    });
    
    // Find treatments using meal history module
    let mealData;
    try {
      const treatments = findMealInputs(inputs);
      logger.debug('Meal Inputs:', treatments);
      
      // Generate meal data using the oref0 library function
      mealData = generateMeal(inputs);
      
      // Log the raw meal data
      logger.info('Oref0 Meal Data', JSON.stringify(mealData, null, 2));
    } catch (mealCalcError) {
      logger.warn('Oref0 meal calculation failed', {
        error: mealCalcError.message,
        stack: mealCalcError.stack
      });
      
      // Force manual calculation if oref0 fails
      mealData = { carbs: 0, mealCOB: 0 };
    }
    
    // Calculate manual COB and carbs absorbed
    const manualCOB = calculateManualCOB(state);
    const myCarbsAbsorbed = calculateCarbsAbsorbed(state);
    
    // Find the last carb entry
    const carbEntries = state.carbHistory.filter(entry => entry.carbs > 0);
    const lastCarbEntry = carbEntries.length > 0 
      ? carbEntries.reduce((latest, current) => 
          (new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest)
        )
      : null;
    
    // Determine total carbs
    const totalCarbs = carbEntries.reduce((total, entry) => total + entry.carbs, 0);
    
    // Create final meal data object
    const finalMealData = {
      carbs: totalCarbs,
      nsCarbs: totalCarbs,
      bwCarbs: 0,
      journalCarbs: 0,
      mealCOB: Math.max(mealData.mealCOB || 0, manualCOB),
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