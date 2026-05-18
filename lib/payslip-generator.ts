import * as db from '@/lib/db';
import { SalaryPayment, Employee, Business } from '@/types/database';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';

// Number to words converter (simplified version)
function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num === 0) return 'Zero';

  function convertHundreds(n: number): string {
    let result = '';
    if (n >= 100) {
      result += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      result += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    } else if (n >= 10) {
      result += teens[n - 10] + ' ';
      return result;
    }
    if (n > 0) {
      result += ones[n] + ' ';
    }
    return result;
  }

  let words = '';
  const crores = Math.floor(num / 10000000);
  const lakhs = Math.floor((num % 10000000) / 100000);
  const thousands = Math.floor((num % 100000) / 1000);
  const hundreds = num % 1000;

  if (crores > 0) {
    words += convertHundreds(crores).trim() + ' Crore ';
  }
  if (lakhs > 0) {
    words += convertHundreds(lakhs).trim() + ' Lakh ';
  }
  if (thousands > 0) {
    words += convertHundreds(thousands).trim() + ' Thousand ';
  }
  if (hundreds > 0) {
    words += convertHundreds(hundreds).trim();
  }

  return words.trim() || 'Zero';
}

// Register Handlebars helpers
let helpersRegistered = false;

function registerHelpers() {
  if (helpersRegistered) return;
  
  Handlebars.registerHelper('formatCurrency', (value: any) => {
    if (value == null || value === '') return '0.00';
    const num = Number(value);
    if (isNaN(num)) return value;
    return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });

  Handlebars.registerHelper('if', function(this: any, condition: any, options: any) {
    if (condition) {
      return options.fn(this);
    } else {
      return options.inverse(this);
    }
  });

  helpersRegistered = true;
}

export interface PayslipData {
  employee: {
    name: string;
    employee_code: string;
    designation?: string;
    department?: string;
    pan_number?: string;
    aadhaar_number?: string;
    bank_account?: string;
    bank_ifsc?: string;
    bank_name?: string;
  };
  business: {
    name: string;
    address: string;
    gstin?: string;
    logo_url?: string;
  };
  salary_period: {
    month: string;
    from_date: string;
    to_date: string;
    payment_date: string;
  };
  earnings: {
    basic_salary: number;
    hra?: number;
    transport_allowance?: number;
    medical_allowance?: number;
    special_allowance?: number;
    overtime?: number;
    bonus?: number;
    commission?: number;
    total_earnings: number;
  };
  deductions: {
    provident_fund?: number;
    professional_tax?: number;
    tds?: number;
    advance_recovery?: number;
    loan_deduction?: number;
    other_deductions?: number;
    total_deductions: number;
  };
  summary: {
    gross_salary: number;
    total_deductions: number;
    net_salary: number;
    amount_in_words: string;
  };
  attendance?: {
    working_days: number;
    present_days: number;
    absent_days: number;
    leave_days: number;
    overtime_hours?: number;
  };
}

export async function generatePayslipHtml(salaryPaymentId: string): Promise<string> {
  registerHelpers();

  // Fetch salary payment with employee and business data
  const salaryPayment = await db.queryOne<SalaryPayment & {
    employee_name: string;
    employee_code: string;
    designation: string;
    department: string;
    pan_number: string;
    aadhaar_number: string;
    bank_account_number: string;
    bank_ifsc: string;
    bank_name: string;
    business_name: string;
    business_address: string;
    business_gstin: string;
    business_logo_url: string;
  }>(`
    SELECT 
      sp.*,
      u.name as employee_name,
      e.employee_code,
      e.designation,
      e.department,
      e.pan_number,
      e.aadhaar_number,
      e.bank_account_number,
      e.bank_ifsc,
      e.bank_name,
      b.name as business_name,
      CONCAT(
        COALESCE(b.address_line1, ''), 
        CASE WHEN b.address_line2 IS NOT NULL THEN ', ' || b.address_line2 ELSE '' END,
        CASE WHEN b.city IS NOT NULL THEN ', ' || b.city ELSE '' END,
        CASE WHEN b.state IS NOT NULL THEN ', ' || b.state ELSE '' END,
        CASE WHEN b.pincode IS NOT NULL THEN ' - ' || b.pincode ELSE '' END
      ) as business_address,
      b.gstin as business_gstin,
      b.logo_url as business_logo_url
    FROM salary_payments sp
    JOIN employees e ON sp.employee_id = e.id
    JOIN users u ON e.id = u.id
    JOIN businesses b ON sp.business_id = b.id
    WHERE sp.id = $1
  `, [salaryPaymentId]);

  if (!salaryPayment) {
    throw new Error('Salary payment not found');
  }

  // Format dates
  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const formatMonth = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };

  // Prepare payslip data
  const payslipData: PayslipData = {
    employee: {
      name: salaryPayment.employee_name,
      employee_code: salaryPayment.employee_code,
      designation: salaryPayment.designation || undefined,
      department: salaryPayment.department || undefined,
      pan_number: salaryPayment.pan_number || undefined,
      aadhaar_number: salaryPayment.aadhaar_number || undefined,
      bank_account: salaryPayment.bank_account_number || undefined,
      bank_ifsc: salaryPayment.bank_ifsc || undefined,
      bank_name: salaryPayment.bank_name || undefined,
    },
    business: {
      name: salaryPayment.business_name,
      address: salaryPayment.business_address || '',
      gstin: salaryPayment.business_gstin || undefined,
      logo_url: salaryPayment.business_logo_url || undefined,
    },
    salary_period: {
      month: formatMonth(salaryPayment.from_date),
      from_date: formatDate(salaryPayment.from_date),
      to_date: formatDate(salaryPayment.to_date),
      payment_date: formatDate(salaryPayment.payment_date),
    },
    earnings: {
      basic_salary: Number(salaryPayment.basic_salary),
      hra: Number(salaryPayment.hra) || undefined,
      transport_allowance: Number(salaryPayment.transport_allowance) || undefined,
      medical_allowance: Number(salaryPayment.medical_allowance) || undefined,
      special_allowance: Number(salaryPayment.special_allowance) || undefined,
      overtime: Number(salaryPayment.overtime) || undefined,
      bonus: Number(salaryPayment.bonus) || undefined,
      commission: Number(salaryPayment.commission) || undefined,
      total_earnings: Number(salaryPayment.total_earnings),
    },
    deductions: {
      provident_fund: Number(salaryPayment.provident_fund) || undefined,
      professional_tax: Number(salaryPayment.professional_tax) || undefined,
      tds: Number(salaryPayment.tds) || undefined,
      advance_recovery: Number(salaryPayment.advance_recovery) || undefined,
      loan_deduction: Number(salaryPayment.loan_deduction) || undefined,
      other_deductions: Number(salaryPayment.other_deductions) || undefined,
      total_deductions: Number(salaryPayment.total_deductions),
    },
    summary: {
      gross_salary: Number(salaryPayment.gross_salary),
      total_deductions: Number(salaryPayment.total_deductions),
      net_salary: Number(salaryPayment.net_salary),
      amount_in_words: numberToWords(Math.round(salaryPayment.net_salary)) + ' Rupees Only',
    },
  };

  // Add attendance if available
  if (salaryPayment.working_days !== null) {
    payslipData.attendance = {
      working_days: salaryPayment.working_days || 0,
      present_days: salaryPayment.present_days || 0,
      absent_days: salaryPayment.absent_days || 0,
      leave_days: salaryPayment.leave_days || 0,
      overtime_hours: salaryPayment.overtime_hours || undefined,
    };
  }

  // Load template
  const templatePath = path.join(process.cwd(), 'templates', 'payslips', 'standard', 'template.html');
  
  if (!fs.existsSync(templatePath)) {
    throw new Error('Payslip template not found');
  }

  const templateSource = fs.readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(templateSource);
  const html = template(payslipData);

  return html;
}

export async function generatePayslipPdf(salaryPaymentId: string): Promise<Buffer> {
  const html = await generatePayslipHtml(salaryPaymentId);
  
  try {
    const browser = await puppeteer.launch(
      getPuppeteerLaunchOptions({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    );

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });

    await browser.close();

    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error('Error generating PDF with Puppeteer:', error);
    throw new Error('Failed to generate PDF. Please ensure Puppeteer is installed.');
  }
}

