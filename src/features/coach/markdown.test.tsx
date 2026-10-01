import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

describe('Coach Markdown safety', () => {
  it('omits raw HTML and unsafe links', () => {
    const html = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => /^https?:\/\//i.test(url) ? url : ''}>{'<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [good](https://example.com)'}</ReactMarkdown>);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://example.com');
  });
});
