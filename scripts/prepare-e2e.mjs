import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";
const data = process.env.NETSENTINEL_DATA_DIR;
if (!data) throw new Error("NETSENTINEL_DATA_DIR is required for isolated E2E setup");
const status = await (await fetch(`${base}/api/v1/setup/status`)).json();
if (!status.initialized) {
  const token = (await readFile(resolve(data, "setup.token"), "utf8")).trim();
  const unlocked = await fetch(`${base}/api/v1/setup/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  const payload = await unlocked.json();
  if (!unlocked.ok) throw new Error("Could not unlock E2E installation");
  const cookie = unlocked.headers.get("set-cookie").split(";")[0];
  const headers = { cookie, "content-type": "application/json", "x-csrf-token": payload.csrfToken };
  const post = async (path, body) => {
    const result = await fetch(`${base}/api/v1/setup/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!result.ok) throw new Error(`E2E setup ${path} failed (${result.status}): ${await result.text()}`);
    return result.json();
  };
  await post("database", { type: "sqlite" });
  const password = process.env.E2E_REAL_PASSWORD ?? "IntegrationPass123!";
  await post("account", { username: "admin", displayName: "Administrator", password, confirmation: password });
  await post("security", {});
  await post("finish", { enableTotp: false, recoverySaved: true, origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173" });
}
console.log("Isolated E2E installation is ready.");
