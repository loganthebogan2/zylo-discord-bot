const express = require("express");
const session = require("express-session");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

console.log("verify-server.js is starting...");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const MIN_ACCOUNT_AGE_DAYS = Number(process.env.MIN_ACCOUNT_AGE_DAYS || 30);
const MAX_ACCOUNTS_PER_IP = Number(process.env.MAX_ACCOUNTS_PER_IP || 1);
const SPAM_WINDOW_MINUTES = Number(process.env.SPAM_WINDOW_MINUTES || 10);
const MAX_ATTEMPTS_PER_WINDOW = Number(process.env.MAX_ATTEMPTS_PER_WINDOW || 3);

const DATA_DIR = path.join(__dirname, "data");
const VERIFICATIONS_FILE = path.join(DATA_DIR, "verifications.json");
const ATTEMPTS_FILE = path.join(DATA_DIR, "attempts.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(VERIFICATIONS_FILE)) fs.writeFileSync(VERIFICATIONS_FILE, "[]", "utf8");
if (!fs.existsSync(ATTEMPTS_FILE)) fs.writeFileSync(ATTEMPTS_FILE, "[]", "utf8");

app.set("trust proxy", 1);

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 10,
    },
  })
);

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.ip || "unknown";
}

function snowflakeToDate(snowflake) {
  const discordEpoch = 1420070400000n;
  const id = BigInt(snowflake);
  return new Date(Number((id >> 22n) + discordEpoch));
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, Arial, sans-serif;
      background: #0f1115;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 430px;
      background: #181b20;
      border: 1px solid #2a2f36;
      border-radius: 18px;
      padding: 32px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.35);
      text-align: center;
    }
    .icon {
      width: 58px;
      height: 58px;
      border-radius: 16px;
      background: #5865f2;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-weight: 700;
      margin: 0 auto 18px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      font-weight: 800;
    }
    p {
      margin: 0 0 22px;
      color: #b5bac1;
      line-height: 1.5;
      font-size: 15px;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 14px 18px;
      border-radius: 12px;
      background: #5865f2;
      color: white;
      text-decoration: none;
      font-weight: 700;
      font-size: 15px;
      transition: 0.15s ease;
      border: 0;
      cursor: pointer;
    }
    .btn:hover {
      background: #6b77ff;
    }
    .note {
      margin-top: 14px;
      font-size: 13px;
      color: #8e9297;
    }
    .success { color: #57f287; }
    .error { color: #ed4245; }
    .warn { color: #faa61a; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

async function sendLog(content) {
  if (!process.env.BOT_TOKEN || !process.env.VERIFY_LOG_CHANNEL_ID) return;

  try {
    await axios.post(
      `https://discord.com/api/v10/channels/${process.env.VERIFY_LOG_CHANNEL_ID}/messages`,
      { content },
      {
        headers: {
          Authorization: `Bot ${process.env.BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
  } catch (err) {
    console.error("Failed to send log:", err.response?.data || err.message);
  }
}

async function addVerifiedRole(userId) {
  await axios.put(
    `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${userId}/roles/${process.env.VERIFIED_ROLE_ID}`,
    {},
    {
      headers: {
        Authorization: `Bot ${process.env.BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );
}

async function isVpnOrProxy(ip) {
  if (!process.env.PROXYCHECK_API_KEY) return { blocked: false, reason: "VPN check disabled" };

  try {
    const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${encodeURIComponent(process.env.PROXYCHECK_API_KEY)}&vpn=1&asn=1&risk=1&inf=1`;
    const { data } = await axios.get(url, { timeout: 10000 });

    const result = data?.[ip];
    if (!result) return { blocked: false, reason: "No proxycheck result" };

    const proxy = String(result.proxy || "no").toLowerCase() === "yes";
    const type = String(result.type || "");
    const risk = Number(result.risk || 0);
    const provider = String(result.provider || "unknown");

    const blocked = proxy || risk >= 70 || provider.toLowerCase().includes("hosting");

    return {
      blocked,
      reason: `proxy=${result.proxy || "no"}, type=${type || "unknown"}, risk=${risk}, provider=${provider}`,
    };
  } catch (err) {
    console.error("VPN check failed:", err.response?.data || err.message);
    return { blocked: false, reason: "VPN check failed" };
  }
}

function recordAttempt(ipHash, userId = null) {
  const attempts = loadJson(ATTEMPTS_FILE);
  attempts.push({
    ipHash,
    userId,
    time: Date.now(),
  });

  const cutoff = Date.now() - SPAM_WINDOW_MINUTES * 60 * 1000;
  const filtered = attempts.filter((a) => a.time >= cutoff);
  saveJson(ATTEMPTS_FILE, filtered);
  return filtered;
}

function countRecentAttempts(ipHash) {
  const attempts = loadJson(ATTEMPTS_FILE);
  const cutoff = Date.now() - SPAM_WINDOW_MINUTES * 60 * 1000;
  const recent = attempts.filter((a) => a.time >= cutoff && a.ipHash === ipHash);
  return recent.length;
}

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "verify-server",
    port: PORT,
    time: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.redirect("/verify");
});

app.get("/verify", (req, res) => {
  console.log("User opened /verify");

  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.VERIFY_CALLBACK_URL,
    scope: "identify",
    state,
    prompt: "consent",
  });

  const authUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

  res.send(
    page(
      "Verify",
      `
      <div class="card">
        <div class="icon">✓</div>
        <h1>Verify</h1>
        <p>Continue with Discord to verify your account and access the server.</p>
        <a class="btn" href="${authUrl}">Continue with Discord</a>
        <div class="note">Protected by account age, IP limits, spam checks, and suspicious activity logging.</div>
      </div>
      `
    )
  );
});

app.get("/callback", async (req, res) => {
  try {
    console.log("OAuth callback received");

    const { code, state } = req.query;

    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).send(
        page(
          "Invalid Session",
          `
          <div class="card">
            <div class="icon">!</div>
            <h1 class="error">Invalid session</h1>
            <p>Your verification session expired or is invalid.</p>
            <a class="btn" href="/verify">Try again</a>
          </div>
          `
        )
      );
    }

    const ip = getClientIp(req);
    const ipHash = hashIp(ip);

    recordAttempt(ipHash);

    const recentAttempts = countRecentAttempts(ipHash);
    if (recentAttempts > MAX_ATTEMPTS_PER_WINDOW) {
      await sendLog(`⚠️ Suspicious verify spam blocked | IP Hash: \`${ipHash.slice(0, 16)}...\` | Attempts: ${recentAttempts} in ${SPAM_WINDOW_MINUTES}m`);

      return res.status(429).send(
        page(
          "Too Many Attempts",
          `
          <div class="card">
            <div class="icon">!</div>
            <h1 class="warn">Slow down</h1>
            <p>Too many verification attempts were made from this connection. Please wait and try again.</p>
            <a class="btn" href="/verify">Back</a>
          </div>
          `
        )
      );
    }

    const tokenRes = await axios.post(
      "https://discord.com/api/v10/oauth2/token",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.VERIFY_CALLBACK_URL,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
      }
    );

    const accessToken = tokenRes.data.access_token;

    const userRes = await axios.get("https://discord.com/api/v10/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 10000,
    });

    const user = userRes.data;
    const username = user.username || "Unknown";

    const accountCreated = snowflakeToDate(user.id);
    const ageDays = Math.floor((Date.now() - accountCreated.getTime()) / 86400000);

    const verifications = loadJson(VERIFICATIONS_FILE);

    const alreadyVerified = verifications.find((v) => v.userId === user.id);
    if (alreadyVerified) {
      await sendLog(`ℹ️ Already verified attempt | User: <@${user.id}> (${username})`);
      return res.send(
        page(
          "Already Verified",
          `
          <div class="card">
            <div class="icon">✓</div>
            <h1>Already verified</h1>
            <p>Your Discord account has already been verified.</p>
          </div>
          `
        )
      );
    }

    if (ageDays < MIN_ACCOUNT_AGE_DAYS) {
      await sendLog(`🚫 Blocked new account | User: <@${user.id}> (${username}) | Age: ${ageDays} days | IP Hash: \`${ipHash.slice(0, 16)}...\``);

      return res.status(403).send(
        page(
          "Verification Blocked",
          `
          <div class="card">
            <div class="icon">!</div>
            <h1 class="error">Verification blocked</h1>
            <p>Your Discord account is too new to verify.</p>
          </div>
          `
        )
      );
    }

    const sameIpCount = verifications.filter((v) => v.ipHash === ipHash).length;
    if (sameIpCount >= MAX_ACCOUNTS_PER_IP) {
      await sendLog(`⚠️ Suspicious alt attempt blocked | User: <@${user.id}> (${username}) | Reason: same IP limit reached | IP Hash: \`${ipHash.slice(0, 16)}...\``);

      return res.status(403).send(
        page(
          "Verification Blocked",
          `
          <div class="card">
            <div class="icon">!</div>
            <h1 class="error">Verification blocked</h1>
            <p>Too many accounts have already verified from this connection.</p>
          </div>
          `
        )
      );
    }

    const vpnCheck = await isVpnOrProxy(ip);
    if (vpnCheck.blocked) {
      await sendLog(`🚫 VPN / proxy blocked | User: <@${user.id}> (${username}) | ${vpnCheck.reason} | IP Hash: \`${ipHash.slice(0, 16)}...\``);

      return res.status(403).send(
        page(
          "Verification Blocked",
          `
          <div class="card">
            <div class="icon">!</div>
            <h1 class="error">VPN or proxy blocked</h1>
            <p>Please disable your VPN or proxy and try again.</p>
          </div>
          `
        )
      );
    }

    await addVerifiedRole(user.id);

    verifications.push({
      userId: user.id,
      username,
      ipHash,
      verifiedAt: new Date().toISOString(),
      accountAgeDays: ageDays,
    });
    saveJson(VERIFICATIONS_FILE, verifications);

    await sendLog(`✅ Verified | User: <@${user.id}> (${username}) | Age: ${ageDays} days`);

    req.session.oauthState = null;

    return res.send(
      page(
        "Verified",
        `
        <div class="card">
          <div class="icon">✓</div>
          <h1 class="success">Verified</h1>
          <p>Your Discord account has been verified successfully.</p>
          <a class="btn" href="discord://">Back to Discord</a>
        </div>
        `
      )
    );
  } catch (err) {
    console.error("Callback error:", err.response?.data || err.message);
    await sendLog(`❌ Verification error | ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);

    return res.status(500).send(
      page(
        "Verification Failed",
        `
        <div class="card">
          <div class="icon">!</div>
          <h1 class="error">Verification failed</h1>
          <p>Something went wrong while verifying your account.</p>
          <a class="btn" href="/verify">Try again</a>
        </div>
        `
      )
    );
  }
});

app.listen(PORT, () => {
  console.log(`Verify site running on port ${PORT}`);
});
