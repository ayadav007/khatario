import type { ReactNode } from 'react';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { SectionData } from '@/lib/store/engine/section-data';
import type { Template, ThemeData, ThemeRow } from '@/lib/store/engine/types';
import type { GroupKey } from '@/lib/store/engine/editor/ops';
import { engineRootStyle } from '@/lib/store/engine/render-helpers';
import { EditorBridge } from './EditorBridge';
import { EngineShell } from './EngineShell';
import { SectionFrame } from './SectionFrame';
import { SECTION_COMPONENTS } from './registry';

const EMPTY: Template = { order: [], sections: {} };

function renderGroup(
  groupKey: GroupKey,
  group: Template | undefined,
  store: StoreBusinessContext,
  theme: ThemeData,
  data: Record<string, SectionData>,
  editor: boolean,
): ReactNode[] {
  const out: ReactNode[] = [];
  const order = group?.order ?? [];
  for (let index = 0; index < order.length; index++) {
    const id = order[index];
    const section = group?.sections[id];
    if (!section || section.disabled) continue;
    const Component = Object.prototype.hasOwnProperty.call(SECTION_COMPONENTS, section.type)
      ? SECTION_COMPONENTS[section.type]
      : null;
    if (!Component) continue;
    const sectionData = data[id];
    if (sectionData?.error) {
      // Shoppers never see the message; the section is simply left out. The editor shows a red card.
      console.error('[engine section]', section.type, id, sectionData.error);
      if (editor) {
        out.push(
          <SectionFrame key={id} id={id} section={section} theme={theme} group={groupKey} index={index} editor failed />,
        );
      }
      continue;
    }
    out.push(
      <SectionFrame key={id} id={id} section={section} theme={theme} group={groupKey} index={index} editor={editor}>
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
  editor,
}: {
  store: StoreBusinessContext;
  theme: ThemeRow;
  templateKey: string;
  data: Record<string, SectionData>;
  preview: boolean;
  /** Studio 2 editor mode (only ever true for a verified preview). */
  editor: boolean;
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
      subdomain={store.store_subdomain}
      preview={preview}
      editor={editor}
      rootStyle={engineRootStyle(themeData.settings)}
      header={renderGroup('header', themeData.header_group, store, themeData, data, editor)}
      footer={renderGroup('footer', themeData.footer_group, store, themeData, data, editor)}
    >
      {renderGroup('template', themeData.templates[templateKey], store, themeData, data, editor)}
      {editor ? <EditorBridge templateKey={templateKey} /> : null}
    </EngineShell>
  );
}
