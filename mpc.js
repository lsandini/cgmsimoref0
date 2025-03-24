require('dotenv').config();
const InMemoryLoop = require('./InMemoryLoop');
const config = require('./config');

// Create a single function that runs one loop cycle
async function runLoopCycle() {
  try {
    // Create a new loop instance for each cycle
    const loop = new InMemoryLoop(config);
    
    // Initialize the loop before running the cycle
    await loop.initialize();
    
    // Run a single cycle
    const recommendations = await loop.runCycle();
    
    console.log('Loop cycle completed at:', new Date().toISOString());
    
    return recommendations;
  } catch (error) {
    console.error('Error in loop cycle:', error);
    throw error;
  }
}

// Export the function for cron-style execution
module.exports = runLoopCycle;

// If this file is run directly (not via cron), allow manual execution
if (require.main === module) {
  (async () => {
    try {
      console.log('Running OpenAPS loop manually...');
      await runLoopCycle();
      console.log('Loop cycle completed successfully');
    } catch (error) {
      console.error('Error running loop:', error);
      process.exit(1);
    }
  })();
}