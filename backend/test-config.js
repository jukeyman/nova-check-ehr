// Simple test to check if the config error is coming from our code
console.log('Starting test...');

try {
  // Test basic Node.js functionality
  console.log('Node.js version:', process.version);
  console.log('Current working directory:', process.cwd());
  
  // Test if the error comes from importing our config
  console.log('Attempting to import config...');
  const { config } = require('./src/config/index.ts');
  console.log('Config imported successfully:', !!config);
  console.log('Database URL exists:', !!config.DATABASE_URL);
  
} catch (error) {
  console.error('Error during test:', error.message);
  console.error('Stack trace:', error.stack);
}

console.log('Test completed.');