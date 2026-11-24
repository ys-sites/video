import { useMemo, type ReactNode } from 'react';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { parser } from '@lezer/javascript';
import { CopyButton } from './copy-button';

const tsx = parser.configure({ dialect: 'ts jsx' });
const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'syntax-keyword' },
  { tag: [tags.tagName, tags.function(tags.variableName)], class: 'syntax-function' },
  { tag: [tags.propertyName, tags.attributeName], class: 'syntax-name' },
  { tag: [tags.number, tags.bool, tags.atom], class: 'syntax-constant' },
  { tag: [tags.typeName, tags.className], class: 'syntax-type' },
  { tag: [tags.operator, tags.operatorKeyword], class: 'syntax-operator' },
  { tag: tags.comment, class: 'syntax-comment' },
  { tag: tags.string, class: 'syntax-string' },
]);

function highlightTsx(source: string) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  highlightTree(tsx.parse(source), highlighter, (from, to, className) => {
    if (from > cursor) parts.push(source.slice(cursor, from));
    parts.push(<span key={from} className={className}>{source.slice(from, to)}</span>);
    cursor = to;
  });
  parts.push(source.slice(cursor));
  return parts;
}

export function CodeBlock({ label = 'TSX', text }: { label?: string; text: string }) {
  const code = useMemo(() => label === 'TSX' ? highlightTsx(text) : text, [label, text]);
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{label}</span>
        <CopyButton label="Copy" accessibleLabel="Copy code" text={text} compact failure="Select the code to copy it." />
      </div>
      <pre tabIndex={0}><code>{code}</code></pre>
    </div>
  );
}
