const { spawn } = require("child_process");

function run(name, file) {
  console.log(`Starting ${name}: ${file}`);

  const child = spawn(process.execPath, [file], {
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.error(`${name} failed to start:`, err);
  });

  child.on("exit", (code, signal) => {
    console.log(`${name} exited with code=${code} signal=${signal}`);
  });
}

console.log("Launcher starting...");
run("bot", "bot.js");
run("verify", "verify-server.js");
