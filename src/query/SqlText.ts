export interface SqlStatementRange {
  start: number;
  end: number;
  text: string;
}

const MUTATING_KEYWORDS = new Set([
  'alter',
  'call',
  'cluster',
  'comment',
  'copy',
  'create',
  'delete',
  'do',
  'drop',
  'execute',
  'grant',
  'insert',
  'lock',
  'merge',
  'refresh',
  'reindex',
  'replace',
  'revoke',
  'truncate',
  'update',
  'vacuum'
]);

const DATA_MUTATION_KEYWORDS = new Set(['delete', 'insert', 'merge', 'update']);

export function getStatementAtOffset(sql: string, offset: number): string {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    return '';
  }

  const safeOffset = Math.max(0, Math.min(offset, sql.length));
  const containingIndex = statements.findIndex((statement, index) => (
    safeOffset >= statement.start
    && (safeOffset < statement.end || (index === statements.length - 1 && safeOffset === statement.end))
  ));

  if (containingIndex >= 0) {
    return statements[containingIndex].text.trim();
  }

  const previous = [...statements].reverse().find((statement) => statement.end <= safeOffset);
  return (previous ?? statements[0]).text.trim();
}

export function splitSqlStatements(sql: string): SqlStatementRange[] {
  const code = maskNonCode(sql);
  const statements: SqlStatementRange[] = [];
  let start = 0;

  for (let index = 0; index < code.length; index += 1) {
    if (code[index] !== ';') {
      continue;
    }

    addStatement(statements, sql, code, start, index + 1);
    start = index + 1;
  }

  addStatement(statements, sql, code, start, sql.length);
  return statements;
}

export function findMutatingKeywords(sql: string): string[] {
  const code = maskNonCode(sql).toLowerCase();
  const found = new Set<string>();

  for (const statement of splitSqlStatements(sql)) {
    const words = code
      .slice(statement.start, statement.end)
      .match(/\b[a-z_][a-z0-9_$]*\b/g) ?? [];
    const firstWord = words[0];

    if (firstWord && MUTATING_KEYWORDS.has(firstWord)) {
      found.add(firstWord.toUpperCase());
    }

    for (const word of words) {
      if (DATA_MUTATION_KEYWORDS.has(word)) {
        found.add(word.toUpperCase());
      }
    }

    if (firstWord === 'explain') {
      const explainedCommand = words.find((word) => MUTATING_KEYWORDS.has(word));
      if (explainedCommand) {
        found.add(explainedCommand.toUpperCase());
      }
    }
  }

  return [...found];
}

function addStatement(
  statements: SqlStatementRange[],
  sql: string,
  code: string,
  start: number,
  end: number
): void {
  if (!/[a-z0-9_]/i.test(code.slice(start, end))) {
    return;
  }

  statements.push({
    start,
    end,
    text: sql.slice(start, end)
  });
}

function maskNonCode(sql: string): string {
  const masked = sql.split('');
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2);
      index = maskRange(masked, sql, index, end === -1 ? sql.length : end);
      continue;
    }

    if (sql.startsWith('/*', index)) {
      index = maskBlockComment(masked, sql, index);
      continue;
    }

    if (sql[index] === "'") {
      index = maskQuoted(masked, sql, index, "'", isEscapeStringPrefix(sql, index));
      continue;
    }

    if (sql[index] === '"') {
      index = maskQuoted(masked, sql, index, '"', false);
      continue;
    }

    if (sql[index] === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index))?.[0];
      if (tag) {
        const closingIndex = sql.indexOf(tag, index + tag.length);
        const end = closingIndex === -1 ? sql.length : closingIndex + tag.length;
        index = maskRange(masked, sql, index, end);
        continue;
      }
    }

    index += 1;
  }

  return masked.join('');
}

function maskBlockComment(masked: string[], sql: string, start: number): number {
  let depth = 1;
  let index = start + 2;

  while (index < sql.length && depth > 0) {
    if (sql.startsWith('/*', index)) {
      depth += 1;
      index += 2;
      continue;
    }
    if (sql.startsWith('*/', index)) {
      depth -= 1;
      index += 2;
      continue;
    }
    index += 1;
  }

  return maskRange(masked, sql, start, index);
}

function maskQuoted(
  masked: string[],
  sql: string,
  start: number,
  quote: "'" | '"',
  backslashEscapes: boolean
): number {
  let index = start + 1;

  while (index < sql.length) {
    if (sql[index] === '\\' && backslashEscapes) {
      index += 2;
      continue;
    }
    if (sql[index] === quote && sql[index + 1] === quote) {
      index += 2;
      continue;
    }
    if (sql[index] === quote) {
      index += 1;
      break;
    }
    index += 1;
  }

  return maskRange(masked, sql, start, Math.min(index, sql.length));
}

function isEscapeStringPrefix(sql: string, quoteIndex: number): boolean {
  const prefix = sql[quoteIndex - 1];
  const beforePrefix = sql[quoteIndex - 2];
  return (prefix === 'e' || prefix === 'E')
    && (!beforePrefix || !/[a-z0-9_$]/i.test(beforePrefix));
}

function maskRange(masked: string[], sql: string, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (sql[index] !== '\n' && sql[index] !== '\r') {
      masked[index] = ' ';
    }
  }
  return end;
}
