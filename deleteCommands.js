const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
require("dotenv").config();

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

const COMMAND_ID = "PASTE_DUPLICATE_ID_HERE";

(async () => {
  try {
    await rest.delete(
      Routes.applicationGuildCommand(process.env.CLIENT_ID, process.env.GUILD_ID, COMMAND_ID)
    );
    console.log("Duplicate command deleted.");
  } catch (err) {
    console.error(err);
  }
})();
