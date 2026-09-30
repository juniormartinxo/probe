// Códigos publicados da fronteira: 0 concluído, 1 incompleto, 2 uso ou configuração inválida.
export class UsageError extends Error {
  exitCode = 2;
  name = 'UsageError';
}

export class IncompleteError extends Error {
  exitCode = 1;
  name = 'IncompleteError';
}
