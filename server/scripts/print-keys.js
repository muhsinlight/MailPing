import { randomBytes } from "crypto";

console.log(`PANEL_PASSWORD=${randomBytes(18).toString("base64url")}`);
console.log(`AUTH_SECRET=${randomBytes(32).toString("hex")}`);
