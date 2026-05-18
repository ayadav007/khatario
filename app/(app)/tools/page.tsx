'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { Card } from '@/components/ui/Card';
import Link from 'next/link';
import { 
  Search, 
  Target, 
  Calculator, 
  CreditCard, 
  UserCheck, 
  Tag, 
  TrendingUp, 
  BarChart, 
  Banknote, 
  Percent, 
  RefreshCw, 
  Hash, 
  FileImage, 
  Wand2,
  ClipboardList,
  ChevronRight,
  ArrowUpRight,
  Users
} from 'lucide-react';

const tools = [
  {
    title: 'HSN/SAC Finder',
    description: 'Find HSN and SAC codes for GST with tax rates.',
    icon: Search,
    href: '/tools/hsn-finder',
    color: 'bg-slate-50 text-primary-600',
    category: 'GST'
  },
  {
    title: 'GST Calculator',
    description: 'Calculate inclusive and exclusive GST amounts quickly.',
    icon: Calculator,
    href: '/tools/gst-calculator',
    color: 'bg-green-50 text-green-600',
    category: 'GST'
  },
  {
    title: 'GSTIN Validator',
    description: 'Verify and validate GSTIN numbers for any business.',
    icon: UserCheck,
    href: '/tools/gstin-validator',
    color: 'bg-indigo-50 text-indigo-600',
    category: 'GST'
  },
  {
    title: 'PAN Validator',
    description: 'Validate Permanent Account Number (PAN) format and type.',
    icon: CreditCard,
    href: '/tools/pan-validator',
    color: 'bg-purple-50 text-purple-600',
    category: 'Tax'
  },
  {
    title: 'TDS Calculator',
    description: 'Calculate TDS amounts for various payment sections.',
    icon: Banknote,
    href: '/tools/tds-calculator',
    color: 'bg-amber-50 text-amber-600',
    category: 'Tax'
  },
  {
    title: 'Discount Calculator',
    description: 'Calculate discounts and final prices for your items.',
    icon: Tag,
    href: '/tools/discount-calculator',
    color: 'bg-rose-50 text-rose-600',
    category: 'Sales'
  },
  {
    title: 'Price & Margin',
    description: 'Calculate selling price, markup, and profit margins.',
    icon: TrendingUp,
    href: '/tools/price-margin-calculator',
    color: 'bg-emerald-50 text-emerald-600',
    category: 'Sales'
  },
  {
    title: 'Invoice Generator',
    description: 'Generate professional sequential invoice numbers.',
    icon: Hash,
    href: '/tools/invoice-number-generator',
    color: 'bg-slate-50 text-slate-600',
    category: 'Sales'
  },
  {
    title: 'Interest Calculator',
    description: 'Calculate simple and compound interest for any period.',
    icon: Percent,
    href: '/tools/interest-calculator',
    color: 'bg-orange-50 text-orange-600',
    category: 'Finance'
  },
  {
    title: 'EMI Calculator',
    description: 'Calculate monthly loan installments and interest.',
    icon: BarChart,
    href: '/tools/emi-calculator',
    color: 'bg-cyan-50 text-cyan-600',
    category: 'Finance'
  },
  {
    title: 'Currency Converter',
    description: 'Convert amounts between INR and global currencies.',
    icon: RefreshCw,
    href: '/tools/currency-converter',
    color: 'bg-teal-50 text-teal-600',
    category: 'Finance'
  },
  {
    title: 'Image Reducer',
    description: 'Compress and reduce image file sizes without loss.',
    icon: FileImage,
    href: '/tools/image-size-reducer',
    color: 'bg-pink-50 text-pink-600',
    category: 'Image'
  },
  {
    title: 'BG Remover',
    description: 'Professional AI-powered background removal tool.',
    icon: Wand2,
    href: '/tools/image-background-remover',
    color: 'bg-violet-50 text-violet-600',
    category: 'Image'
  },
  {
    title: 'To Do List',
    description: 'Manage your tasks and set reminders for your business.',
    icon: ClipboardList,
    href: '/tools/todo',
    color: 'bg-yellow-50 text-yellow-600',
    category: 'Productivity'
  },
  {
    title: 'Lead Extractor',
    description: 'Find business leads directly from Google Maps.',
    icon: Target,
    href: '/tools/google-lead-extractor',
    color: 'bg-sky-50 text-sky-600',
    category: 'Marketing'
  },
  {
    title: 'WhatsApp Group Extractor',
    description: 'Extract phone numbers from WhatsApp groups, communities, and announcements.',
    icon: Users,
    href: '/tools/whatsapp-group-extractor',
    color: 'bg-emerald-50 text-emerald-600',
    category: 'WhatsApp'
  }
];

export default function ToolsDashboardPage() {
  return (
    
      <div className="space-y-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">
            Business Tools
          </h1>
          <p className="text-text-secondary text-lg">
            A comprehensive suite of tools to help you run your business more efficiently.
          </p>
        </div>

        {/* Tools Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {tools.map((tool) => (
            <Link key={tool.href} href={tool.href} className="group h-full">
              <Card 
                padding="lg" 
                className="h-full border-border hover:border-primary-500/50 hover:shadow-xl hover:shadow-primary-500/5 transition-all duration-300 relative overflow-hidden group-hover:-translate-y-1"
              >
                <div className="flex flex-col h-full relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`p-3 rounded-xl ${tool.color} shadow-sm group-hover:scale-110 transition-transform duration-300`}>
                      <tool.icon className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary bg-gray-100 px-2 py-1 rounded">
                      {tool.category}
                    </span>
                  </div>
                  
                  <h3 className="text-lg font-bold text-text-primary mb-2 group-hover:text-primary-600 transition-colors">
                    {tool.title}
                  </h3>
                  
                  <p className="text-sm text-text-secondary mb-6 flex-grow leading-relaxed">
                    {tool.description}
                  </p>
                  
                  <div className="flex items-center text-xs font-bold text-primary-600 uppercase tracking-tight group-hover:translate-x-1 transition-transform">
                    Open Tool <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
                  </div>
                </div>

                {/* Decorative background element */}
                <div className={`absolute -right-4 -bottom-4 w-24 h-24 ${tool.color} opacity-0 group-hover:opacity-10 rounded-full blur-2xl transition-opacity duration-500`} />
              </Card>
            </Link>
          ))}
        </div>

        {/* Info Box */}
        <Card padding="md" className="bg-slate-50 border-primary-100 mt-12">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-white rounded-full shadow-sm">
              <Sparkles className="w-5 h-5 text-primary-500" />
            </div>
            <div>
              <h4 className="font-bold text-primary-900 text-sm">More tools coming soon!</h4>
              <p className="text-xs text-primary-700">We are constantly adding new tools to help your business grow. Check back often.</p>
            </div>
          </div>
        </Card>
      </div>
    
  );
}

function Sparkles(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

