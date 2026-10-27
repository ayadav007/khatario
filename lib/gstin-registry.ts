/**
 * GSTIN registry lookup through public lookup services, tried in order. Returns the raw
 * taxpayer record in the GST portal's shape (lgnm, tradeNam, sts, rgdt, dty, pradr.addr), or
 * null when every service is down or has no record. A record is not proof on its own; callers
 * decide what to trust (the Supplier Hub badge needs sts = Active).
 */

export type GstinRegistryRecord = {
  gstin?: string;
  lgnm?: string;
  tradeNam?: string;
  sts?: string;
  rgdt?: string;
  dty?: string;
  pradr?: { addr?: { bno?: string; bnm?: string; flno?: string; st?: string; loc?: string; dst?: string; pncd?: string; stcd?: string } };
  [key: string]: unknown;
};

const TIMEOUT_MS = 6000;

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function fetchGstinRegistry(gstin: string): Promise<{ record: GstinRegistryRecord; source: string } | null> {
  const first = await getJson(`https://sheet.gstincheck.co.in/check/${gstin}`);
  if (first?.flag && first.data) {
    const d = first.data;
    return {
      source: 'GSTINCHECK',
      record: {
        gstin: d.gstin,
        lgnm: d.lgnm || d.tradeNam,
        tradeNam: d.tradeNam,
        sts: d.sts,
        rgdt: d.rgdt,
        dty: d.dty,
        pradr: { addr: { ...(d.pradr?.addr || {}) } },
      },
    };
  }
  const second = await getJson(`https://commonapi.mastersindia.co/commonapis/searchgstin?gstin=${gstin}`);
  if (second?.data && !second.error) return { source: 'Masters India', record: second.data };
  const third = await getJson(`https://gst.nic.in/commonapi/search?action=TP&gstin=${gstin}`);
  if (third && !third.error) return { source: 'GST.IN', record: third };
  return null;
}
