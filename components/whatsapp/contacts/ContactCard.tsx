'use client';

import { Card } from '@/components/ui/Card';
import { Phone, Mail, Tag, Trash2, Check } from 'lucide-react';

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  tags: string[];
  source: string;
  groups?: Array<{
    id: string;
    name: string;
    color: string;
  }>;
}

interface ContactCardProps {
  contact: Contact;
  selected?: boolean;
  onSelect?: () => void;
  onClick?: () => void;
  onDelete?: () => void;
}

export function ContactCard({ contact, selected, onSelect, onClick, onDelete }: ContactCardProps) {
  return (
    <Card
      className={`p-4 transition-all cursor-pointer hover:shadow-md ${
        selected ? 'ring-2 ring-primary-500 bg-slate-50' : ''
      }`}
      onClick={onClick}
    >
      <div className="space-y-3">
        {/* Header with checkbox and delete */}
        <div className="flex items-start justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.();
            }}
          >
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
              selected ? 'bg-primary-600 border-primary-600' : 'border-gray-300'
            }`}>
              {selected && <Check className="h-3 w-3 text-white" />}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.();
            }}
            className="text-gray-400 hover:text-red-600 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Contact Info */}
        <div>
          {contact.name && (
            <h3 className="font-semibold text-text-primary mb-1">
              {contact.name}
            </h3>
          )}

          <div className="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <Phone className="h-3 w-3" />
            <span className="font-mono">{contact.phone}</span>
          </div>

          {contact.email && (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Mail className="h-3 w-3" />
              <span>{contact.email}</span>
            </div>
          )}
        </div>

        {/* Tags */}
        {contact.tags && contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {contact.tags.slice(0, 3).map((tag, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded"
              >
                <Tag className="h-3 w-3" />
                {tag}
              </span>
            ))}
            {contact.tags.length > 3 && (
              <span className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                +{contact.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Groups */}
        {contact.groups && contact.groups.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {contact.groups.slice(0, 2).map((group) => (
              <span
                key={group.id}
                className="inline-flex items-center px-2 py-1 text-xs rounded"
                style={{
                  backgroundColor: group.color + '20',
                  color: group.color,
                }}
              >
                {group.name}
              </span>
            ))}
            {contact.groups.length > 2 && (
              <span className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                +{contact.groups.length - 2} groups
              </span>
            )}
          </div>
        )}

        {/* Source Badge */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500 capitalize">
            {contact.source.replace('_', ' ')}
          </span>
        </div>
      </div>
    </Card>
  );
}
