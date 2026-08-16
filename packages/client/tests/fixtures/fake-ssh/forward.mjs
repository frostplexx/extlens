import { createConnection, createServer } from "node:net";
import { existsSync } from "node:fs";

// TCP forwarder for the fake ssh: listens on localPort and pipes every
// connection to remotePort on localhost. Exits when the control socket
// disappears (the client removed it during teardown).
const [localPort, remotePort, controlPath] = process.argv.slice(2);
const server = createServer((socket) => {
  const remote = createConnection({ host: "127.0.0.1", port: Number(remotePort) });
  // Probes and short-lived clients destroy sockets mid-pipe; swallow the
  // resets like a real tunnel would.
  socket.on("error", () => {});
  remote.on("error", () => {});
  socket.pipe(remote).pipe(socket);
});
server.listen(Number(localPort), "127.0.0.1", () => {
  const timer = setInterval(() => {
    if (!existsSync(controlPath)) {
      clearInterval(timer);
      server.close();
      process.exit(0);
    }
  }, 200);
});
