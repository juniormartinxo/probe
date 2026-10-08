#!/usr/bin/env node
// CLI falsa: copiada com o nome da CLI (`claude`, `codex`, `grok`, `agy`) para um diretório que o
// teste põe no PATH do executor. Segue o roteiro de `behavior.json` (mesmo diretório) e registra em
// `invocation.json` como foi chamada.
const fs = require("node:fs");
const path = require("node:path");

const behavior = JSON.parse(fs.readFileSync(path.join(__dirname, "behavior.json"), "utf8"));
const argv = process.argv.slice(2);

// O grok lê o prompt de um arquivo: o conteúdo é registrado enquanto o arquivo existe.
const promptFileIndex = argv.indexOf("--prompt-file");
const promptFile = promptFileIndex === -1 ? null : argv[promptFileIndex + 1];

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  const invocation = {
    argv,
    stdin,
    promptFile: promptFile && { path: promptFile, content: fs.readFileSync(promptFile, "utf8") },
    cwd: process.cwd(),
    cwdEntries: fs.readdirSync(process.cwd()),
    pid: process.pid,
    configDir: process.env.FAKE_CLOAK_CONFIG_DIR ?? null,
  };
  fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify(invocation));
  setTimeout(() => {
    if (behavior.killSignal) process.kill(process.pid, behavior.killSignal);
    process.stderr.write(behavior.stderr ?? "");
    process.stdout.write(behavior.stdout ?? "", () => process.exit(behavior.exitCode ?? 0));
  }, behavior.delayMs ?? 0);
});
