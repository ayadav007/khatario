export type SseMessage = {
  kind: 'event';
  event: string;
  data: string;
  /** Only set when this event carried an `id:` field (control events usually do not). */
  id?: string;
  retry?: number;
};
export type SseComment = { kind: 'comment'; text: string };
export type SseItem = SseMessage | SseComment;

/**
 * Incremental text/event-stream parser (WHATWG rules): accepts arbitrary chunk boundaries,
 * including a CRLF split across chunks. Feed it decoded text (TextDecoder with stream: true).
 */
export class SseParser {
  private buffer = '';
  private pendingCr = false;
  private data: string[] = [];
  private eventType = '';
  private id: string | undefined;
  private retry: number | undefined;

  feed(chunk: string): SseItem[] {
    const out: SseItem[] = [];
    let text = chunk;
    if (this.pendingCr) {
      this.pendingCr = false;
      if (text.startsWith('\n')) text = text.slice(1);
    }
    this.buffer += text;

    for (;;) {
      const m = /\r\n|\r|\n/.exec(this.buffer);
      if (!m) break;
      // A trailing lone CR may be the first half of a CRLF still in flight.
      if (m[0] === '\r' && m.index === this.buffer.length - 1) {
        this.pendingCr = true;
      }
      const line = this.buffer.slice(0, m.index);
      this.buffer = this.buffer.slice(m.index + m[0].length);
      const item = this.line(line);
      if (item) out.push(item);
    }
    return out;
  }

  private line(line: string): SseItem | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) {
      return { kind: 'comment', text: line.slice(1).replace(/^ /, '') };
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    switch (field) {
      case 'data':
        this.data.push(value);
        break;
      case 'event':
        this.eventType = value;
        break;
      case 'id':
        if (!value.includes('\0')) this.id = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break;
    }
    return null;
  }

  private dispatch(): SseItem | null {
    const hadData = this.data.length > 0;
    const item: SseMessage = {
      kind: 'event',
      event: this.eventType || 'message',
      data: this.data.join('\n'),
      ...(this.id !== undefined ? { id: this.id } : {}),
      ...(this.retry !== undefined ? { retry: this.retry } : {}),
    };
    this.data = [];
    this.eventType = '';
    this.id = undefined;
    this.retry = undefined;
    return hadData ? item : null;
  }
}
