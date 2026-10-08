// Decide o que o `cloak` falso (fake-cloak.sh) faz: segue `cloak.json` (mesmo diretório) e
// registra cada chamada em `invocations.json`. No `exec`, escreve o diretório de configuração do
// perfil, que o script passa à CLI. Não lê o stdin: ele é da CLI.
const fs = require("node:fs");
const path = require("node:path");

const { profiles, defaultProfile, brokenConfig } = JSON.parse(fs.readFileSync(path.join(__dirname, "cloak.json"), "utf8"));
const args = process.argv.slice(2);

// Como o Cloak: o `.cloak` mais próximo, subindo a partir do diretório atual; sem ele, o perfil padrão.
function directoryProfile() {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const file = path.join(dir, ".cloak");
    if (fs.existsSync(file)) return /profile\s*=\s*"([^"]+)"/.exec(fs.readFileSync(file, "utf8"))[1];
    if (dir === path.dirname(dir)) return defaultProfile;
  }
}

function record(profile) {
  const file = path.join(__dirname, "invocations.json");
  const invocations = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  invocations.push({ argv: args, cwd: process.cwd(), profile });
  fs.writeFileSync(file, JSON.stringify(invocations));
}

// No formato do Cloak real (color-eyre): cor, local no código-fonte e aviso de backtrace.
function fail(message) {
  process.stderr.write(
    `Error: \n   0: \x1b[91m${message}\x1b[0m\n\nLocation:\n   \x1b[35msrc/main.rs\x1b[0m:\x1b[35m1910\x1b[0m\n\n` +
      "Backtrace omitted. Run with RUST_BACKTRACE=1 environment variable to display it.\n",
  );
  process.exit(1);
}

// Como o Cloak real, a configuração é lida antes de qualquer comando.
if (brokenConfig) fail("failed parsing ~/.config/cloak/config.toml");

if (args[0] === "profile" && args[1] === "account") {
  record(args[2]);
  if (!profiles.includes(args[2])) fail(`profile '${args[2]}' does not exist`);
  process.stdout.write(`Profile '${args[2]}'\n\nAccounts\n`);
  process.exit(0);
}
if (args[0] !== "exec") fail(`unexpected command: ${args.join(" ")}`);

const explicit = args[1] === "--profile" ? args[2] : undefined;
const profile = explicit ?? directoryProfile();
record(profile);
// O Cloak real perguntaria pelo stdin se deve criar o perfil; o executor nunca deve chegar aqui.
if (explicit !== undefined && !profiles.includes(explicit)) {
  process.stderr.write(`Profile '${explicit}' does not exist.\n`);
  process.exit(1);
}
process.stdout.write(path.join(__dirname, "profiles", profile, "claude"));
