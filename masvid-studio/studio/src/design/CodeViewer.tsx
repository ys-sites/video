import { useMemo } from 'react';

type TokenKind = 'plain' | 'tag' | 'attr' | 'string' | 'comment' | 'keyword' | 'number';
type Token = { kind: TokenKind; text: string };

const CODE_TOKEN_RE = /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<\/?[a-zA-Z][\w:-]*|\/>|>|\b(?:const|let|var|function|return|if|else|for|while|import|export|from|async|await|true|false|null|undefined|@media|@keyframes|@page)\b|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|ms|s)?\b/g;

function tokenizeLine(line: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  CODE_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE_TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) out.push({ kind: 'plain', text: line.slice(last, m.index) });
    const text = m[0];
    let kind: TokenKind = 'plain';
    if (text.startsWith('<!--') || text.startsWith('/*') || text.startsWith('//')) kind = 'comment';
    else if (text.startsWith('"') || text.startsWith("'")) kind = 'string';
    else if (text.startsWith('<') || text === '>' || text === '/>') kind = 'tag';
    else if (/^\d/.test(text)) kind = 'number';
    else kind = 'keyword';
    out.push({ kind, text });
    last = m.index + text.length;
  }
  if (last < line.length) out.push({ kind: 'plain', text: line.slice(last) });
  return out.length ? out : [{ kind: 'plain', text: '' }];
}

/**
 * Lightweight, theme-token syntax-highlighted code viewer with line numbers.
 * Caps highlighted lines at 4,000 for smooth rendering on large files.
 */
export function CodeViewer({ content }: { content: string }) {
  const lines = useMemo(() => {
    const raw = content.split('\n');
    const highlight = raw.length <= 4000;
    return raw.map((line, i) => ({ num: i + 1, tokens: highlight ? tokenizeLine(line) : [{ kind: 'plain' as const, text: line }] }));
  }, [content]);

  return (
    <pre className="om-design-code-pre">
      <code>
        {lines.map(line => (
          <div key={line.num} className="om-design-code-line">
            <span className="om-design-code-ln" aria-hidden="true">{line.num}</span>
            <span className="om-design-code-text">
              {line.tokens.map((tok, i) =>
                tok.kind === 'plain' ? tok.text : <span key={i} className={`om-design-tok-${tok.kind}`}>{tok.text}</span>,
              )}
            </span>
          </div>
        ))}
      </code>
    </pre>
  );
}
