import {
  ANNOUNCEMENT_ROOT_KEYS as K,
  announcementFromRootProps,
  DEFAULT_ANNOUNCEMENT,
} from '@/lib/marketing-builder/announcement';

describe('announcementFromRootProps', () => {
  it('keeps the default bar for pages published before it was editable', () => {
    expect(announcementFromRootProps({ title: 'Home', brandColor: 'teal' })).toEqual(DEFAULT_ANNOUNCEMENT);
    expect(announcementFromRootProps(null)).toEqual(DEFAULT_ANNOUNCEMENT);
  });

  it('uses what the editor saved, trimmed', () => {
    const a = announcementFromRootProps({
      [K.show]: true,
      [K.badge]: ' Diwali ',
      [K.title]: '20% off yearly plans.',
      [K.text]: 'Till 5 Nov.',
      [K.linkLabel]: 'See pricing',
      [K.href]: '#pricing',
    });
    expect(a).toEqual({ show: true, badge: 'Diwali', title: '20% off yearly plans.', text: 'Till 5 Nov.', linkLabel: 'See pricing', href: '#pricing' });
  });

  it('can be switched off', () => {
    expect(announcementFromRootProps({ [K.show]: false }).show).toBe(false);
  });

  it('drops an unsafe link', () => {
    expect(announcementFromRootProps({ [K.href]: 'javascript:alert(1)' }).href).toBe('');
  });
});
