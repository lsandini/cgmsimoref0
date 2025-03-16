// simulate.js
const fs = require('fs');
const openapsUtils = require('./openaps-utils');

// Configuration
const NIGHTSCOUT_URL = 'https://ns-2.oracle.cgmsim.com'; 
const API_SECRET = ''; // Add your API secret if needed

// Load preferences from file
const preferences = JSON.parse(fs.readFileSync('./preferences.json', 'utf8'));
console.log("Loaded preferences:", preferences);

// Main function to run a single cycle
async function runCycle() {
  console.log('--- Starting OpenAPS Simulation Cycle ---');
  console.log('Time:', new Date().toISOString());
  
  try {
    console.log('1. Fetching data from Nightscout...');
    const nightscoutData = await openapsUtils.fetchNightscoutData(NIGHTSCOUT_URL);
    
    console.log('2. Processing data for oref0...');
    const processedData = openapsUtils.processForOref0(nightscoutData, preferences);
    
    console.log('3. Running oref0 algorithms...');
    const recommendation = openapsUtils.runOref0(processedData);
    console.log('Algorithm recommendation:');
    console.log(JSON.stringify(recommendation, null, 2));
    
    console.log('4. Printing recommendations (no upload)...');
    const treatments = openapsUtils.uploadToNightscout(recommendation);
    
    console.log('--- Cycle completed successfully ---');
    return { recommendation, treatments, processedData };
  } catch (error) {
    console.error('Error in cycle:', error);
    console.log('--- Cycle failed ---');
    throw error;
  }
}

// Export the function to run it from command line
module.exports = { runCycle };

// If this script is run directly
if (require.main === module) {
  runCycle()
    .then(() => {
      console.log('Manual cycle execution completed');
    })
    .catch(error => {
      console.error('Manual cycle execution failed:', error);
    });
}