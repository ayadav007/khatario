import React from 'react';
import { clsx } from 'clsx';
import { typographyVariants, type TypographyVariant } from '@/lib/typography';

type TextTone = 'primary' | 'secondary' | 'muted' | 'inherit';

const toneClasses: Record<TextTone, string> = {
  primary: 'text-text-primary',
  secondary: 'text-text-secondary',
  muted: 'text-text-muted',
  inherit: '',
};

export type TextProps = {
  as?: 'p' | 'span' | 'div' | 'label' | 'li' | 'td' | 'th';
  variant?: TypographyVariant;
  tone?: TextTone;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'className'>;

const weightClasses = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
} as const;

export function Text({
  as: Tag = 'p',
  variant = 'body',
  tone = 'primary',
  weight,
  className,
  children,
  ...props
}: TextProps) {
  return (
    <Tag
      className={clsx(
        typographyVariants[variant],
        toneClasses[tone],
        weight && weightClasses[weight],
        className,
      )}
      {...props}
    />
  );
}

export type HeadingProps = {
  as?: 'h1' | 'h2' | 'h3' | 'h4';
  variant?: 'pageTitle' | 'sectionTitle' | 'panelTitle' | 'labelSection';
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLHeadingElement>, 'className'>;

const headingVariantMap = {
  pageTitle: typographyVariants.pageTitle,
  sectionTitle: typographyVariants.sectionTitle,
  panelTitle: typographyVariants.panelTitle,
  labelSection: typographyVariants.labelSection,
} as const;

export function Heading({
  as: Tag = 'h2',
  variant = 'sectionTitle',
  className,
  children,
  ...props
}: HeadingProps) {
  return (
    <Tag className={clsx(headingVariantMap[variant], 'text-text-primary', className)} {...props}>
      {children}
    </Tag>
  );
}
