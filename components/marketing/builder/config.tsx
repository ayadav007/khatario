'use client';

import type { ComponentType, ReactNode } from 'react';
import type { Config, Field } from '@puckeditor/core';
import { FieldLabel } from '@puckeditor/core';
import { clsx } from 'clsx';
import { MarketingEditingProvider } from '@/components/marketing/builder/MarketingEditingContext';
import { ImageFieldInput } from '@/components/marketing/builder/ImageField';
import { MARKETING_ICON_OPTIONS } from '@/components/marketing/builder/icons';
import {
  CardBlock,
  COLUMN_COUNT,
  COLUMN_TEMPLATE,
  DividerBlock,
  GAP,
  SectionBlock,
  SpacerBlock,
  STACK_GAP,
  VERTICAL_ALIGN,
  type ColumnsLayout,
  type Gap,
  type SectionProps,
} from '@/components/marketing/builder/blocks/LayoutBlocks';
import {
  BadgeBlock,
  ButtonsBlock,
  HeadingBlock,
  IconListBlock,
  ImageBlock,
  ScreenshotBlock,
  StatsBlock,
  TestimonialBlock,
  TextBlock,
  VideoBlock,
} from '@/components/marketing/builder/blocks/ContentBlocks';
import { LandingHero, LANDING_HERO_DEFAULTS } from '@/components/marketing/landing/LandingHero';
import {
  LandingSocialProof,
  LANDING_SOCIAL_PROOF_DEFAULTS,
} from '@/components/marketing/landing/LandingSocialProof';
import {
  LandingProblemSolution,
  LANDING_PROBLEM_SOLUTION_DEFAULTS,
} from '@/components/marketing/landing/LandingProblemSolution';
import {
  LandingWalkthrough,
  LANDING_WALKTHROUGH_DEFAULTS,
} from '@/components/marketing/landing/LandingWalkthrough';
import {
  LandingKeyFeatures,
  LANDING_KEY_FEATURES_DEFAULTS,
} from '@/components/marketing/landing/LandingKeyFeatures';
import {
  LandingTemplateGallery,
  LANDING_TEMPLATE_GALLERY_DEFAULTS,
} from '@/components/marketing/landing/LandingTemplateGallery';
import { LandingWhoItsFor, LANDING_WHO_ITS_FOR_DEFAULTS } from '@/components/marketing/landing/LandingWhoItsFor';
import {
  LandingConnectedSupply,
  LANDING_CONNECTED_SUPPLY_DEFAULTS,
} from '@/components/marketing/landing/LandingConnectedSupply';
import { LandingTrustStrip, LANDING_TRUST_STRIP_DEFAULTS } from '@/components/marketing/landing/LandingTrustStrip';
import { LandingPricing, LANDING_PRICING_DEFAULTS } from '@/components/marketing/landing/LandingPricing';
import { LandingFaq, LANDING_FAQ_DEFAULTS } from '@/components/marketing/landing/LandingFaq';
import { LandingFinalCta, LANDING_FINAL_CTA_DEFAULTS } from '@/components/marketing/landing/LandingFinalCta';
import { BRAND_COLOR_OPTIONS, brandStyle, HEADING_FONT_OPTIONS } from '@/lib/marketing-builder/brand';
import { CONTENT_BLOCKS, KHATARIO_BLOCKS, LAYOUT_BLOCKS } from '@/lib/marketing-builder/block-types';

/* Field helpers ------------------------------------------------------------ */

const MD_HINT = ' (supports **bold**, *italic*, [link](/path))';

const text = (label: string): Field => ({ type: 'text', label });
const area = (label: string): Field => ({ type: 'textarea', label });
const md = (label: string): Field => ({ type: 'textarea', label: label + MD_HINT });
const link = (label: string): Field => ({ type: 'text', label: `${label} (/path, #section or https://)` });
const yesNo = (label: string): Field => ({
  type: 'radio',
  label,
  options: [
    { label: 'Yes', value: true },
    { label: 'No', value: false },
  ],
});
const choice = (label: string, options: [string, string][], radio = false): Field => ({
  type: radio ? 'radio' : 'select',
  label,
  options: options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
});
const icon = (label = 'Icon'): Field => ({ type: 'select', label, options: MARKETING_ICON_OPTIONS });
const image = (label: string): Field => ({
  type: 'custom',
  label,
  render: ({ value, onChange, readOnly, field }) => (
    <FieldLabel label={field.label ?? label} el="div" readOnly={readOnly}>
      <ImageFieldInput value={value as string} onChange={onChange} readOnly={readOnly} />
    </FieldLabel>
  ),
});
const list = (
  label: string,
  arrayFields: Record<string, Field>,
  summary: (item: Record<string, unknown>, i: number) => string,
  defaultItemProps: Record<string, unknown>,
  max = 24,
): Field => ({
  type: 'array',
  label,
  arrayFields,
  getItemSummary: (item: Record<string, unknown>, i?: number) => summary(item, i ?? 0) || `Item ${(i ?? 0) + 1}`,
  defaultItemProps,
  max,
});

/** Puck types block props loosely; each block component merges its own defaults. */
function renderAs<P extends object>(Component: ComponentType<P>) {
  function PuckBlock(props: unknown) {
    return <Component {...(props as P & JSX.IntrinsicAttributes)} />;
  }
  PuckBlock.displayName = `Puck(${Component.displayName || Component.name || 'Block'})`;
  return PuckBlock;
}

const ALIGN: [string, string][] = [
  ['left', 'Left'],
  ['center', 'Centre'],
  ['right', 'Right'],
];
const GAPS: [string, string][] = [
  ['sm', 'Small'],
  ['md', 'Medium'],
  ['lg', 'Large'],
  ['xl', 'Extra large'],
];

/* Config ------------------------------------------------------------------- */

export const marketingConfig: Config = {
  categories: {
    layout: { title: 'Layout', components: [...LAYOUT_BLOCKS] },
    content: { title: 'Content', components: [...CONTENT_BLOCKS] },
    khatario: { title: 'Khatario sections', components: [...KHATARIO_BLOCKS], defaultExpanded: true },
  },

  root: {
    fields: {
      title: text('SEO title (browser tab and Google)'),
      description: area('SEO description'),
      ogImage: image('Share image (WhatsApp, social links)'),
      brandColor: { type: 'select', label: 'Brand colour', options: BRAND_COLOR_OPTIONS },
      headingFont: { type: 'select', label: 'Heading font', options: HEADING_FONT_OPTIONS },
    },
    defaultProps: { title: '', description: '', ogImage: '', brandColor: 'teal', headingFont: 'default' },
    render: (props: unknown) => {
      const { children, brandColor, headingFont, puck } = props as {
        children?: ReactNode;
        brandColor?: string;
        headingFont?: string;
        puck?: { isEditing?: boolean };
      };
      return (
        <MarketingEditingProvider editing={Boolean(puck?.isEditing)}>
          <div className="mb-page" style={brandStyle(brandColor, headingFont)}>
            {children}
          </div>
        </MarketingEditingProvider>
      );
    },
  },

  components: {
    /* Layout ---------------------------------------------------------------- */
    Section: {
      label: 'Section',
      fields: {
        background: choice('Background', [
          ['white', 'White'],
          ['muted', 'Soft grey'],
          ['tint', 'Brand tint'],
          ['gradient', 'Soft gradient'],
          ['dark', 'Dark'],
          ['brand', 'Brand colour'],
          ['image', 'Image'],
        ]),
        backgroundImage: image('Background image (when Background = Image)'),
        overlay: choice('Image overlay', [
          ['none', 'None'],
          ['light', 'Light'],
          ['medium', 'Medium'],
          ['strong', 'Strong'],
        ]),
        width: choice('Content width', [
          ['full', 'Full'],
          ['wide', 'Wide'],
          ['narrow', 'Narrow'],
        ], true),
        paddingY: choice('Vertical spacing', [
          ['none', 'None'],
          ['sm', 'Small'],
          ['md', 'Medium'],
          ['lg', 'Large'],
          ['xl', 'Extra large'],
        ]),
        border: choice('Border line', [
          ['none', 'None'],
          ['top', 'Top'],
          ['bottom', 'Bottom'],
          ['both', 'Top and bottom'],
        ]),
        anchor: text('Anchor id (for #links, letters and dashes)'),
        content: { type: 'slot' },
      },
      defaultProps: {
        background: 'white',
        backgroundImage: '',
        overlay: 'medium',
        width: 'full',
        paddingY: 'lg',
        border: 'none',
        anchor: '',
        content: [],
      },
      render: ({ content: Content, ...p }) => (
        <SectionBlock {...(p as unknown as SectionProps)}>
          <Content className={STACK_GAP} minEmptyHeight={96} />
        </SectionBlock>
      ),
    },

    Columns: {
      label: 'Columns',
      fields: {
        layout: choice('Layout', [
          ['1-1', 'Two equal'],
          ['1-2', 'Narrow + wide'],
          ['2-1', 'Wide + narrow'],
          ['5-7', '5 / 7'],
          ['7-5', '7 / 5'],
          ['1-3', 'Sidebar + main'],
          ['3-1', 'Main + sidebar'],
          ['1-1-1', 'Three equal'],
          ['1-1-1-1', 'Four equal'],
        ]),
        stackBelow: choice('Stack columns below', [
          ['md', 'Tablet (768px)'],
          ['lg', 'Laptop (1024px)'],
        ], true),
        gap: choice('Gap', GAPS),
        verticalAlign: choice('Vertical alignment', [
          ['start', 'Top'],
          ['center', 'Middle'],
          ['end', 'Bottom'],
          ['stretch', 'Stretch'],
        ]),
        reverseOnMobile: yesNo('Show last column first on phones'),
        col1: { type: 'slot', label: 'Column 1' },
        col2: { type: 'slot', label: 'Column 2' },
        col3: { type: 'slot', label: 'Column 3 (three/four layouts)' },
        col4: { type: 'slot', label: 'Column 4 (four layout)' },
      },
      defaultProps: {
        layout: '1-1',
        stackBelow: 'lg',
        gap: 'lg',
        verticalAlign: 'center',
        reverseOnMobile: false,
        col1: [],
        col2: [],
        col3: [],
        col4: [],
      },
      render: ({ layout, stackBelow, gap, verticalAlign, reverseOnMobile, col1, col2, col3, col4 }) => {
        const l = (layout as ColumnsLayout) in COLUMN_COUNT ? (layout as ColumnsLayout) : '1-1';
        const count = COLUMN_COUNT[l];
        const cols = [col1, col2, col3, col4].slice(0, count);
        const bp = stackBelow === 'md' ? 'md' : 'lg';
        return (
          <div
            className={clsx(
              'grid w-full grid-cols-1',
              COLUMN_TEMPLATE[bp][l],
              GAP[(gap as Gap) ?? 'lg'],
              VERTICAL_ALIGN[verticalAlign as keyof typeof VERTICAL_ALIGN] ?? 'items-center',
            )}
          >
            {cols.map((Col, i) => (
              <Col
                key={i}
                className={clsx(
                  STACK_GAP,
                  'min-w-0',
                  reverseOnMobile && i === count - 1 && (bp === 'md' ? 'max-md:order-first' : 'max-lg:order-first'),
                )}
                minEmptyHeight={80}
              />
            ))}
          </div>
        );
      },
    },

    Grid: {
      label: 'Grid',
      fields: {
        columns: choice('Columns on desktop', [
          ['2', '2'],
          ['3', '3'],
          ['4', '4'],
        ], true),
        gap: choice('Gap', GAPS),
        items: { type: 'slot' },
      },
      defaultProps: { columns: '3', gap: 'md', items: [] },
      render: ({ columns, gap, items: Items }) => (
        <Items
          className={clsx(
            'grid w-full grid-cols-1 sm:grid-cols-2',
            columns === '3' && 'lg:grid-cols-3',
            columns === '4' && 'lg:grid-cols-4',
            GAP[(gap as Gap) ?? 'md'],
          )}
          minEmptyHeight={96}
        />
      ),
    },

    Card: {
      label: 'Card',
      fields: {
        style: choice('Style', [
          ['outlined', 'Outlined'],
          ['shadow', 'Shadow'],
          ['tinted', 'Tinted'],
          ['plain', 'Plain'],
          ['dark', 'Dark'],
          ['glass', 'Glass (on dark sections)'],
        ]),
        padding: choice('Padding', [
          ['sm', 'Small'],
          ['md', 'Medium'],
          ['lg', 'Large'],
        ], true),
        fullHeight: yesNo('Match height of neighbours'),
        content: { type: 'slot' },
      },
      defaultProps: { style: 'outlined', padding: 'md', fullHeight: true, content: [] },
      render: ({ content: Content, style, padding, fullHeight }) => (
        <CardBlock style={style} padding={padding} fullHeight={fullHeight}>
          <Content className="flex flex-col gap-4" minEmptyHeight={64} />
        </CardBlock>
      ),
    },

    Spacer: {
      label: 'Spacer',
      fields: {
        size: choice('Height', [
          ['xs', 'Extra small'],
          ['sm', 'Small'],
          ['md', 'Medium'],
          ['lg', 'Large'],
          ['xl', 'Extra large'],
        ]),
        desktopOnly: yesNo('Desktop only'),
      },
      defaultProps: { size: 'md', desktopOnly: false },
      render: ({ size, desktopOnly }) => <SpacerBlock size={size} desktopOnly={desktopOnly} />,
    },

    Divider: {
      label: 'Divider',
      fields: { style: choice('Line', [['solid', 'Solid'], ['dashed', 'Dashed']], true) },
      defaultProps: { style: 'solid' },
      render: ({ style }) => <DividerBlock style={style} />,
    },

    /* Content --------------------------------------------------------------- */
    Heading: {
      label: 'Heading',
      fields: {
        eyebrow: text('Small label above (optional)'),
        text: { type: 'textarea', label: 'Heading (wrap words in **stars** to colour them)' },
        level: choice('HTML level (one h1 per page)', [
          ['h1', 'H1'],
          ['h2', 'H2'],
          ['h3', 'H3'],
          ['h4', 'H4'],
        ], true),
        size: choice('Size', [
          ['sm', 'Small'],
          ['md', 'Medium'],
          ['lg', 'Large'],
          ['xl', 'Extra large'],
          ['display', 'Display (hero)'],
        ]),
        align: choice('Alignment', ALIGN, true),
      },
      defaultProps: { eyebrow: '', text: 'Your heading', level: 'h2', size: 'lg', align: 'left' },
      render: renderAs(HeadingBlock),
    },

    Text: {
      label: 'Text',
      fields: {
        text: md('Text'),
        size: choice('Size', [['sm', 'Small'], ['md', 'Normal'], ['lg', 'Large']], true),
        align: choice('Alignment', ALIGN, true),
        width: choice('Line length', [['prose', 'Comfortable'], ['full', 'Full width']], true),
      },
      defaultProps: {
        text: 'Write something helpful. Use a blank line to start a new paragraph, or "- " for a list.',
        size: 'md',
        align: 'left',
        width: 'prose',
      },
      render: renderAs(TextBlock),
    },

    Image: {
      label: 'Image',
      fields: {
        image: image('Image'),
        alt: text('Alt text (describe the image for screen readers and Google)'),
        aspect: choice('Shape', [
          ['auto', 'Original'],
          ['16/9', 'Wide 16:9'],
          ['16/10', 'Screen 16:10'],
          ['4/3', 'Classic 4:3'],
          ['1/1', 'Square'],
          ['3/4', 'Portrait 3:4'],
        ]),
        fit: choice('Fit', [['cover', 'Fill (crop)'], ['contain', 'Fit (no crop)']], true),
        rounded: choice('Corners', [['none', 'Square'], ['md', 'Rounded'], ['xl', 'Very rounded']], true),
        shadow: yesNo('Shadow'),
        caption: text('Caption (optional)'),
        href: link('Link (optional)'),
      },
      defaultProps: { image: '', alt: '', aspect: 'auto', fit: 'cover', rounded: 'xl', shadow: true, caption: '', href: '' },
      render: renderAs(ImageBlock),
    },

    Buttons: {
      label: 'Buttons',
      fields: {
        buttons: list(
          'Buttons',
          {
            label: text('Label'),
            href: link('Link'),
            style: choice('Style', [
              ['primary', 'Primary'],
              ['secondary', 'Secondary'],
              ['outline', 'Outline'],
              ['link', 'Text link'],
            ]),
            arrow: yesNo('Arrow'),
          },
          (b) => String(b.label ?? ''),
          { label: 'Button', href: '/signup', style: 'primary', arrow: false },
          4,
        ),
        align: choice('Alignment', ALIGN, true),
        size: choice('Size', [['md', 'Medium'], ['lg', 'Large']], true),
        stackOnMobile: yesNo('Full-width on phones'),
      },
      defaultProps: {
        buttons: [
          { label: 'Start free trial', href: '/signup', style: 'primary', arrow: true },
          { label: 'Book a demo', href: '/book-demo', style: 'outline', arrow: false },
        ],
        align: 'left',
        size: 'lg',
        stackOnMobile: true,
      },
      render: renderAs(ButtonsBlock),
    },

    Badge: {
      label: 'Badge',
      fields: {
        text: text('Text'),
        icon: { type: 'select', label: 'Icon', options: [{ label: 'None', value: 'none' }, ...MARKETING_ICON_OPTIONS] },
        tone: choice('Colour', [['neutral', 'Neutral'], ['brand', 'Brand'], ['amber', 'Amber']], true),
        align: choice('Alignment', ALIGN, true),
      },
      defaultProps: { text: 'New', icon: 'sparkles', tone: 'neutral', align: 'left' },
      render: renderAs(BadgeBlock),
    },

    IconList: {
      label: 'Feature list',
      fields: {
        items: list(
          'Items',
          { icon: icon(), title: text('Title'), text: md('Description'), tag: text('Tag (optional)') },
          (item) => String(item.title ?? ''),
          { icon: 'check', title: 'Feature', text: 'Explain the benefit in one line.', tag: '' },
        ),
        layout: choice('Layout', [
          ['list', 'Single column'],
          ['grid-2', 'Two columns'],
          ['grid-3', 'Three columns'],
          ['grid-4', 'Four columns'],
        ]),
        iconStyle: choice('Icon style', [['boxed', 'Boxed'], ['plain', 'Plain'], ['check', 'Green tick']], true),
      },
      defaultProps: {
        items: [
          { icon: 'fileText', title: 'GST bills in a minute', text: 'HSN and tax worked out for you.', tag: '' },
          { icon: 'message', title: 'Share on WhatsApp', text: 'Send the bill where customers already are.', tag: '' },
        ],
        layout: 'grid-2',
        iconStyle: 'boxed',
      },
      render: renderAs(IconListBlock),
    },

    Stats: {
      label: 'Stats',
      fields: {
        items: list(
          'Numbers',
          { value: text('Number or short fact'), label: text('Label') },
          (s) => String(s.value ?? ''),
          { value: '100+', label: 'What this number means' },
          8,
        ),
        columns: choice('Columns', [['2', '2'], ['3', '3'], ['4', '4']], true),
        style: choice('Style', [['cards', 'Cards'], ['plain', 'Plain']], true),
      },
      defaultProps: {
        items: [
          { value: '20+', label: 'GST-ready templates' },
          { value: '58 & 80mm', label: 'Thermal printing' },
          { value: 'GSTR-1 & 3B', label: 'Exports for filing' },
        ],
        columns: '3',
        style: 'cards',
      },
      render: renderAs(StatsBlock),
    },

    Screenshot: {
      label: 'Screenshot',
      fields: {
        image: image('Screenshot'),
        alt: text('Alt text'),
        frame: choice('Frame', [['browser', 'Browser window'], ['phone', 'Phone'], ['none', 'None']], true),
        caption: text('Caption (optional)'),
      },
      defaultProps: {
        image: '/marketing/screens/dashboard.png',
        alt: 'Khatario dashboard with monthly sales and collections',
        frame: 'browser',
        caption: '',
      },
      render: renderAs(ScreenshotBlock),
    },

    Video: {
      label: 'YouTube video',
      fields: { videoUrl: text('YouTube link'), title: text('Video title (for accessibility)') },
      defaultProps: { videoUrl: '', title: '' },
      render: renderAs(VideoBlock),
    },

    Testimonial: {
      label: 'Testimonial',
      fields: {
        quote: area('Quote'),
        name: text('Name'),
        role: text('Business / role'),
        avatarImage: image('Photo (optional)'),
        rating: { type: 'number', label: 'Stars (0–5)', min: 0, max: 5, step: 1 },
      },
      defaultProps: { quote: 'Use real customer words only.', name: 'Customer name', role: 'Shop, City', avatarImage: '', rating: 5 },
      render: renderAs(TestimonialBlock),
    },

    /* Khatario sections ----------------------------------------------------- */
    Hero: {
      label: 'Hero (top of page)',
      fields: {
        showProductToggle: yesNo('Show Billing / HR / Connect switch'),
        badges: list('Badges', { text: text('Text') }, (b) => String(b.text ?? ''), { text: 'Badge' }, 3),
        headlineLead: text('Headline: first part'),
        headlineAccent: text('Headline: coloured part'),
        rotatingWords: list('Headline: rotating words', { word: text('Word') }, (w) => String(w.word ?? ''), { word: 'simpler' }, 5),
        headlineTail: text('Headline: ending'),
        subhead: area('Sub-heading'),
        footnote: text('Small reassurance line'),
        trustItems: list('Highlights row', { icon: icon(), label: text('Label') }, (t) => String(t.label ?? ''), { icon: 'check', label: 'Highlight' }, 6),
        primaryCta: text('Main button label (links to sign-up)'),
        secondaryLabel: text('Second button label'),
        secondaryHref: link('Second button link'),
        tertiaryLabel: text('Text link label'),
        tertiaryHref: link('Text link'),
        visual: choice('Right side', [['mockup', 'Live bill mockup'], ['image', 'Image']], true),
        image: image('Image (when Right side = Image)'),
        imageAlt: text('Image alt text'),
      },
      defaultProps: LANDING_HERO_DEFAULTS,
      render: renderAs(LandingHero),
    },

    SocialProof: {
      label: 'Business types + facts',
      fields: {
        eyebrow: text('Small heading'),
        intro: md('Intro line'),
        chips: list('Business types', { label: text('Label') }, (c) => String(c.label ?? ''), { label: 'Business type' }, 12),
        facts: list('Facts', { value: text('Big text'), label: text('Label') }, (f) => String(f.value ?? ''), { value: 'Fact', label: 'Explain it' }, 4),
      },
      defaultProps: LANDING_SOCIAL_PROOF_DEFAULTS,
      render: renderAs(LandingSocialProof),
    },

    ProblemSolution: {
      label: 'Pain → fix pairs',
      fields: {
        heading: text('Heading'),
        subtext: area('Sub-heading'),
        painLabel: text('Pain label'),
        solutionLabel: text('Fix label'),
        rows: list(
          'Pairs',
          { problem: text('Pain'), problemDetail: area('Pain detail'), solution: text('Fix'), solutionDetail: area('Fix detail') },
          (r) => String(r.problem ?? ''),
          { problem: 'Pain', problemDetail: '', solution: 'Fix', solutionDetail: '' },
          8,
        ),
      },
      defaultProps: LANDING_PROBLEM_SOLUTION_DEFAULTS,
      render: renderAs(LandingProblemSolution),
    },

    Walkthrough: {
      label: 'Step-by-step screenshots',
      fields: {
        heading: text('Heading'),
        subtext: area('Sub-heading'),
        autoRotate: yesNo('Auto-advance steps'),
        steps: list(
          'Steps',
          { title: text('Title'), blurb: area('Description'), image: image('Screenshot'), alt: text('Alt text') },
          (s) => String(s.title ?? ''),
          { title: 'Step', blurb: '', image: '', alt: '' },
          6,
        ),
      },
      defaultProps: LANDING_WALKTHROUGH_DEFAULTS,
      render: renderAs(LandingWalkthrough),
    },

    KeyFeatures: {
      label: 'Screenshot + feature list',
      fields: {
        heading: text('Heading'),
        subtext: area('Sub-heading'),
        image: image('Screenshot (leave empty for a full-width list)'),
        imageAlt: text('Alt text'),
        caption: text('Caption'),
        features: list(
          'Features',
          {
            icon: icon(),
            title: text('Title'),
            benefit: area('Benefit'),
            tag: text('Tag (optional)'),
            href: link('Link (optional)'),
            anchor: text('Anchor id (optional)'),
          },
          (f) => String(f.title ?? ''),
          { icon: 'check', title: 'Feature', benefit: '', tag: '', href: '', anchor: '' },
          12,
        ),
      },
      defaultProps: LANDING_KEY_FEATURES_DEFAULTS,
      render: renderAs(LandingKeyFeatures),
    },

    TemplateGallery: {
      label: 'Invoice template gallery',
      fields: {
        heading: text('Heading'),
        subtext: area('Sub-heading'),
        modalNote: text('Preview window note'),
        modalCta: text('Preview window button'),
      },
      defaultProps: LANDING_TEMPLATE_GALLERY_DEFAULTS,
      render: renderAs(LandingTemplateGallery),
    },

    WhoItsFor: {
      label: 'Who it is for (dark)',
      fields: {
        heading: text('Heading'),
        subtext: area('Sub-heading'),
        painLabel: text('Pain label'),
        helpLabel: text('Help label'),
        cases: list(
          'Business types',
          { icon: icon(), title: text('Title'), pain: area('Pain'), help: area('How Khatario helps') },
          (c) => String(c.title ?? ''),
          { icon: 'store', title: 'Business type', pain: '', help: '' },
          8,
        ),
      },
      defaultProps: LANDING_WHO_ITS_FOR_DEFAULTS,
      render: renderAs(LandingWhoItsFor),
    },

    ConnectedSupply: {
      label: 'Shops & suppliers',
      fields: {
        badge: text('Badge'),
        heading: text('Heading'),
        subtext: md('Sub-heading'),
        note: md('Small note'),
        retailerLabel: text('Left card label'),
        retailerTitle: text('Left card title'),
        retailerPoints: list('Left card points', { text: md('Point') }, (p) => String(p.text ?? ''), { text: 'Point' }, 8),
        flowLabel: text('Middle label'),
        flowStep1: text('Step 1'),
        flowStep2: text('Step 2'),
        flowStep3: text('Step 3'),
        flowCaption: text('Middle caption'),
        wholesalerLabel: text('Right card label'),
        wholesalerTitle: text('Right card title'),
        wholesalerPoints: list('Right card points', { text: md('Point') }, (p) => String(p.text ?? ''), { text: 'Point' }, 8),
        exampleLabel: text('Example label'),
        example: md('Example story'),
        primaryLabel: text('Main button label'),
        primaryHref: link('Main button link'),
        secondaryLabel: text('Second button label'),
        secondaryHref: link('Second button link'),
      },
      defaultProps: LANDING_CONNECTED_SUPPLY_DEFAULTS,
      render: renderAs(LandingConnectedSupply),
    },

    TrustStrip: {
      label: 'Support & security',
      fields: {
        heading: text('Heading'),
        subtext: area('Sub-heading'),
        supportTitle: text('Support card title (hours, email and WhatsApp come from settings)'),
        demoTip: text('Support card tip'),
        securityTitle: text('Security card title'),
        securityPoints: list('Security points', { icon: icon(), text: md('Point') }, (p) => String(p.text ?? '').slice(0, 40), { icon: 'shield', text: 'Point' }, 6),
        privacyNote: md('Privacy note'),
      },
      defaultProps: LANDING_TRUST_STRIP_DEFAULTS,
      render: renderAs(LandingTrustStrip),
    },

    Pricing: {
      label: 'Pricing (live plans)',
      fields: {
        billingTitle: text('Heading (Billing plans)'),
        billingSubtitle: area('Sub-heading (Billing plans)'),
        showProductToggle: yesNo('Show Billing / HR / Connect switch'),
      },
      defaultProps: LANDING_PRICING_DEFAULTS,
      render: renderAs(LandingPricing),
    },

    Faq: {
      label: 'FAQ',
      fields: {
        heading: text('Heading'),
        intro: md('Intro'),
        items: list('Questions', { q: text('Question'), a: md('Answer') }, (f) => String(f.q ?? ''), { q: 'Question?', a: 'Answer.' }, 20),
      },
      defaultProps: LANDING_FAQ_DEFAULTS,
      render: renderAs(LandingFaq),
    },

    FinalCta: {
      label: 'Final call-to-action (dark)',
      fields: {
        heading: text('Heading ({product} = Billing / HR / Connect)'),
        highlight: text('Softer ending word'),
        subtext: area('Sub-heading'),
        note: text('Small note'),
        ctaLabel: text('Button label (links to sign-up)'),
      },
      defaultProps: LANDING_FINAL_CTA_DEFAULTS,
      render: renderAs(LandingFinalCta),
    },
  },
};
