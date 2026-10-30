import type { ReactNode } from 'react';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { SectionData } from '@/lib/store/engine/section-data';
import type { Template, ThemeData, ThemeRow } from '@/lib/store/engine/types';
import type { GroupKey } from '@/lib/store/engine/editor/ops';
import { engineRootStyle } from '@/lib/store/engine/render-helpers';
import { EditorBridge } from './EditorBridge';
import { EngineShell } from './EngineShell';
import { SectionFrame } from './SectionFrame';
import { SECTION_COMPONENTS, type EngineRoute } from './registry';
import { EngineProductProvider } from './product/EngineProductContext';

const EMPTY: Template = { order: [], sections: {} };

function renderGroup(
  groupKey: GroupKey,
  group: Template | undefined,
  store: StoreBusinessContext,
  theme: ThemeData,
  data: Record<string, SectionData>,
  editor: boolean,
  route: EngineRoute | undefined,
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
    if (!Component) {
      // Unknown type: shoppers see nothing; the editor shows the failed card so it can be selected and removed.
      if (editor) {
        out.push(
          <SectionFrame key={id} id={id} section={section} theme={theme} group={groupKey} index={index} editor failed />,
        );
      }
      continue;
    }
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
        <Component id={id} section={section} data={sectionData} store={store} theme={theme} route={route} />
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
  route,
}: {
  store: StoreBusinessContext;
  theme: ThemeRow;
  templateKey: string;
  data: Record<string, SectionData>;
  preview: boolean;
  /** Studio 2 editor mode (only ever true for a verified preview). */
  editor: boolean;
  /** What the URL names; a product id wraps the template in the product provider. */
  route?: EngineRoute;
}) {
  const themeData = theme.data;
  const templateGroup = renderGroup('template', themeData.templates[templateKey], store, themeData, data, editor, route);
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
      header={renderGroup('header', themeData.header_group, store, themeData, data, editor, route)}
      footer={renderGroup('footer', themeData.footer_group, store, themeData, data, editor, route)}
    >
      {route?.productId ? (
        <EngineProductProvider subdomain={store.store_subdomain} productId={route.productId}>
          {templateGroup}
        </EngineProductProvider>
      ) : (
        templateGroup
      )}
      {editor ? <EditorBridge templateKey={templateKey} /> : null}
    </EngineShell>
  );
}
