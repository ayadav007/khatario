import { SseParser, type SseItem } from '@/lib/notifications/client/sse-parser';

const STREAM =
  'event: connected\ndata: {"message":"SSE stream connected"}\n\n' +
  ': ping\n\n' +
  'id: 1000000000005\nevent: message\ndata: {"type":"todo_reminder","seq":"1000000000005","title":"Pay ₹500 – GST"}\n\n' +
  'retry: 4000\r\nevent: reconnect\r\ndata: {"reason":"shutdown","delay_ms":4000}\r\n\r\n' +
  'data: line one\rdata: line two\r\r' +
  'id: 7\nevent: resync\ndata: {"reason":"too_many","latest_seq":"7"}\n\n';

const EXPECTED: SseItem[] = [
  { kind: 'event', event: 'connected', data: '{"message":"SSE stream connected"}' },
  { kind: 'comment', text: 'ping' },
  {
    kind: 'event',
    event: 'message',
    id: '1000000000005',
    data: '{"type":"todo_reminder","seq":"1000000000005","title":"Pay ₹500 – GST"}',
  },
  { kind: 'event', event: 'reconnect', retry: 4000, data: '{"reason":"shutdown","delay_ms":4000}' },
  { kind: 'event', event: 'message', data: 'line one\nline two' },
  { kind: 'event', event: 'resync', id: '7', data: '{"reason":"too_many","latest_seq":"7"}' },
];

function parseBytes(bytes: Uint8Array, cuts: number[]): SseItem[] {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const out: SseItem[] = [];
  let start = 0;
  for (const cut of [...cuts, bytes.length]) {
    out.push(...parser.feed(decoder.decode(bytes.subarray(start, cut), { stream: true })));
    start = cut;
  }
  return out;
}

describe('SseParser', () => {
  const bytes = new TextEncoder().encode(STREAM);

  it('parses a whole stream', () => {
    expect(parseBytes(bytes, [])).toEqual(EXPECTED);
  });

  it('gives the same result for every single split point (including inside CRLF and multi-byte characters)', () => {
    for (let cut = 1; cut < bytes.length; cut += 1) {
      expect(parseBytes(bytes, [cut])).toEqual(EXPECTED);
    }
  });

  it('gives the same result byte by byte and for random chunkings', () => {
    expect(parseBytes(bytes, Array.from({ length: bytes.length - 1 }, (_, i) => i + 1))).toEqual(EXPECTED);
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 200; run += 1) {
      const cuts = new Set<number>();
      const n = 1 + Math.floor(rnd() * 20);
      for (let i = 0; i < n; i += 1) cuts.add(1 + Math.floor(rnd() * (bytes.length - 1)));
      expect(parseBytes(bytes, [...cuts].sort((a, b) => a - b))).toEqual(EXPECTED);
    }
  });

  it('ignores unknown fields, blocks without data, and invalid retry values', () => {
    const p = new SseParser();
    expect(p.feed('foo: bar\nretry: soon\n\nid: 3\n\n')).toEqual([]);
    expect(p.feed('data\n\n')).toEqual([{ kind: 'event', event: 'message', data: '' }]);
    expect(p.feed('data:no-space\n\n')).toEqual([{ kind: 'event', event: 'message', data: 'no-space' }]);
  });

  it('holds an incomplete event until its blank line arrives', () => {
    const p = new SseParser();
    expect(p.feed('id: 9\nevent: message\ndata: {"a"')).toEqual([]);
    expect(p.feed(':1}\n')).toEqual([]);
    expect(p.feed('\n')).toEqual([{ kind: 'event', event: 'message', id: '9', data: '{"a":1}' }]);
  });
});
