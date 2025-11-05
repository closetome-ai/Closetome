const { spawn } = require('child_process');

const child = spawn('npx', ['ts-node', 'src/index.ts'], {
  stdio: 'inherit',
  cwd: __dirname
});

child.on('error', (error) => {
  console.error('Failed to start server:', error);
});

child.on('exit', (code) => {
  console.log(`Server process exited with code ${code}`);
});

// Keep the process alive
process.stdin.resume();