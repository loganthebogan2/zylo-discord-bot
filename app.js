const express = require("express");
const session = require("express-session");
const axios = require("axios");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const bot = new Client({
  intents: [GatewayIntentBits.Guilds]
});

bot.login(process.env.TOKEN);

app.use(session({
  secret: process.env.SESSION_SECRET || "change_this_secret",
  resave: false,
  saveUninitialized: false,
}));

app.get("/", (req, res) => {
  res.send(`
    <html>
      <body style="background:#1e1f22;color:white;font-family:Arial;padding:40px;text-align:center;">
        <h1>Discord Verification</h1>
        <p>Click below to verify with Discord.</p>
        <a href="/verify" style="background:#5865F2;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;">Verify with Discord</a>
      </body>
    </html>
  `);
});

app.get("/verify", (req, res) => {
  const scope = "identify";
  const authUrl =
    `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&prompt=consent`;

  res.redirect(authUrl);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code.");

  try {
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.REDIRECT_URI,
      }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    const accessToken = tokenRes.data.access_token;

    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const user = userRes.data;
    const guild = await bot.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return res.send("<h1>Join the server first, then verify again.</h1>");
    }

    const discordEpoch = 1420070400000n;
    const snowflake = BigInt(user.id);
    const createdAtMs = Number((snowflake >> 22n) + discordEpoch);
    const accountAgeDays = Math.floor((Date.now() - createdAtMs) / 86400000);

    if (accountAgeDays < Number(process.env.MIN_ACCOUNT_AGE_DAYS || 14)) {
      const logChannel = guild.channels.cache.get(process.env.VERIFY_LOG_CHANNEL_ID);
      if (logChannel && logChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle("Verification Blocked")
          .setColor(0xed4245)
          .addFields(
            { name: "User", value: `${user.username} (${user.id})` },
            { name: "Reason", value: `Account too new: ${accountAgeDays} days old` }
          )
          .setTimestamp();

        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }

      return res.send("<h1>Account too new to verify automatically.</h1>");
    }

    await member.roles.add(process.env.VERIFIED_ROLE_ID);

    const logChannel = guild.channels.cache.get(process.env.VERIFY_LOG_CHANNEL_ID);
    if (logChannel && logChannel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle("User Verified")
        .setColor(0x57f287)
        .addFields(
          { name: "User", value: `${user.username} (${user.id})` },
          { name: "Account Age", value: `${accountAgeDays} days`, inline: true },
          { name: "Role Given", value: `<@&${process.env.VERIFIED_ROLE_ID}>`, inline: true }
        )
        .setTimestamp();

      await logChannel.send({ embeds: [embed] }).catch(() => {});
    }

    res.send("<h1>Verification complete. You can go back to Discord.</h1>");
  } catch (err) {
    console.error(err?.response?.data || err);
    res.status(500).send("Verification failed.");
  }
});

app.listen(PORT, () => {
  console.log(`App running on port ${PORT}`);
});
