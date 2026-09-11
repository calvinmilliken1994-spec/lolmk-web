import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { isCaptainAuthConfigured, isDiscordAuthConfigured } from "../src/lib/discord-auth";
import { uploadTeamLogo } from "../src/lib/team-logo";

const authSource = readFileSync("src/lib/discord-auth.ts", "utf8");
const actionsSource = readFileSync("src/app/captain/actions.ts", "utf8");

const envKeys = [
  "NODE_ENV",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_GUILD_ID",
  "DISCORD_ADMIN_ROLE_ID",
  "CAPTAIN_ROLE_ID",
  "SESSION_ENCRYPTION_KEY",
  "SITE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "BLOB_READ_WRITE_TOKEN",
] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function setNodeEnv(value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function main() {
try {
  Object.assign(process.env, {
    DISCORD_CLIENT_ID: "client",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_GUILD_ID: "guild",
    DISCORD_ADMIN_ROLE_ID: "admin-role",
    CAPTAIN_ROLE_ID: "captain-role",
    SESSION_ENCRYPTION_KEY: "a".repeat(64),
  });

  await check("production auth requires an explicit HTTPS site origin", () => {
    setNodeEnv("production");
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    assert.equal(isDiscordAuthConfigured(), false);
    assert.equal(isCaptainAuthConfigured(), false);
    process.env.NEXT_PUBLIC_SITE_URL = "https://lolmk.gg";
    assert.equal(isDiscordAuthConfigured(), false);
    assert.equal(isCaptainAuthConfigured(), false);
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.SITE_URL = "http://lolmk.gg";
    assert.equal(isDiscordAuthConfigured(), false);
    assert.equal(isCaptainAuthConfigured(), false);
    process.env.SITE_URL = "https://lolmk.gg";
    assert.equal(isDiscordAuthConfigured(), true);
    assert.equal(isCaptainAuthConfigured(), true);
  });

  await check("auth requires a valid session encryption key", () => {
    setNodeEnv("production");
    process.env.SITE_URL = "https://lolmk.gg";
    delete process.env.SESSION_ENCRYPTION_KEY;
    assert.equal(isDiscordAuthConfigured(), false);
    assert.equal(isCaptainAuthConfigured(), false);
    process.env.SESSION_ENCRYPTION_KEY = "not-64-hex";
    assert.equal(isDiscordAuthConfigured(), false);
    assert.equal(isCaptainAuthConfigured(), false);
    process.env.SESSION_ENCRYPTION_KEY = "b".repeat(64);
    assert.equal(isDiscordAuthConfigured(), true);
    assert.equal(isCaptainAuthConfigured(), true);
  });

  await check("local development may use the localhost origin fallback", () => {
    setNodeEnv("development");
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(isDiscordAuthConfigured(), true);
    assert.equal(isCaptainAuthConfigured(), true);
  });

  await check("rank update repeats ownership and verifies the affected row", () => {
    assert.match(
      actionsSource,
      /UPDATE sr_team_players AS p[\s\S]*WHERE p\.id = \$\{playerId\}[\s\S]*captain_discord_id = \$\{captain\.discordUserId\}[\s\S]*RETURNING p\.id/,
    );
    assert.match(actionsSource, /if \(updatedRows\.length === 0\) throw new Error\("Player not found\."\)/);
  });

  await check("captain token refresh holds a row lock through persistence", () => {
    assert.match(authSource, /SELECT \* FROM captain_sessions WHERE token_hash = \$1 FOR UPDATE/);
    assert.match(authSource, /UPDATE captain_sessions SET access_token_enc = \$1,[\s\S]*WHERE token_hash = \$4/);
  });

  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  await check("logo upload rejects excessive decoded dimensions before storage", async () => {
    const bytes = await sharp({
      create: { width: 9000, height: 1, channels: 4, background: "transparent" },
    })
      .png()
      .toBuffer();
    const file = new File([bytes], "wide.png", { type: "image/png" });
    await assert.rejects(
      uploadTeamLogo(file, "tests/dimension-limit"),
      /dimensions are too large/,
    );
  });

  await check("logo upload rejects excessive decoded pixel count before storage", async () => {
    const bytes = await sharp({
      create: { width: 5000, height: 4000, channels: 4, background: "transparent" },
    })
      .png()
      .toBuffer();
    const file = new File([bytes], "pixels.png", { type: "image/png" });
    await assert.rejects(
      uploadTeamLogo(file, "tests/pixel-limit"),
      /too many pixels/,
    );
  });

  console.log(`\n${passed} captain security regression checks passed.`);
} finally {
  for (const key of envKeys) {
    const value = savedEnv[key];
    if (key === "NODE_ENV") setNodeEnv(value);
    else if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
