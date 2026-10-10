import { memo, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

/**
 * Memoized so a re-render of the chat never re-parses untouched markdown.
 * Syntax highlighting is deferred to CodeBlock, which lazy-loads highlight.js.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props: ComponentPropsWithoutRef<'code'> & { className?: string }) {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className ?? '');
            const value = String(children ?? '');
            const isBlock = Boolean(match) || value.includes('\n');
            if (!isBlock) {
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            }
            return <CodeBlock code={value.replace(/\n$/, '')} language={match?.[1]} />;
          },
          pre({ children }) {
            // CodeBlock renders its own <pre>; this avoids nesting one inside another.
            return <>{children}</>;
          },
          a({ children, ...rest }) {
            return (
              <a target="_blank" rel="noreferrer noopener" {...rest}>
                {children}
              </a>
            );
          },
          img({ src, alt, ...rest }) {
            if (typeof src !== 'string' || !src.startsWith('https://')) return null;
            return <img src={src} alt={alt ?? ''} loading="lazy" className="max-w-full rounded-lg" {...rest} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
