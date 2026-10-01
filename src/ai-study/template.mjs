import { createHash } from 'node:crypto';

const LANGUAGES = Object.freeze({
  pt: { code: 'pt', name: 'Portuguese' },
  en: { code: 'en', name: 'English' },
});

// O endpoint de completions do LM Studio não aplica template: a bancada renderiza o prompt.
// Versionado: reconstrução do prompt da adaptação indicada pelo usuário
// (chbae624/vllm-translategemma-12b-it, revisão 81d99b4, chat_template.jinja), não cópia byte a byte.
// Sem equivalência demonstrada ao template oficial, a coleta live para em `template_unverified` (AC 12).
export const TRANSLATION_TEMPLATE = Object.freeze({
  id: 'chbae624/vllm-translategemma-12b-it@81d99b4299ce797e9fa5141ade4384e57f5e9442:chat_template.jinja',
  official: false,
  justification:
    'adaptação indicada pelo usuário, reconstruída sem cópia byte a byte; equivalência ao template oficial de google/translategemma-12b-it não demonstrada',
  text:
    '<start_of_turn>user\n' +
    'You are a professional {source_name} ({source_code}) to {target_name} ({target_code}) translator. ' +
    'Your goal is to accurately convey the meaning and nuances of the original {source_name} text ' +
    'while adhering to {target_name} grammar, vocabulary, and cultural sensitivities. ' +
    'Produce only the {target_name} translation, without any additional explanations or commentary.\n\n\n' +
    '{text}<end_of_turn>\n' +
    '<start_of_turn>model\n',
});

export function templateRevision(template) {
  return `sha256:${createHash('sha256').update(template.text).digest('hex')}`;
}

// Substituição em passagem única: marcadores dentro do texto original não são reinterpretados.
export function renderPrompt(template, direction, text) {
  const [source, target] = direction.split('->').map((code) => LANGUAGES[code]);
  const values = {
    source_name: source.name,
    source_code: source.code,
    target_name: target.name,
    target_code: target.code,
    text,
  };
  return template.text.replace(/\{(source_name|source_code|target_name|target_code|text)\}/g, (_, key) => values[key]);
}
