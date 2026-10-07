#!/usr/bin/env node
// `claude` falso: copiado como `claude` para um diretório que o teste põe no PATH do executor.
// Segue o roteiro de `behavior.json` (mesmo diretório) e registra em `invocation.json` como foi
// chamado.
const fs = require("node:fs");
const path = require("node:path");

const behavior = JSON.parse(fs.readFileSync(path.join(__dirname, "behavior.json"), "utf8"));

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  const invocation = {
    argv: process.argv.slice(2),
    stdin,
    cwd: process.cwd(),
    cwdEntries: fs.readdirSync(process.cwd()),
    pid: process.pid,
  };
  fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify(invocation));
  setTimeout(() => {
    process.stderr.write(behavior.stderr ?? "");
    process.stdout.write(behavior.stdout ?? "", () => process.exit(behavior.exitCode ?? 0));
  }, behavior.delayMs ?? 0);
});
