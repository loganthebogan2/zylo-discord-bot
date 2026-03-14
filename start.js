const { spawn } = require("child_process");

function run(name, file) {
  const child = spawn("node", [file], {
    stdio: "inherit",
    shell: true
  });

  child.on("exit", (code) => {
    console.log(`${name} exited with code ${code}`);
  });

  child.on("error", (err) => {
    console.error(`${name} failed:`, err);
  });
}

console.log("Starting bot and verify server...");

run("bot", "bot.js");
run("verify", "verify-server.js");
