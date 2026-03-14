const { spawn } = require("child_process");

function run(name, file) {
  console.log(`Starting ${name} from ${file}...`);

  const child = spawn(process.execPath, [file], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => {
    console.log(`${name} exited with code ${code}`);
  });

  child.on("error", (err) => {
    console.error(`${name} failed to start:`, err);
  });
}

console.log("Starting bot and verify server...");
run("bot", "bot.js");
run("verify", "verify-server.js");
