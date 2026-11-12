'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

/**
 * Slug -> tool component. Each tool loads on its own page only.
 * The two image tools use the browser (canvas, WebAssembly), so they skip server rendering.
 */
export const TOOL_COMPONENTS: Record<string, ComponentType> = {
  'gst-calculator': dynamic(() => import('@/components/tools/GstCalculatorTool').then((m) => m.GstCalculatorTool), {}),
  'gstin-validator': dynamic(() => import('@/components/tools/GstinValidatorTool').then((m) => m.GstinValidatorTool), {}),
  'pan-validator': dynamic(() => import('@/components/tools/PanValidatorTool').then((m) => m.PanValidatorTool), {}),
  'hsn-finder': dynamic(() => import('@/components/tools/HsnFinderTool').then((m) => m.HsnFinderTool), {}),
  'tds-calculator': dynamic(() => import('@/components/tools/TdsCalculatorTool').then((m) => m.TdsCalculatorTool), {}),
  'discount-calculator': dynamic(() => import('@/components/tools/DiscountCalculatorTool').then((m) => m.DiscountCalculatorTool), {}),
  'price-margin-calculator': dynamic(() => import('@/components/tools/PriceMarginCalculatorTool').then((m) => m.PriceMarginCalculatorTool), {}),
  'interest-calculator': dynamic(() => import('@/components/tools/InterestCalculatorTool').then((m) => m.InterestCalculatorTool), {}),
  'emi-calculator': dynamic(() => import('@/components/tools/EmiCalculatorTool').then((m) => m.EmiCalculatorTool), {}),
  'currency-converter': dynamic(() => import('@/components/tools/CurrencyConverterTool').then((m) => m.CurrencyConverterTool), {}),
  'invoice-number-generator': dynamic(() => import('@/components/tools/InvoiceNumberGeneratorTool').then((m) => m.InvoiceNumberGeneratorTool), {}),
  'image-size-reducer': dynamic(() => import('@/components/tools/ImageSizeReducerTool').then((m) => m.ImageSizeReducerTool), { ssr: false }),
  'image-background-remover': dynamic(() => import('@/components/tools/ImageBackgroundRemoverTool').then((m) => m.ImageBackgroundRemoverTool), { ssr: false }),
  'invoice-maker': dynamic(() => import('@/components/tools/InvoiceMakerTool').then((m) => m.InvoiceMakerTool), { ssr: false }),
};
