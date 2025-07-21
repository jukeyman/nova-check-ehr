// Simple test to check if the config error is coming from our code
console.log('Starting TypeScript test...');

try {
  // Test basic Node.js functionality
  console.log('Node.js version:', process.version);
  console.log('Current working directory:', process.cwd());
  
  // Test if the error comes from importing our config
  console.log('Attempting to import config...');
  import('./src/config/index.js').then(({ config }) => {
    console.log('Config imported successfully:', !!config);
    console.log('Database URL exists:', !!config.DATABASE_URL);
    console.log('Test completed successfully.');
  }).catch((error) => {
    console.error('Error importing config:', error.message);
    console.log('Test completed with import error.');
  });
  
} catch (error) {
  console.error('Error during test:', error.message);
  console.error('Stack trace:', error.stack);
  console.log('Test completed with error.');
}