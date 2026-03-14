const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
} = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const ADMIN_ROLE_ID = "1465331390085074955";

const IDS_FILE = path.join(__dirname, "discord_ids.txt");
const BLACKLIST_FILE = path.join(__dirname, "blacklist.json");

// ---------- helpers ----------
function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    if (filePath.endsWith(".json")) {
      fs.writeFileSync(filePath, "[]", "utf8");
    } else {
      fs.writeFileSync(filePath, "", "utf8");
    }
  }
}

ensureFile(IDS_FILE);
ensureFile(BLACKLIST_FILE);

function optTrim(interaction, name) {
  const v = interaction.options.getString(name);
  return typeof v === "string" ? v.trim() : null;
}

function loadEntries() {
  ensureFile(IDS_FILE);
  const raw = fs.readFileSync(IDS_FILE, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  return lines
    .map((line) => {
      const parts = line.split("|").map((x) => x.trim());
      return {
        name: parts[0] || "Unknown",
        id: parts[1] || "",
        ip: parts.slice(2).join(" | ").trim() || "N/A",
      };
    })
    .filter((e) => e.id);
}

function appendEntryToFile({ name, id, ip }) {
  ensureFile(IDS_FILE);
  const line = `${name} | ${id} | ${ip}\n`;
  fs.appendFileSync(IDS_FILE, line, "utf8");
}

// ---------- blacklist ----------
let blacklist = [];
try {
  const parsed = JSON.parse(fs.readFileSync(BLACKLIST_FILE, "utf8") || "[]");
  blacklist = Array.isArray(parsed) ? parsed : [];
} catch {
  blacklist = [];
}

function saveBlacklist() {
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(blacklist, null, 2), "utf8");
}

// ---------- slash commands ----------
const commands = [
  {
    name: "discord",
    description: "Find a user in the directory by Discord ID",
    options: [
      { name: "id", type: 3, description: "Discord ID to search", required: true },
    ],
  },
  {
    name: "add",
    description: "Add a new line to discord_ids.txt (admin only)",
    options: [
      { name: "name", type: 3, description: "Name", required: true },
      { name: "id", type: 3, description: "Discord ID", required: true },
      { name: "ip", type: 3, description: "IP / note", required: true },
    ],
  },
  {
    name: "execute",
    description: "Send a simulated notice DM (admin only)",
    options: [
      { name: "ip", type: 3, description: "Any label / random numbers", required: true },
      { name: "user", type: 6, description: "User to DM", required: true },
      { name: "time", type: 4, description: "Duration in seconds", required: true },
      { name: "method", type: 3, description: "Method label (e.g. api)", required: true },
    ],
  },
  {
    name: "blacklist",
    description: "Blacklist a Discord ID (admin only)",
    options: [
      { name: "id", type: 3, description: "Discord ID to blacklist", required: true },
    ],
  },
  {
    name: "unblacklist",
    description: "Unblacklist a Discord ID (admin only)",
    options: [
      { name: "id", type: 3, description: "Discord ID to unblacklist", required: true },
    ],
  },
  {
    name: "sendverify",
    description: "Send the verification panel in this channel (admin only)",
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once(Events.ClientReady, async () => {
  console.log(`Bot is online as ${client.user.tag}!`);

  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] }
    );

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log("Slash commands registered ✅");
  } catch (e) {
    console.error("Failed to register commands:", e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply({ ephemeral: true });

    const isAdmin =
      interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ||
      interaction.member?.roles?.cache?.has?.(ADMIN_ROLE_ID) ||
      interaction.user.id === process.env.OWNER_ID;

  // /sendverify
  if (interaction.commandName === "sendverify") {
    if (!isAdmin) return interaction.editReply("❌ Admins only.");
  
    const channel = interaction.channel;
    const botMember = interaction.guild.members.me;
  
    if (!channel) {
      return interaction.editReply("❌ Could not find this channel.");
    }
  
    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement
    ) {
      return interaction.editReply("❌ Use this in a normal text channel.");
    }
  
    const perms = channel.permissionsFor(botMember);
    if (
      !perms ||
      !perms.has(PermissionsBitField.Flags.ViewChannel) ||
      !perms.has(PermissionsBitField.Flags.SendMessages) ||
      !perms.has(PermissionsBitField.Flags.EmbedLinks)
    ) {
      return interaction.editReply(
        "❌ I need View Channel, Send Messages, and Embed Links in this channel."
      );
    }
  
    if (!process.env.VERIFY_WEB_URL) {
      return interaction.editReply("❌ VERIFY_WEB_URL is missing in Railway variables.");
    }
  
    const embed = new EmbedBuilder()
      .setTitle("Verification required")
      .setDescription("Press the button below to verify and access the server.")
      .setColor(0x5865f2)
      .setFooter({ text: "Safe verification" })
      .setTimestamp();
  
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Verify now")
        .setStyle(ButtonStyle.Link)
        .setURL(process.env.VERIFY_WEB_URL)
    );
  
    await channel.send({
      embeds: [embed],
      components: [row],
    });
  
    return interaction.editReply("✅ Verification panel sent.");
  }

    // /blacklist
    if (interaction.commandName === "blacklist") {
      if (!isAdmin) return interaction.editReply("❌ Admins only.");

      const id = optTrim(interaction, "id");
      if (!id) return interaction.editReply("❌ Missing id.");

      if (blacklist.includes(id)) return interaction.editReply("⚠️ Already blacklisted.");

      blacklist.push(id);
      saveBlacklist();
      return interaction.editReply(`🚫 Blacklisted **${id}**`);
    }

    // /unblacklist
    if (interaction.commandName === "unblacklist") {
      if (!isAdmin) return interaction.editReply("❌ Admins only.");

      const id = optTrim(interaction, "id");
      if (!id) return interaction.editReply("❌ Missing id.");

      if (!blacklist.includes(id)) return interaction.editReply("⚠️ Not blacklisted.");

      blacklist = blacklist.filter((x) => x !== id);
      saveBlacklist();
      return interaction.editReply(`✅ Unblacklisted **${id}**`);
    }

    // /add
    if (interaction.commandName === "add") {
      if (!isAdmin) return interaction.editReply("❌ Admins only.");

      const name = optTrim(interaction, "name");
      const id = optTrim(interaction, "id");
      const ip = optTrim(interaction, "ip");

      if (!name || !id || !ip) {
        return interaction.editReply("❌ Missing fields. Use: /add name:... id:... ip:...");
      }

      if (!/^\d{10,25}$/.test(id)) {
        return interaction.editReply("❌ Invalid Discord ID.");
      }

      const entries = loadEntries();
      if (entries.some((e) => e.id === id)) {
        return interaction.editReply("⚠️ That ID is already in discord_ids.txt");
      }

      appendEntryToFile({ name, id, ip });
      return interaction.editReply(`✅ Added:\n\`${name} | ${id} | ${ip}\``);
    }

    // /discord
    if (interaction.commandName === "discord") {
      const id = optTrim(interaction, "id");
      if (!id) return interaction.editReply("❌ Missing id.");

      if (blacklist.includes(id)) {
        return interaction.editReply("🚫 This Discord ID is blacklisted.");
      }

      const entries = loadEntries();
      const found = entries.find((e) => e.id === id);

      if (!found) return interaction.editReply("❌ Not found.");

      const embed = new EmbedBuilder()
        .setTitle("Discord Lookup Result")
        .addFields(
          { name: "Name", value: found.name || "N/A", inline: true },
          { name: "Discord ID", value: found.id || "N/A", inline: true },
          { name: "Ip", value: found.ip || "N/A", inline: true }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // /execute
    if (interaction.commandName === "execute") {
      if (!isAdmin) return interaction.editReply("❌ Admins only.");

      const ip = optTrim(interaction, "ip");
      const user = interaction.options.getUser("user");
      const time = interaction.options.getInteger("time");
      const method = optTrim(interaction, "method");

      if (!ip || !user || !time || !method) {
        return interaction.editReply("❌ Missing fields. Use: /execute ip user time method");
      }

      const safeTime = Math.max(1, Math.min(time, 86400));

      const embed = new EmbedBuilder()
        .setTitle("🧪 SIMULATION NOTICE")
        .setDescription(
          `Hey **${user.username}**!\n\n` +
          `⚠️ **THIS IS A SIMULATION** ⚠️\n` +
          `No real action is happening — this is a test message.\n\n` +
          `Target Label: **${ip}**\n` +
          `Duration: **${safeTime}s**\n` +
          `Method: **${method}**\n\n` +
          `⏳ Countdown: **2 HOURS**\n` +
          `Click the button below for a surprise.`
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setURL("https://discord.gg/exposedleaks")
          .setLabel("Pay (Invite)")
          .setStyle(ButtonStyle.Link)
      );

      try {
        await user.send({ embeds: [embed], components: [row] });
        return interaction.editReply(`✅ Simulation DM sent to ${user.tag}`);
      } catch {
        return interaction.editReply("❌ Couldn't DM the user (they might have DMs disabled).");
      }
    }

    return interaction.editReply("❓ Unknown command.");
  } catch (err) {
    console.error("Interaction error:", err);

    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.editReply("❌ Error. Check console.");
      } else {
        return await interaction.reply({
          content: "❌ Error. Check console.",
          ephemeral: true,
        });
      }
    } catch {}
  }
});

process.on("unhandledRejection", console.error);
client.login(process.env.TOKEN);
