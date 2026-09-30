// Pré-carregado via NODE_OPTIONS=--import nos processos da bancada exercitados pelos testes.
// Toda tentativa de rede ou de criar processo é registrada em AI_STUDY_GUARD_LOG e falha.
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const logPath = process.env.AI_STUDY_GUARD_LOG;

function record(entry) {
  if (logPath) appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

function forbid(kind, name) {
  return function forbidden(...args) {
    record({ kind, name, detail: String(args[0] ?? '').slice(0, 200) });
    throw new Error(`guard: ${kind} bloqueado (${name})`);
  };
}

record({ kind: 'loaded', pid: process.pid });

for (const [kind, target, names] of [
  ['network', net, ['connect', 'createConnection']],
  ['network', tls, ['connect']],
  ['network', http, ['request', 'get']],
  ['network', https, ['request', 'get']],
  ['network', dgram, ['createSocket']],
  ['network', dns, ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']],
  ['network', dns.promises, ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']],
  ['process', childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
]) {
  for (const name of names) target[name] = forbid(kind, name);
}
net.Socket.prototype.connect = forbid('network', 'Socket.connect');
globalThis.fetch = forbid('network', 'fetch');
syncBuiltinESMExports();
