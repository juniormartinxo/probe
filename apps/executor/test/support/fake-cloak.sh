#!/bin/sh
# `cloak` falso: copiado como `cloak` para um diretório que o teste põe no PATH do executor. Quem
# decide o perfil e as falhas é fake-cloak.cjs; aqui, como o Cloak real, `exec` troca o processo
# pela CLI (o pid é o mesmo), com o diretório de configuração do perfil no ambiente. Só usa
# embutidos do shell: o PATH dos testes tem apenas os executáveis falsos e o node.
config_dir=$(node "${0%/*}/fake-cloak.cjs" "$@") || exit
if [ "$1" != exec ]; then
  printf '%s\n' "$config_dir"
  exit 0
fi
shift
if [ "$1" = --profile ]; then shift 2; fi
cli=$1
shift
if ! command -v "$cli" >/dev/null 2>&1; then
  printf "Error: \n   0: '%s' not found in PATH. Install it or set cli.%s.binary in config.\n" "$cli" "$cli" >&2
  exit 1
fi
FAKE_CLOAK_CONFIG_DIR=$config_dir exec "$cli" "$@"
