// debug-openaps.js - Add this file to your project

const fs = require('fs');
const openapsUtils = require('./openaps-utils');

// Function to dump the full processed data for inspection
function dumpProcessedData(processedData, filename = 'processed-data-debug.json') {
  fs.writeFileSync(filename, JSON.stringify(processedData, null, 2));
  console.log(`Dumped processed data to ${filename} for debugging`);
}

// Function to dump the recommendation and prediction arrays
function dumpRecommendation(recommendation, filename = 'recommendation-debug.json') {
  fs.writeFileSync(filename, JSON.stringify(recommendation, null, 2));
  console.log(`Dumped recommendation to ${filename} for debugging`);
  
  // Log prediction arrays specifically
  if (recommendation.predBGs) {
    console.log("Prediction arrays found in recommendation:");
    for (const [key, value] of Object.entries(recommendation.predBGs)) {
      console.log(`- ${key} prediction array has ${value.length} entries`);
    }
  } else {
    console.log("Warning: No prediction arrays found in recommendation");
  }
}

// Test function to check if glucose status is formatted correctly
function checkGlucoseStatus(glucoseStatus) {
  const requiredFields = ['glucose', 'delta', 'avgDelta', 'short_avgdelta', 'long_avgdelta', 'date'];
  const missing = requiredFields.filter(field => 
    glucoseStatus[field] === undefined || glucoseStatus[field] === null
  );
  
  if (missing.length > 0) {
    console.error(`❌ Glucose status is missing required fields: ${missing.join(', ')}`);
    return false;
  }
  
  console.log('✅ Glucose status has all required fields');
  return true;
}

// Test function to check if IOB data is formatted correctly
function checkIOBData(iobArray) {
  if (!Array.isArray(iobArray) || iobArray.length === 0) {
    console.error('❌ IOB data is not an array or is empty');
    return false;
  }
  
  const firstIOB = iobArray[0];
  const requiredFields = ['iob', 'activity', 'time'];
  const missing = requiredFields.filter(field => 
    firstIOB[field] === undefined || firstIOB[field] === null
  );
  
  if (missing.length > 0) {
    console.error(`❌ IOB data is missing required fields: ${missing.join(', ')}`);
    return false;
  }
  
  console.log(`✅ IOB data array has ${iobArray.length} entries and all required fields`);
  return true;
}

// Function to run a test cycle with verbose logging
async function runTestCycle() {
  console.log('🔍 Running OpenAPS test cycle with verbose debugging');
  
  try {
    // Load preferences
    const preferences = JSON.parse(fs.readFileSync('./preferences.json', 'utf8'));
    console.log("Loaded preferences:", preferences);
    
    // Try to fetch Nightscout data
    const nightscoutUrl = process.env.NIGHTSCOUT_URL || 'https://ns-2.oracle.cgmsim.com';
    console.log(`Fetching data from ${nightscoutUrl}...`);
    const nightscoutData = await openapsUtils.fetchNightscoutData(nightscoutUrl);
    
    // Process data
    console.log('Processing data for oref0...');
    const processedData = openapsUtils.processForOref0(nightscoutData, preferences);
    
    // Dump processed data for debugging
    dumpProcessedData(processedData);
    
    // Verify key components
    console.log('\nVerifying key data components:');
    checkGlucoseStatus(processedData.glucoseStatus);
    
    // Calculate IOB data
    console.log('\nCalculating IOB...');
    const iobArray = openapsUtils.calculateIOB(processedData);
    checkIOBData(iobArray);
    
    // Run oref0 algorithm
    console.log('\nRunning oref0 algorithm...');
    const recommendation = openapsUtils.runOref0(processedData);
    
    // Dump recommendation for debugging
    dumpRecommendation(recommendation);
    
    // Check for prediction arrays
    console.log('\nChecking prediction arrays:');
    if (recommendation.predBGs) {
      console.log('✅ Prediction arrays successfully generated');
      
      // Check each prediction array
      for (const [key, value] of Object.entries(recommendation.predBGs)) {
        console.log(`- ${key}: ${value.length} predictions`);
        if (value.length > 0) {
          console.log(`  First few values: ${value.slice(0, 5).join(', ')}...`);
        }
      }
    } else {
      console.error('❌ No prediction arrays in recommendation');
    }
    
    console.log('\n✅ Test cycle completed');
    return {
      success: true,
      recommendation,
      processedData
    };
  } catch (error) {
    console.error('❌ Test cycle failed:', error);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

// If this script is run directly
if (require.main === module) {
  runTestCycle()
    .then((result) => {
      if (result.success) {
        console.log('Test completed successfully');
      } else {
        console.error('Test failed');
      }
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution error:', error);
      process.exit(1);
    });
} else {
  // Export for use in other modules
  module.exports = {
    runTestCycle,
    dumpProcessedData,
    dumpRecommendation,
    checkGlucoseStatus,
    checkIOBData
  };
}