"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SlideOverPanel } from "@/components/ui/SlideOverPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { useToastContext } from "@/contexts/ToastContext";
import { GST_STATE_NAMES } from "@/lib/tax/gstin";
import {
  isValidEwayDistance,
  validateEwayForm,
  type EwayForm,
  type EwayFormErrors,
} from "@/lib/gst/eway-generate-form";
import type { EwayBillView } from "@/lib/gst/eway-bill-records";

const NOT_STATES = new Set(["25", "28", "97", "99"]);
const SELECT_CLASS =
  "mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm";
export const CONNECT_URL = "/settings/integrations/gst-masters-india";

/** State select whose value is the two-digit GST state code. */
export function EwayStateSelect({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
  error?: string;
}) {
  const options = useMemo(
    () =>
      Object.entries(GST_STATE_NAMES)
        .filter(([code]) => !NOT_STATES.has(code))
        .sort(([a], [b]) => a.localeCompare(b)),
    [],
  );
  return (
    <label className="block text-sm text-gray-700">
      {label}
      <select
        className={SELECT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select state</option>
        {options.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : null}
    </label>
  );
}

const MODES: Array<{ value: EwayForm["mode"]; label: string }> = [
  { value: "road", label: "Road" },
  { value: "rail", label: "Rail" },
  { value: "air", label: "Air" },
  { value: "ship", label: "Ship" },
];

/**
 * The transport part of the e-way bill form: distance, mode, vehicle, transport document, transporter and
 * over-dimensional cargo. Shared by this dialog and the e-invoice panel ("Also create the e-way bill").
 */
export function EwayTransportFields({
  form,
  errors,
  onChange,
}: {
  form: EwayForm;
  errors: EwayFormErrors;
  onChange: <K extends keyof EwayForm>(key: K, value: EwayForm[K]) => void;
}) {
  const set = onChange;
  return (
    <>
      <Input
        label="Distance (km)"
        type="number"
        inputMode="numeric"
        min={0}
        max={4000}
        value={form.distance}
        error={errors.distance}
        helperText="Enter 0 to use the portal's distance."
        onChange={(e) => set("distance", e.target.value)}
      />

      <label className="block text-sm text-gray-700">
        Mode of transport
        <select
          className={SELECT_CLASS}
          value={form.mode}
          onChange={(e) => set("mode", e.target.value as EwayForm["mode"])}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <Input
        label="Vehicle number"
        value={form.vehicle}
        error={errors.vehicle}
        placeholder="KA01AB1234"
        onChange={(e) => set("vehicle", e.target.value)}
      />

      {form.mode !== "road" ? (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Transport document number"
            value={form.docNumber}
            error={errors.docNumber}
            onChange={(e) => set("docNumber", e.target.value)}
          />
          <Input
            label="Transport document date"
            type="date"
            value={form.docDate}
            error={errors.docDate}
            onChange={(e) => set("docDate", e.target.value)}
          />
        </div>
      ) : null}

      <Input
        label="Transporter GSTIN (optional)"
        value={form.transporterGstin}
        error={errors.transporterGstin}
        maxLength={15}
        onChange={(e) =>
          set("transporterGstin", e.target.value.toUpperCase())
        }
      />
      <Input
        label="Transporter name (optional)"
        value={form.transporterName}
        onChange={(e) => set("transporterName", e.target.value)}
      />

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={form.isOdc}
          onChange={(e) => set("isOdc", e.target.checked)}
        />
        Over-dimensional cargo (20 km a day)
      </label>
    </>
  );
}

/**
 * The ship-to part of the form: GSTIN (optional), city, PIN code and state. Shared by this dialog and the
 * e-invoice panel, which shows it when the goods go to an address not saved on the customer.
 */
export function EwayShipToFields({
  form,
  errors,
  onChange,
}: {
  form: EwayForm;
  errors: EwayFormErrors;
  onChange: <K extends keyof EwayForm>(key: K, value: EwayForm[K]) => void;
}) {
  const set = onChange;
  return (
    <>
      <p className="text-sm font-medium text-gray-900">Ship-to address</p>
      <Input
        label="Ship-to GSTIN (optional)"
        value={form.shipToGstin}
        error={errors.shipToGstin}
        maxLength={15}
        onChange={(e) => set("shipToGstin", e.target.value.toUpperCase())}
      />
      <Input
        label="Ship-to city"
        value={form.shipToPlace}
        error={errors.shipToPlace}
        onChange={(e) => set("shipToPlace", e.target.value)}
      />
      <Input
        label="Ship-to PIN code"
        inputMode="numeric"
        maxLength={6}
        value={form.shipToPincode}
        error={errors.shipToPincode}
        onChange={(e) =>
          set("shipToPincode", e.target.value.replace(/\D/g, "").slice(0, 6))
        }
      />
      <EwayStateSelect
        label="Ship-to state"
        value={form.shipToStateCode}
        error={errors.shipToStateCode}
        onChange={(code) => set("shipToStateCode", code)}
      />
    </>
  );
}

type Props = {
  sourceType: "invoice" | "delivery_challan";
  sourceId: string;
  goodsValue: number;
  defaultVehicle?: string | null;
  defaultTransporterGstin?: string | null;
  defaultTransporterName?: string | null;
  onDone(bill: EwayBillView): void;
  /** Called when the request got no readable answer, so the caller can reload the document's bills. */
  onNoAnswer?(): void;
  onClose(): void;
};

const NO_ANSWER =
  "No answer yet. Check the e-way bills page in a minute before trying again.";

/** Generates an e-way bill through the connected provider and records it in the register. */
export function GenerateEwayBillDialog({
  sourceType,
  sourceId,
  goodsValue,
  defaultVehicle,
  defaultTransporterGstin,
  defaultTransporterName,
  onDone,
  onNoAnswer,
  onClose,
}: Props) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [form, setForm] = useState<EwayForm>({
    distance: "",
    mode: "road",
    vehicle: defaultVehicle || "",
    transporterGstin: defaultTransporterGstin || "",
    transporterName: defaultTransporterName || "",
    docNumber: "",
    docDate: "",
    isOdc: false,
    shipToGstin: "",
    shipToPlace: "",
    shipToPincode: "",
    shipToStateCode: "",
  });
  const [errors, setErrors] = useState<EwayFormErrors>({});
  const [serverError, setServerError] = useState("");
  const [serverCode, setServerCode] = useState("");
  const [showShipTo, setShowShipTo] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof EwayForm>(key: K, value: EwayForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    fetch(
      `/api/integrations/gst-masters-india?business_id=${encodeURIComponent(business.id)}`,
      { credentials: "include" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setConnected(!!d.connection?.connected);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  async function submit() {
    setServerError("");
    setServerCode("");
    const result = validateEwayForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      if (
        result.errors.shipToPlace ||
        result.errors.shipToPincode ||
        result.errors.shipToStateCode ||
        result.errors.shipToGstin
      ) {
        setShowShipTo(true);
      }
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await fetch("/api/eway-bills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          source_type: sourceType,
          source_id: sourceId,
          ...result.body,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.error) {
        // A gateway timeout or similar: the bill may still have been generated.
        setServerError(NO_ANSWER);
        onNoAnswer?.();
        return;
      }
      if (!res.ok) {
        setServerError(data.error);
        setServerCode(data.code || "");
        if (data.code === "SHIP_TO_NEEDED") setShowShipTo(true);
        return;
      }
      const bill = data.eway_bill as EwayBillView;
      toast.success(`E-way bill ${bill.ewb_number} generated`);
      onDone(bill);
      onClose();
    } catch {
      // The request may have reached the server before the connection dropped.
      setServerError(NO_ANSWER);
      onNoAnswer?.();
    } finally {
      setSaving(false);
    }
  }

  const needsConnect =
    serverCode === "GSP_NOT_CONNECTED" || serverCode === "GSP_AUTH";
  const exportQuery = () => {
    const q = new URLSearchParams({
      source_type: sourceType,
      source_id: sourceId,
      distance_km: form.distance.trim(),
    });
    if (
      form.shipToPlace.trim() &&
      form.shipToPincode.trim() &&
      form.shipToStateCode
    ) {
      q.set("ship_to_place", form.shipToPlace.trim());
      q.set("ship_to_pincode", form.shipToPincode.trim());
      q.set("ship_to_state_code", form.shipToStateCode);
    }
    return q.toString();
  };

  return (
    <SlideOverPanel
      open
      onClose={onClose}
      title="Generate e-way bill"
      widthClass="max-w-md"
    >
      <div className="space-y-3 p-4">
        {goodsValue > 0 ? (
          <p className="text-sm text-gray-600">
            Goods value: ₹
            {goodsValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </p>
        ) : null}

        {connected === false && !serverError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Connect Masters India first. The e-way bill is generated on the
              GST portal through it.
            </p>
            <Link
              href={CONNECT_URL}
              className="mt-2 inline-block font-medium text-primary-700 underline"
            >
              Connect Masters India
            </Link>
          </div>
        ) : null}

        {serverError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <p>{serverError}</p>
            {needsConnect ? (
              <Link href={CONNECT_URL} className="mt-2 inline-block">
                <span className="inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white">
                  Connect Masters India
                </span>
              </Link>
            ) : null}
          </div>
        ) : null}

        <EwayTransportFields form={form} errors={errors} onChange={set} />

        {showShipTo ? (
          <div className="space-y-3 rounded-lg border border-gray-200 p-3">
            <EwayShipToFields form={form} errors={errors} onChange={set} />
          </div>
        ) : (
          <button
            type="button"
            className="text-sm text-primary-700 underline"
            onClick={() => setShowShipTo(true)}
          >
            Goods go to a different address? Add the ship-to details
          </button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          {isValidEwayDistance(form.distance) ? (
            <a
              className="text-xs text-gray-500 underline"
              href={`/api/eway-bills/export?${exportQuery()}`}
              title="Download the details as a file to upload on the e-way bill portal yourself"
            >
              Download portal file instead
            </a>
          ) : (
            <span className="text-xs text-gray-400">Enter the distance to download the portal file instead</span>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button onClick={submit} isLoading={saving} disabled={saving}>
              Generate
            </Button>
          </div>
        </div>
      </div>
    </SlideOverPanel>
  );
}
