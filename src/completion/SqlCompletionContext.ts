export interface SqlTableReference {
  schema?: string;
  table: string;
  alias?: string;
}

const IDENTIFIER_SOURCE = '(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)';
const ALIAS_STOP_WORDS = new Set([
  'all',
  'cross',
  'except',
  'fetch',
  'for',
  'full',
  'group',
  'having',
  'inner',
  'intersect',
  'join',
  'left',
  'limit',
  'offset',
  'on',
  'order',
  'outer',
  'returning',
  'right',
  'set',
  'union',
  'using',
  'values',
  'where',
  'window'
]);

export function getQualifierBeforeCursor(sql: string, offset: number): string[] {
  const safeOffset = Math.max(0, Math.min(offset, sql.length));
  const code = maskSqlLiteralsAndComments(sql.slice(0, safeOffset));
  const pattern = new RegExp(
    `(${IDENTIFIER_SOURCE})(?:\\s*\\.\\s*(${IDENTIFIER_SOURCE}))?\\s*\\.\\s*$`,
    'i'
  );
  const match = pattern.exec(code);
  if (!match) {
    return [];
  }

  const first = unquoteIdentifier(match[1]);
  return match[2]
    ? [first, unquoteIdentifier(match[2])]
    : [first];
}

export function findSqlTableReferences(sql: string): SqlTableReference[] {
  const code = maskSqlLiteralsAndComments(sql);
  const pattern = new RegExp(
    `\\b(?:from|join|update|into)\\s+(${IDENTIFIER_SOURCE})(?:\\s*\\.\\s*(${IDENTIFIER_SOURCE}))?(?:\\s+(?:as\\s+)?(${IDENTIFIER_SOURCE}))?`,
    'gi'
  );
  const references: SqlTableReference[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const first = unquoteIdentifier(match[1]);
    const second = match[2] ? unquoteIdentifier(match[2]) : undefined;
    const rawAlias = match[3];
    const alias = rawAlias && !isAliasStopWord(rawAlias)
      ? unquoteIdentifier(rawAlias)
      : undefined;
    const reference: SqlTableReference = second
      ? { schema: first, table: second, alias }
      : { table: first, alias };

    if (!references.some((item) => (
      equalsIdentifier(item.schema, reference.schema)
      && equalsIdentifier(item.table, reference.table)
      && equalsIdentifier(item.alias, reference.alias)
    ))) {
      references.push(reference);
    }
  }

  return references;
}

function isAliasStopWord(identifier: string): boolean {
  return !identifier.startsWith('"')
    && ALIAS_STOP_WORDS.has(identifier.toLowerCase());
}

function equalsIdentifier(left: string | undefined, right: string | undefined): boolean {
  return left?.toLowerCase() === right?.toLowerCase();
}

function unquoteIdentifier(identifier: string): string {
  if (identifier.startsWith('"') && identifier.endsWith('"')) {
    return identifier.slice(1, -1).replace(/""/g, '"');
  }
  return identifier;
}

function maskSqlLiteralsAndComments(sql: string): string {
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
      index = maskSingleQuotedString(masked, sql, index);
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

function maskSingleQuotedString(masked: string[], sql: string, start: number): number {
  let index = start + 1;
  const backslashEscapes = isEscapeStringPrefix(sql, start);

  while (index < sql.length) {
    if (sql[index] === '\\' && backslashEscapes) {
      index += 2;
      continue;
    }
    if (sql[index] === "'" && sql[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (sql[index] === "'") {
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
