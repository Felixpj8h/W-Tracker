import { describe, expect, it } from 'vitest';
import { createSseParser } from './api';

describe('Coach SSE parser', () => {
  it('handles split UTF-8 bytes, multiple events, malformed data, and final buffer', () => {
    const events: unknown[] = [];
    const parser = createSseParser(event => events.push(event));
    const bytes = new TextEncoder().encode('event: text.delta\ndata: {"type":"text.delta","text":"Løft"}\n\nevent: bad\ndata: nope\n\nevent: message.completed\ndata: {"type":"message.completed"}');
    for (const byte of bytes) parser.push(Uint8Array.of(byte));
    parser.finish();
    expect(events).toEqual([{ type: 'text.delta', text: 'Løft' }, { type: 'message.completed' }]);
  });
});
