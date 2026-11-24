import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer, getCACertificates, setDefaultCACertificates, type TLSSocket } from "node:tls";

/** Isolated implicit-TLS SMTP capture. No relay or connection outside loopback. */
export async function startSmtpCapture(directory: string) {
  const key = join(directory, "smtp-test.key"); const cert = join(directory, "smtp-test.crt");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cert], { stdio: "ignore" });
  const pem = await readFile(cert, "utf8");
  const trust = getCACertificates("default");
  setDefaultCACertificates([...trust, pem]);
  const messages: { to: string; subject: string; text: string }[] = [];
  const sockets = new Set<TLSSocket>();
  const server = createServer({ key: await readFile(key), cert: pem }, (socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => undefined);
    let buffer = ""; let body: string[] | undefined; let to = "";
    const reply = (line: string) => socket.write(`${line}\r\n`);
    const decode = (value: string) => value.replace(/=\r?\n/gu, "").replace(/=([a-f0-9]{2})/giu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    reply("220 localhost SMTP test");
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8"); let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (body) {
          if (line !== ".") { body.push(line); continue; }
          const separator = body.indexOf("");
          messages.push({ to, subject: body.find((part) => part.startsWith("Subject:")) ?? "", text: decode(body.slice(separator + 1).join("\n")) });
          body = undefined; reply("250 accepted"); continue;
        }
        if (/^EHLO /iu.test(line)) { reply("250-localhost"); reply("250 AUTH PLAIN"); }
        else if (/^AUTH PLAIN /iu.test(line)) reply("235 authenticated");
        else if (/^RCPT TO:/iu.test(line)) { to = line; reply("250 OK"); }
        else if (/^DATA$/iu.test(line)) { body = []; reply("354 end with dot"); }
        else if (/^QUIT$/iu.test(line)) { socket.end("221 bye\r\n"); }
        else reply("250 OK");
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.on("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { messages, port: (server.address() as { port: number }).port, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setDefaultCACertificates(trust);
  } };
}
