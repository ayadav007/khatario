'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/** A section that throws while rendering on the storefront disappears instead of taking the page down. */
export class SectionBoundary extends Component<{ type: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error('[engine section]', this.props.type, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
