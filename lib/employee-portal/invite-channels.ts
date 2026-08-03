export type PortalInviteChannel = 'email' | 'whatsapp' | 'both';

export type ResolvedPortalInviteChannels = {
  /** Channels to attempt; null = generate password only (manual share). */
  channels: PortalInviteChannel | null;
  notes: string[];
};

/** Pick deliverable channels from the admin's choice and what contact info exists. */
export function resolvePortalInviteChannels(
  requested: PortalInviteChannel,
  contact: { email?: string | null; phone?: string | null },
): ResolvedPortalInviteChannels {
  const hasEmail = Boolean(contact.email?.trim());
  const hasPhone = Boolean(contact.phone?.trim());
  const notes: string[] = [];

  if (requested === 'email') {
    if (!hasEmail) {
      return {
        channels: null,
        notes: ['No email on file — portal password created for manual sharing.'],
      };
    }
    return { channels: 'email', notes };
  }

  if (requested === 'whatsapp') {
    if (!hasPhone) {
      return {
        channels: null,
        notes: ['No phone on file — portal password created for manual sharing.'],
      };
    }
    return { channels: 'whatsapp', notes };
  }

  if (hasEmail && hasPhone) {
    return { channels: 'both', notes };
  }
  if (hasPhone) {
    notes.push('No email on file — invite will be sent on WhatsApp only.');
    return { channels: 'whatsapp', notes };
  }
  if (hasEmail) {
    notes.push('No phone on file — invite will be sent by email only.');
    return { channels: 'email', notes };
  }

  return {
    channels: null,
    notes: ['No email or phone for delivery — share portal credentials manually.'],
  };
}
