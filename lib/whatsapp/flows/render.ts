import type { FlowNode } from './schema';
import type { FlowReply } from './send';

export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = context[key];
    return v == null ? '' : String(v);
  });
}

export function renderNode(node: FlowNode, context: Record<string, unknown>): FlowReply | null {
  if (node.type === 'message') {
    return { text: interpolate(node.data.body, context), footer: interpolate(node.data.footer || '', context) || undefined };
  }
  if (node.type === 'buttons') {
    return {
      text: interpolate(node.data.body, context),
      footer: interpolate(node.data.footer || '', context) || undefined,
      buttons: node.data.buttons.map((b) => ({ id: b.id, title: interpolate(b.title, context) })),
    };
  }
  if (node.type === 'list') {
    return {
      text: interpolate(node.data.body, context),
      footer: interpolate(node.data.footer || '', context) || undefined,
      list: {
        buttonText: interpolate(node.data.buttonText, context),
        rows: node.data.rows.map((r) => ({
          id: r.id,
          title: interpolate(r.title, context),
          description: interpolate(r.description || '', context) || undefined,
        })),
      },
    };
  }
  if (node.type === 'ask') {
    return { text: interpolate(node.data.body, context) };
  }
  return null;
}
