// Literais de um módulo JS sem dependências: cada string entre aspas e cada parte fixa de template
// (fora de `${}`), ignorando comentários e expressões regulares. `before` guarda os caracteres que
// antecedem o literal, para distinguir uma chave em `text('...')` de texto que chega à saída.
// Basta para o código deste repositório; não é um parser JavaScript geral.
export function sourceLiterals(source) {
  const found = [];
  const templateDepths = []; // chaves abertas dentro de cada `${` ainda não fechado
  let last = ''; // último caractere significativo fora de literais e comentários
  let i = 0;

  const skipEscaped = (j) => (source[j] === '\\' ? j + 2 : j + 1);
  const readQuoted = (quote) => {
    let j = i + 1;
    while (source[j] !== quote) j = skipEscaped(j);
    found.push({ value: source.slice(i + 1, j), before: source.slice(Math.max(0, i - 5), i), start: i });
    i = j + 1;
  };
  // `i` aponta para o início de uma parte fixa de template; termina na crase ou no próximo `${`.
  const readTemplatePart = () => {
    let j = i;
    while (source[j] !== '`' && !(source[j] === '$' && source[j + 1] === '{')) j = skipEscaped(j);
    found.push({ value: source.slice(i, j), before: '`', start: i });
    if (source[j] === '`') {
      i = j + 1;
    } else {
      templateDepths.push(0);
      i = j + 2;
    }
  };
  const skipRegex = () => {
    let j = i + 1;
    let inClass = false;
    while (inClass || source[j] !== '/') {
      if (source[j] === '[') inClass = true;
      if (source[j] === ']') inClass = false;
      j = skipEscaped(j);
    }
    i = j + 1;
    while (/[a-z]/.test(source[i])) i += 1;
  };

  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) break;
    } else if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i) + 2;
    } else if (c === "'" || c === '"') {
      readQuoted(c);
      last = c;
    } else if (c === '`') {
      i += 1;
      readTemplatePart();
      last = c;
    } else if (c === '/' && (last === '' || '(,=:[!&|?{};'.includes(last))) {
      skipRegex();
      last = c;
    } else if (c === '}' && templateDepths.at(-1) === 0) {
      templateDepths.pop();
      i += 1;
      readTemplatePart();
      last = '`';
    } else {
      if (templateDepths.length > 0 && c === '{') templateDepths[templateDepths.length - 1] += 1;
      if (templateDepths.length > 0 && c === '}') templateDepths[templateDepths.length - 1] -= 1;
      if (!/\s/.test(c)) last = c;
      i += 1;
    }
  }
  return found;
}
