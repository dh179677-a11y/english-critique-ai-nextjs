const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const realtimePort = Number(process.env.REALTIME_COACH_PORT || 3001);
const processes = [];
let shuttingDown = false;

const checkRealtimeHealth = () =>
  new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "localhost",
        port: realtimePort,
        path: "/health",
        timeout: 700,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      }
    );
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });

const spawnChild = (command, args) => {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  processes.push(child);
  return child;
};

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 250);
};

const watchChild = (child) => {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code && code !== 0) {
      console.error(`[dev] child process exited with code ${code}`);
      shutdown(code);
      return;
    }
    if (signal) {
      console.error(`[dev] child process exited with signal ${signal}`);
      shutdown(1);
    }
  });
};

const main = async () => {
  const hasRealtimeProxy = await checkRealtimeHealth();
  if (hasRealtimeProxy) {
    console.log(`[dev] reuse existing realtime coach proxy on localhost:${realtimePort}`);
  } else {
    watchChild(
      spawnChild(process.execPath, [path.join(rootDir, "server/realtime-coach-server.js")])
    );
  }

  watchChild(spawnChild("next", ["dev", "--webpack"]));
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

void main().catch((error) => {
  console.error(error);
  shutdown(1);
});
