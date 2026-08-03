import { NextRequest, NextResponse } from 'next/server';

import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

import { authorize, AuthorizationError } from '@/lib/authorization';

import {

  getOfferLetterTemplateSettings,

  parseOfferLetterTemplateSettings,

  DEFAULT_OFFER_LETTER_TEMPLATE_SETTINGS,

} from '@/lib/hr/offer-letter-template-settings';

import {

  OFFER_LETTER_TEMPLATE_REGISTRY,

  isValidOfferLetterTemplateId,

  getOfferLetterTemplateMeta,

} from '@/lib/offer-letter-template-registry';

import { query } from '@/lib/db';



export const dynamic = 'force-dynamic';



export async function GET(request: NextRequest) {

  try {

    const businessId = getBusinessIdFromRequest(request);

    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {

      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    }

    await authorize(userId, 'settings', 'read', { businessId });



    const data = await getOfferLetterTemplateSettings(businessId);

    return NextResponse.json({

      template_id: data.template_id,

      settings: data.settings,

      defaults: DEFAULT_OFFER_LETTER_TEMPLATE_SETTINGS,

      templates: OFFER_LETTER_TEMPLATE_REGISTRY,

    });

  } catch (error) {

    if (error instanceof AuthorizationError) return error.toNextResponse();

    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });

  }

}



export async function PATCH(request: NextRequest) {

  try {

    const businessId = getBusinessIdFromRequest(request);

    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {

      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    }

    await authorize(userId, 'settings', 'update', { businessId });



    const body = await request.json();

    const current = await getOfferLetterTemplateSettings(businessId);



    const nextTemplateId =

      body.template_id && isValidOfferLetterTemplateId(body.template_id)

        ? body.template_id

        : current.template_id;



    const settingsPayload = body.settings ?? (body.template_id && !body.settings ? {} : body);

    const merged = parseOfferLetterTemplateSettings({

      ...current.settings,

      ...settingsPayload,

    });



    await query(

      `INSERT INTO business_template_assignments (business_id, document_type, template_id, settings)

       VALUES ($1, 'offer_letter', $2, $3::jsonb)

       ON CONFLICT (business_id, document_type) DO UPDATE SET

         template_id = EXCLUDED.template_id,

         settings = EXCLUDED.settings,

         updated_at = CURRENT_TIMESTAMP`,

      [businessId, nextTemplateId, JSON.stringify(merged)],

    );



    return NextResponse.json({

      template_id: nextTemplateId,

      settings: merged,

      template: getOfferLetterTemplateMeta(nextTemplateId),

    });

  } catch (error) {

    if (error instanceof AuthorizationError) return error.toNextResponse();

    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });

  }

}


