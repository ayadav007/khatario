import type { ReactNode } from 'react';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { SectionData } from '@/lib/store/engine/section-data';
import type { Template, ThemeData, ThemeRow } from '@/lib/store/engine/types';
import { engineRootStyle } from '@/lib/store/engine/render-helpers';
import { EngineShell } from './EngineShell';
import { SectionFrame } from './SectionFrame';
import { SECTION_COMPONENTS } from './registry';

const EMPTY: Template = { order: [], sections: {} };

function renderGroup(
  group: Template | undefined,
  store: StoreBusinessContext,
  theme: ThemeData,
  data: Record<string, SectionData>,
): ReactNode[] {
  const out: ReactNode[] = [];
  for (const id of group?.order ?? []) {
    const section = group?.sections[id];
    if (!section || section.disabled) continue;
    const Component = Object.prototype.hasOwnProperty.call(SECTION_COMPONENTS, section.type)
      ? SECTION_COMPONENTS[section.type]
      : null;
    if (!Component) continue;
    const sectionData = data[id];
    if (sectionData?.error) {
      // Shoppers never see the message; the section is simply left out.
      console.error('[engine section]', section.type, id, sectionData.error);
      continue;
    }
    out.push(
      <SectionFrame key={id} id={id} section={section} theme={theme}>
        <Component id={id} section={section} data={sectionData} store={store} theme={theme} />
      </SectionFrame>,
    );
  }
  return out;
}

/** Server renderer: header group, the template, footer group, inside the engine shell. */
export function RenderTemplate({
  store,
  theme,
  templateKey,
  data,
  preview,
}: {
  store: StoreBusinessContext;
  theme: ThemeRow;
  templateKey: string;
  data: Record<string, SectionData>;
  preview: boolean;
}) {
  const themeData = theme.data;
  // The client shell only reads settings, so the templates are not sent to the browser twice.
  const shellTheme: ThemeRow = {
    ...theme,
    data: { settings: themeData.settings, header_group: EMPTY, footer_group: EMPTY, templates: {} },
  };
  return (
    <EngineShell
      theme={shellTheme}
      store={store}
      preview={preview}
      rootStyle={engineRootStyle(themeData.settings)}
      header={renderGroup(themeData.header_group, store, themeData, data)}
      footer={renderGroup(themeData.footer_group, store, themeData, data)}
    >
      {renderGroup(themeData.templates[templateKey], store, themeData, data)}
    </EngineShell>
  );
}
