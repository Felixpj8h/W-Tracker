import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/** Shared renderer for both streaming and saved replies. Raw HTML remains disabled. */
export function CoachMarkdown({ children }: { children: string }) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, { trust: false, maxSize: 20, maxExpand: 1000 }]]}
    skipHtml
    urlTransform={url => /^https?:\/\//i.test(url) ? url : ''}
    components={{ a: props => <a {...props} target="_blank" rel="noreferrer noopener"/> }}
  >{children}</ReactMarkdown>;
}
