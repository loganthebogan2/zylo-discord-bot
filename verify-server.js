const express = require("express");
const session = require("express-session");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set("trust proxy", 1);

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

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * {
      box-sizing: border-box;
    }

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
      max-width: 420px;
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
    }

    .btn:hover {
      background: #6b77ff;
    }

    .note {
      margin-top: 14px;
      font-size: 13px;
      color: #8e9297;
    }

    .success {
      color: #57f287;
    }

    .error {
      color: #ed4245;
    }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.redirect("/verify");
});

app.get("/verify", (req, res) => {
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
        <div class="note">You’ll be redirected back here after authorizing.</div>
      </div>
      `
    )
  );
});

app.get("/callback", async (req, res) => {
  try {
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
      }
    );

    const accessToken = tokenRes.data.access_token;

    const userRes = await axios.get("https://discord.com/api/v10/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const user = userRes.data;

    if (process.env.BOT_TOKEN && process.env.GUILD_ID && process.env.VERIFIED_ROLE_ID) {
      try {
        await axios.put(
          `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${user.id}/roles/${process.env.VERIFIED_ROLE_ID}`,
          {},
          {
            headers: {
              Authorization: `Bot ${process.env.BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (roleErr) {
        console.error("Failed to give role:", roleErr.response?.data || roleErr.message);
      }
    }

    if (process.env.BOT_TOKEN && process.env.VERIFY_LOG_CHANNEL_ID) {
      try {
        await axios.post(
          `https://discord.com/api/v10/channels/${process.env.VERIFY_LOG_CHANNEL_ID}/messages`,
          {
            content: `✅ Verified <@${user.id}> (${user.username})`,
          },
          {
            headers: {
              Authorization: `Bot ${process.env.BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (logErr) {
        console.error("Failed to send log:", logErr.response?.data || logErr.message);
      }
    }

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