import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoachMarkdown } from './CoachMarkdown';

describe('Coach Markdown safety', () => {
  it('omits raw HTML and unsafe links', () => {
    const html = renderToStaticMarkup(<CoachMarkdown>{'<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [good](https://example.com)'}</CoachMarkdown>);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://example.com');
  });

  it.each([
    String.raw`$$\text{80 kg} \times 1.6\text{ g/kg} = 128\text{ g}$$`,
    '$$\n' + String.raw`\text{80 kg} \times 1.6\text{ g/kg} = 128\text{ g}` + '\n$$',
  ])('renders protein math with accessible MathML: %s', equation => {
    const html = renderToStaticMarkup(<CoachMarkdown>{`That is 128 g of protein.\n\n${equation}`}</CoachMarkdown>);
    expect(html).toContain('That is 128 g of protein.');
    expect(html).toContain('class="katex"');
    expect(html).toContain('<math');
    expect(html).toContain('<mn>128</mn>');
    expect(html).not.toContain('$$');
    expect(html).not.toContain('<pre>');
    expect(html).not.toContain('katex-error');
  });

  it('keeps tables and inline math working', () => {
    const html = renderToStaticMarkup(<CoachMarkdown>{'Protein: $80 \\times 1.6 = 128$ g.\n\n| Day | Plan |\n| --- | --- |\n| Monday | Strength |'}</CoachMarkdown>);
    expect(html).toContain('class="katex"');
    expect(html).toContain('<table>');
  });

  it('does not trust TeX commands that embed links or HTML', () => {
    const html = renderToStaticMarkup(<CoachMarkdown>{String.raw`$\href{javascript:alert(1)}{click}$ $\htmlClass{injected}{x}$`}</CoachMarkdown>);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('class="injected"');
  });
});
