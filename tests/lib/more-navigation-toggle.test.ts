import { toggleMoreSection } from '@/lib/more-navigation';

describe('toggleMoreSection', () => {
  const isOpen = (state: Record<string, boolean>, title: string) => state[title] !== false;

  it('closes a section on the first tap', () => {
    expect(isOpen(toggleMoreSection({}, 'Sales'), 'Sales')).toBe(false);
  });

  it('reopens on the second tap and leaves other sections alone', () => {
    const closed = toggleMoreSection({ Reports: false }, 'Sales');
    const reopened = toggleMoreSection(closed, 'Sales');
    expect(isOpen(reopened, 'Sales')).toBe(true);
    expect(isOpen(reopened, 'Reports')).toBe(false);
  });
});
