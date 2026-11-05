const net = require('node:net');

const port = Number(process.env.PORT || 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Cannot start the ALSM API: PORT must be an integer from 1 to 65535 (received "${process.env.PORT}").`);
  process.exit(1);
}

const probe = net.createServer();

probe.once('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Cannot start the ALSM API: port ${port} is already in use. ` +
        'If the Docker backend is running, keep using it and do not start the local API. ' +
        'To run the local API instead, stop the Docker backend first.',
    );
  } else {
    console.error(`Cannot check whether API port ${port} is available: ${error.message}`);
  }
  process.exit(1);
});

probe.listen(port, () => {
  probe.close((error) => {
    if (error) {
      console.error(`Cannot release API port ${port} after checking it: ${error.message}`);
      process.exit(1);
    }
  });
});
