import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ISSUES_URL, SOURCES } from './sources';
import { SourcesPanel } from './SourcesPanel';

describe('the sources list (ToLaD#429)', () => {
  it('every entry has a name, a what-for and a link, and no name twice', () => {
    for (const s of SOURCES) {
      expect(s.name.trim(), JSON.stringify(s)).not.toBe('');
      expect(s.use.trim(), s.name).not.toBe('');
      expect(s.url, s.name).toMatch(/^https:\/\//);
    }
    expect(new Set(SOURCES.map((s) => s.name)).size).toBe(SOURCES.length);
  });

  it('the panel lists one line per source, a close button and the way to ask for a take-down', () => {
    const html = renderToStaticMarkup(React.createElement(SourcesPanel, { onClose: () => {} }));
    expect(html.match(/<li>/g)).toHaveLength(SOURCES.length);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain(`href="${ISSUES_URL}"`);
  });
});
