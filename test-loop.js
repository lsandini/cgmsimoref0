// test-loop.js
const loop = require('./index.js');

console.log('Running manual loop test...');
loop()
  .then(() => {
    console.log('Manual loop test completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error in manual loop test:', error);
    process.exit(1);
  });