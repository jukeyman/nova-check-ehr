console.log('Minimal Node.js test starting...');
console.log('Node.js version:', process.version);
console.log('Environment variables with CONFIG:', Object.keys(process.env).filter(key => key.includes('CONFIG')));
console.log('Minimal test completed.');