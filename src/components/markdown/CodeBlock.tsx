import { memo, useEffect, useRef, useState } from 'react';
import { highlightCode } from '../../lib/highlighter';
import { copyText } from '../../lib/utils';
import { CheckIcon, CopyIcon } from '../icons';

interface CodeBlockProps {
  code: string;
  language?: string;
}

/**
 * Highlighting happens after paint so a long paste never blocks the frame, and
 * the rendered HTML is kept in state so switching themes does not re-run it.
 */
export const CodeBlock = memo(function CodeBlock({ code, language }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void highlightCode(code, language).then((result) => {
        if (!cancelled) setHtml(result);
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, language]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const label = language?.trim() || 'text';

  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border border-line bg-surface-2/60">
      <div className="flex items-center justify-between border-b border-line/70 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">{label}</span>
        <button
          type="button"
          onClick={async () => {
            const ok = await copyText(code);
            if (ok) setCopied(true);
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface hover:text-fg"
          aria-label={copied ? 'Code copied' : 'Copy code'}
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div ref={containerRef} className="overflow-x-auto scrollbar-thin">
        {html === null ? (
          <pre>
            <code>{code}</code>
          </pre>
        ) : (
          <pre>
            <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        )}
      </div>
    </div>
  );
});
