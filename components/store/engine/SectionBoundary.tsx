'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Editor mode only (D8): the section's name, never the raw error. */
export function SectionFailedCard({ name }: { name: string }) {
  return (
    <div
      role="alert"
      style={{
        margin: '8px 16px',
        padding: '14px 16px',
        borderRadius: 8,
        border: '1px solid #fca5a5',
        background: '#fef2f2',
        color: '#b91c1c',
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      {name}: This section failed to load
    </div>
  );
}

/**
 * A section that throws while rendering on the storefront disappears instead of taking the page down.
 * In the editor (`editorName` set) it shows the failed-section card instead. When `resetKey` changes
 * (the editor saved new settings for the section) the boundary tries the section again.
 */
export class SectionBoundary extends Component<
  { type: string; editorName?: string; resetKey?: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error('[engine section]', this.props.type, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.editorName ? <SectionFailedCard name={this.props.editorName} /> : null;
  }
}
