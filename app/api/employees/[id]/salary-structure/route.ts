import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  createSalaryStructure,
  getActiveSalaryStructure,
  grossFromComponents,
  listSalaryStructureHistory,
  type SalaryStructureInput,
} from '@/lib/hr/salary-structure';
import {
  ensureStructureLinesFromLegacy,
  listSalaryComponents,
  type StructureLineInput,
} from '@/lib/hr/salary-components';

export const dynamic = 'force-dynamic';

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'employees', 'read', { businessId, resourceId: params.id });

    const asOf = new URL(request.url).searchParams.get('as_of') ?? undefined;
    const active = await getActiveSalaryStructure(params.id, businessId, asOf);
    const history = await listSalaryStructureHistory(params.id, businessId);
    const catalog = await listSalaryComponents(businessId, { activeOnly: true });

    let lines: Awaited<ReturnType<typeof ensureStructureLinesFromLegacy>> = [];
    if (active?.id) {
      lines = await ensureStructureLinesFromLegacy(
        String(active.id),
        active,
        businessId,
      );
    }

    return NextResponse.json({
      active,
      history,
      lines,
      components: catalog,
      gross_monthly: active
        ? grossFromComponents({
            basic_salary: num(active.basic_salary),
            hra: num(active.hra),
            transport_allowance: num(active.transport_allowance),
            medical_allowance: num(active.medical_allowance),
            special_allowance: num(active.special_allowance),
            other_allowances: num(active.other_allowances),
            pf_percentage: num(active.pf_percentage, 12),
            pf_fixed_amount:
              active.pf_fixed_amount != null ? num(active.pf_fixed_amount) : null,
            professional_tax: num(active.professional_tax),
            tds_percentage: num(active.tds_percentage),
            other_deductions: num(active.other_deductions),
          })
        : null,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[employees/salary-structure GET]', error);
    return NextResponse.json({ error: 'Failed to load salary structure' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'payroll', 'create', { businessId, resourceId: params.id });

    const body = await request.json();
    const effectiveFrom = String(body?.effective_from ?? '').slice(0, 10);
    if (!effectiveFrom) {
      return NextResponse.json({ error: 'effective_from is required' }, { status: 400 });
    }

    const rawLines = Array.isArray(body?.lines) ? body.lines : null;
    const lines: StructureLineInput[] | undefined = rawLines
      ? rawLines
          .filter((l: { component_id?: string }) => l?.component_id)
          .map((l: { component_id: string; value?: unknown }) => ({
            component_id: String(l.component_id),
            value: num(l.value),
          }))
      : undefined;

    const basicSalary = lines
      ? undefined
      : num(body?.basic_salary);

    if (!lines && !(basicSalary && basicSalary > 0)) {
      return NextResponse.json(
        { error: 'effective_from and basic_salary (or lines with Basic) are required' },
        { status: 400 },
      );
    }

    const input: SalaryStructureInput = {
      business_id: businessId,
      employee_id: params.id,
      basic_salary: basicSalary ?? 0,
      hra: num(body?.hra),
      transport_allowance: num(body?.transport_allowance),
      medical_allowance: num(body?.medical_allowance),
      special_allowance: num(body?.special_allowance),
      other_allowances: num(body?.other_allowances),
      pf_percentage: num(body?.pf_percentage, 12),
      pf_fixed_amount: body?.pf_fixed_amount != null ? num(body.pf_fixed_amount) : null,
      professional_tax: num(body?.professional_tax),
      tds_percentage: num(body?.tds_percentage),
      other_deductions: num(body?.other_deductions),
      effective_from: effectiveFrom,
      notes: body?.notes?.trim() || null,
      lines,
    };

    const created = await createSalaryStructure(input);
    const active = await getActiveSalaryStructure(params.id, businessId, effectiveFrom);
    const structureLines = active?.id
      ? await ensureStructureLinesFromLegacy(String(active.id), active, businessId)
      : [];

    return NextResponse.json(
      { id: created.id, active, lines: structureLines },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to save salary structure';
    console.error('[employees/salary-structure POST]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
