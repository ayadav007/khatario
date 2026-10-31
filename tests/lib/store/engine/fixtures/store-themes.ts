// Raw `business_settings.store_theme` values, as stored, one or more per pack (M4 migration tests).
import type { MigrationContext } from '@/lib/store/engine/migrate';

export const CAT_FRUITS = '11111111-1111-4111-8111-111111111111';
export const CAT_VEG = '22222222-2222-4222-8222-222222222222';
export const CAT_DAIRY = '33333333-3333-4333-8333-333333333333';

export const ctx: MigrationContext = {
  businessName: 'Rose Mart',
  tagline: 'Fresh finds, delivered to your door every single day',
  aboutMd: 'We are a family store.',
  heroUrl: 'https://cdn.example.com/hero.jpg',
  logoUrl: 'https://cdn.example.com/logo.png',
  categories: [
    { id: CAT_FRUITS, name: 'Fruits' },
    { id: CAT_VEG, name: 'Vegetables' },
    { id: CAT_DAIRY, name: 'Dairy' },
  ],
};

/** Studio store that never opened Studio: the layout is derived from the theme. */
export const studioDerived = {
  preset: 'studio',
  accent: '#b94717',
  logo_url: 'https://cdn.example.com/logo.png',
  hero_cta: 'Shop now',
  hero_subtitle: 'Our best picks',
  hero_slides: [
    { image_url: 'https://cdn.example.com/s1.jpg', title: 'Big sale', subtitle: 'Everything fresh', viewport: 'both' },
    { image_url: 'https://cdn.example.com/s2.jpg', title: 'Phone deal', subtitle: 'Only on the app', viewport: 'mobile' },
  ],
  homepage_sections: [
    { id: 'hero', enabled: true },
    { id: 'categories', enabled: true },
    { id: 'overlay', enabled: true },
    { id: 'testimonials', enabled: true },
    { id: 'catalog', enabled: true },
  ],
  overlay_bands: [{ image_url: 'https://cdn.example.com/band.jpg', caption: 'Weekend offers', cta: 'See offers' }],
  testimonials: [
    { name: 'Asha', text: 'Lovely mangoes.', photo_url: '' },
    { name: 'Ravi', text: 'Fast delivery & fair prices.', photo_url: 'https://cdn.example.com/ravi.jpg' },
  ],
  category_style: 'photo',
  category_images: { [CAT_FRUITS]: 'https://cdn.example.com/fruits.jpg', 'not-a-category': 'https://cdn.example.com/x.jpg' },
};

/** Studio store with a saved layout of 9 sections. */
export const studioSaved = {
  preset: 'studio',
  accent: '#b94717',
  instagram_url: 'https://instagram.com/rosemart',
  whatsapp_url: '+91 98765 43210',
  studio_sections: [
    {
      id: 'announcement',
      type: 'announcement',
      name: 'Announcement Bar',
      enabled: true,
      settings: { announceMode: 'custom', text: 'Free delivery today', link: '/catalog', textAlign: 'left' },
    },
    {
      id: 'header',
      type: 'header',
      name: 'Header',
      enabled: true,
      settings: {
        logo: 'Rose Mart',
        tagline: 'Fresh daily',
        showSearch: true,
        showNav: true,
        navLinks: 'All Products, Fruits, Vegetables, Offers, Contact',
        highlightLink: 'Offers',
        iconsPosition: 'right',
        showAccount: true,
        showCart: true,
        showCartCount: false,
      },
    },
    {
      id: 'hero',
      type: 'hero',
      name: 'Hero',
      enabled: true,
      settings: {
        layout: 'full',
        height: 'large',
        heading: 'Hello',
        description: 'Fresh stuff',
        buttonText: 'Shop',
        image: 'https://cdn.example.com/h.jpg',
        autoplay: 12,
        slides: [{ image: 'https://cdn.example.com/h2.jpg', heading: 'Two', description: '', buttonText: 'Go', link: '/catalog' }],
      },
    },
    { id: 'categories', type: 'categories', name: 'Categories', enabled: true, settings: { title: 'Aisles', columns: 10 } },
    {
      id: 'row-1',
      type: 'products',
      name: 'Fruit row',
      enabled: true,
      settings: {
        title: 'Fresh fruit',
        source: 'category',
        categoryId: CAT_FRUITS,
        display: 'carousel',
        limit: 10,
        cssClass: 'fruit-row',
        customCss: '.x{color:red}',
        spacingTop: 18,
      },
    },
    {
      id: 'banner-1',
      type: 'banner',
      name: 'Promo Banner',
      enabled: false,
      settings: { title: 'Festive sale', text: 'Up to 30% off', button: 'Shop the sale', image: 'https://cdn.example.com/b.jpg' },
    },
    { id: 'text-1', type: 'richtext', name: 'About', enabled: true, settings: { title: 'About us', text: 'Rice & <b>dal</b>\n\nSince 1990' } },
    { id: 'marquee-1', type: 'marquee', name: 'Scrolling Text', enabled: true, settings: { text: 'Free delivery, COD, Fresh daily', speed: 'fast' } },
    { id: 'footer', type: 'footer', name: 'Footer', enabled: true, settings: { brand: 'Rose Mart', tagline: 'Since 1990', links: 'Shop, About, Fruits, Offers' } },
  ],
};

/** Quick store that never opened Studio. */
export const quickDerived = { preset: 'quick' };

/** Quick store with a saved layout. */
export const quickSaved = {
  preset: 'quick',
  studio_sections: [
    {
      id: 'header',
      type: 'header',
      name: 'Header',
      enabled: true,
      settings: { logo: 'Rose Mart', showSearch: true, navLinks: 'Fruits, Offers', highlightLink: 'Offers', deliveryEta: 'in 10 minutes' },
    },
    { id: 'hero', type: 'hero', name: 'Hero', enabled: true, settings: { layout: 'full', height: 'small', heading: 'Quick', image: 'https://cdn.example.com/q.jpg', autoplay: 0 } },
    { id: 'categories', type: 'categories', name: 'Categories', enabled: true, settings: { columns: 8 } },
    { id: 'deals', type: 'products', name: 'Deals', enabled: true, settings: { title: 'Deals', source: 'discounted', display: 'carousel', limit: 12 } },
    { id: 'usp', type: 'usp', name: 'Trust', enabled: true, settings: { usps: [{ icon: 'clock', title: '10 min', text: 'Super fast' }] } },
    { id: 'all', type: 'products', name: 'All', enabled: true, settings: { title: 'Everything', source: 'all', columns: 6 } },
    { id: 'footer', type: 'footer', name: 'Footer', enabled: true, settings: { links: 'Contact, Terms' } },
  ],
};

export const customDark = {
  preset: 'custom',
  pack: 'studio',
  appearance_mode: 'dark',
  accent: '#7c3aed',
  font_family: 'playfair',
};

export const retiredNoir = { pack: 'noir', accent: '#123456' };

const HOSTILE_CSS = 'a{color:red}'.repeat(Math.ceil(8000 / 12)).slice(0, 8000);

export const hostile = {
  preset: 'studio',
  logo_url: 'data:image/png;base64,iVBORw0KGgo=',
  announcement: 'Hello',
  announcement_link: 'javascript:alert(1)',
  custom_css: HOSTILE_CSS,
  studio_sections: [
    { id: 'ANNOUNCE', type: 'announcement', name: 'A', enabled: true, settings: { text: 'Hi', link: 'javascript:alert(1)' } },
    { id: 'HEADER', type: 'header', name: 'H', enabled: true, settings: { navLinks: 'Fruits, https://evil.com/x, http://plain.example/y' } },
    { id: 'HERO', type: 'hero', name: 'Hero', enabled: true, settings: { image: 'http://insecure.example.com/h.jpg', heading: 'Hi' } },
    ...Array.from({ length: 27 }, (_, i) => ({
      id: `TEXT-${i + 1}`,
      type: 'richtext',
      name: `Text ${i + 1}`,
      enabled: true,
      settings: { title: `Block ${i + 1}`, text: '<script>alert(1)</script>' },
    })),
  ],
};

export const namedGrocery = { preset: 'grocery', accent: '#ff0000' };

export const ALL_FIXTURES: Record<string, unknown> = {
  studioDerived,
  studioSaved,
  quickDerived,
  quickSaved,
  customDark,
  retiredNoir,
  hostile,
  namedGrocery,
};
