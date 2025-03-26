// mpc.js
require('dotenv').config();
const { loadConfig } = require('./utils/config');
const { logger } = require('./utils/logger');
const { createNightscoutClient } = require('./api/nightscout');
const { fetchLoopData } = require('./transforms/data');
const { calculateIOB } = require('./algorithms/insulin');
const { calculateMeal } = require('./algorithms/meal');
const { calculateAutosens } = require('./algorithms/sensitivity');
const { determineBasal } = require('./algorithms/basal');
const { enactTreatments } = require('./api/treatments');
const { uploadDeviceStatus } = require('./api/deviceStatus');

/**
 * Run a single OpenAPS loop cycle
 * @returns {Promise<Object>} - Loop results
 */
async function runLoopCycle() {
  const cycleStartTime = new Date();
  logger.info('=== START OF LOOP CYCLE ===');
  logger.info('Cycle Start Time:', cycleStartTime.toISOString());
  
  try {
    // Load configuration
    const config = loadConfig('./config.json');
    
    // Create Nightscout client
    const nsClient = createNightscoutClient(config.nightscout);
    
    // Fetch all required data
    const state = await fetchLoopData(nsClient, config);
    
    // Calculate IOB
    state.iob = calculateIOB(state);
    logger.info('IOB calculated:', { iob: state.iob[0].iob });
    
    // Calculate meal/COB
    state.meal = calculateMeal(state);
    logger.info('Meal calculated:', { cob: state.meal.mealCOB });
    
    // Calculate autosensitivity
    state.autosens = calculateAutosens(state);
    logger.info('Autosens calculated:', { ratio: state.autosens.ratio });
    
    // Determine basal
    const recommendations = determineBasal(state);
    logger.info('Basal determined:', { 
      rate: recommendations.rate,
      duration: recommendations.duration
    });
    
    // Enact treatments
    const enacted = await enactTreatments(recommendations, nsClient, state);
    logger.info('Treatments enacted:', { enacted: !!enacted });
    
    // Upload device status
    await uploadDeviceStatus(state, recommendations, nsClient);
    
    const cycleEndTime = new Date();
    logger.info('Cycle End Time:', cycleEndTime.toISOString());
    logger.info('Cycle Duration:', (cycleEndTime - cycleStartTime) / 1000, 'seconds');
    logger.info('=== END OF LOOP CYCLE ===');
    
    return recommendations;
  } catch (error) {
    logger.error('Error in loop cycle:', error);
    throw error;
  }
}

// Export the function for cron-style execution
module.exports = runLoopCycle;

// If this file is run directly (not via cron), allow manual execution
if (require.main === module) {
  (async () => {
    try {
      logger.info('Running OpenAPS loop manually...');
      await runLoopCycle();
      logger.info('Loop cycle completed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error running loop:', error);
      process.exit(1);
    }
  })();
}
