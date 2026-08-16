import { createConnection, createServer } from "node:net";
import { existsSync, rmSync } from "node:fs";

// TCP forwarder for the fake ssh: listens on localPort and pipes every
// connection to remotePort on localhost. Exits when the control socket
// disappears (client teardown) or when KILL_FILE appears (simulated tunnel
// death; the file is removed first so a reconnecting forwarder survives).
const [localPort, remotePort, controlPath] = process.argv.slice(2);
const killFile = process.env.KILL_FILE ?? "";
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
    if (killFile && existsSync(killFile)) {
      rmSync(killFile, { force: true });
      teardown();
      return;
    }
    if (!existsSync(controlPath)) {
      teardown();
    }
  }, 100);

  function teardown() {
    clearInterval(timer);
    server.close();
    process.exit(0);
  }
});
