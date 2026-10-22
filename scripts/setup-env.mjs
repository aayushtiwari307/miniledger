import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootExample = path.join(root, ".env.example");
const rootEnv = path.join(root, ".env");
const mobileExample = path.join(root, "apps", "mobile", ".env.example");
const mobileEnv = path.join(root, "apps", "mobile", ".env");

if (!existsSync(rootEnv)) {
  let contents = readFileSync(rootExample, "utf8");
  const jwtSecret = randomBytes(32).toString("base64url");
  const otpSecret = randomBytes(32).toString("base64url");
  contents = contents.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwtSecret}`);
  contents = contents.replace(/^OTP_HMAC_SECRET=.*$/m, `OTP_HMAC_SECRET=${otpSecret}`);
  if (contents.includes("replace-this")) {
    throw new Error("An environment placeholder remains; inspect .env.example before continuing.");
  }
  writeFileSync(rootEnv, contents, { flag: "wx" });
  console.log("Created repository .env with independent random auth secrets.");
} else {
  console.log("Repository .env already exists; left it unchanged.");
}

if (!existsSync(mobileEnv)) {
  copyFileSync(mobileExample, mobileEnv);
  console.log("Created apps/mobile/.env from its example.");
} else {
  console.log("apps/mobile/.env already exists; left it unchanged.");
}

console.log("Review DATABASE_URL, DATABASE_TEST_URL and EXPO_PUBLIC_API_BASE_URL before starting the app.");
