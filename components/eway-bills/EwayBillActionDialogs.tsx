"use client";

import { useState } from "react";
import Link from "next/link";
import { SlideOverPanel } from "@/components/ui/SlideOverPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToastContext } from "@/contexts/ToastContext";
import {
  CONNECT_URL,
  EwayStateSelect,
} from "@/components/eway-bills/GenerateEwayBillDialog";
import type { EwayBillAction, EwayBillView } from "@/lib/gst/eway-bill-records";

export type EwayActionKind = "cancel" | "vehicle" | "extend" | "close";

const SELECT_CLASS =
  "mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm";
const TITLE: Record<EwayActionKind, string> = {
  cancel: "Cancel e-way bill",
  vehicle: "Change vehicle",
  extend: "Extend validity",
  close: "Close e-way bill",
};
const DONE: Record<EwayActionKind, string> = {
  cancel: "E-way bill cancelled",
  vehicle: "Vehicle updated",
  extend: "Validity extended",
  close: "E-way bill closed",
};
const CANCEL_REASONS = [
  ["duplicate", "Duplicate"],
  ["order_cancelled", "Order cancelled"],
  ["data_entry", "Data entry mistake"],
  ["others", "Others"],
] as const;
const VEHICLE_REASONS = [
  ["breakdown", "Breakdown"],
  ["transhipment", "Transhipment"],
  ["others", "Others"],
  ["first_time", "First time"],
] as const;
const EXTEND_REASONS = [
  ["natural_calamity", "Natural calamity"],
  ["law_and_order", "Law and order"],
  ["transhipment", "Transhipment"],
  ["accident", "Accident"],
  ["others", "Others"],
] as const;
const MODES = ["road", "rail", "air", "ship"] as const;
const MODE_LABEL: Record<(typeof MODES)[number], string> = {
  road: "Road",
  rail: "Rail",
  air: "Air",
  ship: "Ship",
};

function Reasons({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<readonly [string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm text-gray-700">
      {label}
      <select
        className={SELECT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Cancel, change vehicle, extend or close an e-way bill that was generated through the provider.
 * The change is made on the e-way bill portal first, then saved in the register.
 * Bills recorded by hand do not use this.
 */
export function EwayBillActionDialog({
  bill,
  kind,
  onDone,
  onClose,
}: {
  bill: EwayBillView;
  kind: EwayActionKind;
  onDone(bill: EwayBillView): void;
  onClose(): void;
}) {
  const toast = useToastContext();
  const [reasonCode, setReasonCode] = useState("others");
  const [remarks, setRemarks] = useState("");
  const [place, setPlace] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [pincode, setPincode] = useState("");
  const [vehicle, setVehicle] = useState(bill.vehicle_number || "");
  const [mode, setMode] = useState<(typeof MODES)[number]>("road");
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState("");
  const [remainingKm, setRemainingKm] = useState("");
  const [inTransit, setInTransit] = useState("");
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  function build(): EwayBillAction | string {
    if (kind === "cancel") {
      return {
        action: "cancel",
        reason_code: reasonCode as any,
        reason: remarks.trim() || undefined,
      };
    }
    if (kind === "close") {
      if (!remarks.trim()) return "Enter remarks for closing the e-way bill";
      return { action: "close", remarks: remarks.trim() };
    }
    if (!place.trim() || !stateCode)
      return "Enter the place and state the goods are in now";
    if (mode === "road" && !vehicle.trim()) return "Enter the vehicle number";
    if (kind === "vehicle") {
      if (mode !== "road" && (!docNumber.trim() || !docDate))
        return "Enter the transport document number and date";
      return {
        action: "vehicle",
        from_place: place.trim(),
        from_state_code: stateCode,
        reason_code: reasonCode as any,
        reason: remarks.trim() || undefined,
        transport_mode: mode,
        vehicle_number: vehicle.trim() || undefined,
        transport_doc_number: docNumber.trim() || undefined,
        transport_doc_date: docDate || undefined,
      };
    }
    if (!/^\d{6}$/.test(pincode.trim())) return "Enter a 6-digit PIN code";
    if (!/^\d+$/.test(remainingKm.trim()) || Number(remainingKm) <= 0)
      return "Enter the distance left, in km";
    if (!remarks.trim()) return "Enter the reason for the extension";
    return {
      action: "extend",
      from_place: place.trim(),
      from_state_code: stateCode,
      from_pincode: pincode.trim(),
      reason_code: reasonCode as any,
      reason: remarks.trim(),
      remaining_km: Number(remainingKm),
      in_transit: (inTransit || null) as any,
      transport_mode: mode,
      vehicle_number: vehicle.trim() || undefined,
    };
  }

  async function submit() {
    setError("");
    setCode("");
    const body = build();
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/eway-bills/${bill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not update the e-way bill");
        setCode(data.code || "");
        return;
      }
      toast.success(DONE[kind]);
      onDone(data.eway_bill as EwayBillView);
      onClose();
    } catch {
      setError(
        "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const needsConnect = code === "GSP_NOT_CONNECTED" || code === "GSP_AUTH";
  const reasons =
    kind === "cancel"
      ? CANCEL_REASONS
      : kind === "vehicle"
        ? VEHICLE_REASONS
        : EXTEND_REASONS;

  return (
    <SlideOverPanel
      open
      onClose={onClose}
      title={`${TITLE[kind]} ${bill.ewb_number}`}
      widthClass="max-w-md"
    >
      <div className="space-y-3 p-4">
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <p>{error}</p>
            {needsConnect ? (
              <Link
                href={CONNECT_URL}
                className="mt-2 inline-block font-medium text-primary-700 underline"
              >
                Connect Masters India
              </Link>
            ) : null}
          </div>
        ) : null}

        {kind === "cancel" ? (
          <p className="text-sm text-gray-600">
            An e-way bill can only be cancelled within 24 hours of generation.
          </p>
        ) : null}

        {kind !== "close" ? (
          <Reasons
            label="Reason"
            options={reasons}
            value={reasonCode}
            onChange={setReasonCode}
          />
        ) : null}

        {kind === "vehicle" || kind === "extend" ? (
          <>
            <Input
              label="Place the goods are in now"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
            />
            <EwayStateSelect
              label="State the goods are in now"
              value={stateCode}
              onChange={setStateCode}
            />
          </>
        ) : null}

        {kind === "extend" ? (
          <>
            <Input
              label="PIN code of that place"
              inputMode="numeric"
              maxLength={6}
              value={pincode}
              onChange={(e) =>
                setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
            <Input
              label="Distance left (km)"
              type="number"
              inputMode="numeric"
              min={1}
              value={remainingKm}
              onChange={(e) => setRemainingKm(e.target.value)}
            />
            <label className="block text-sm text-gray-700">
              Where the goods are
              <select
                className={SELECT_CLASS}
                value={inTransit}
                onChange={(e) => setInTransit(e.target.value)}
              >
                <option value="">On a vehicle</option>
                <option value="road">In transit, on the road</option>
                <option value="warehouse">In a warehouse</option>
                <option value="others">Somewhere else</option>
              </select>
            </label>
          </>
        ) : null}

        {kind === "vehicle" || kind === "extend" ? (
          <>
            <label className="block text-sm text-gray-700">
              Mode of transport
              <select
                className={SELECT_CLASS}
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as (typeof MODES)[number])
                }
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="Vehicle number"
              value={vehicle}
              placeholder="KA01AB1234"
              onChange={(e) => setVehicle(e.target.value)}
            />
          </>
        ) : null}

        {kind === "vehicle" && mode !== "road" ? (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Transport document number"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
            />
            <Input
              label="Transport document date"
              type="date"
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
            />
          </div>
        ) : null}

        <label className="block text-sm text-gray-700">
          {kind === "close"
            ? "Remarks"
            : kind === "extend"
              ? "Reason for the extension"
              : "Remarks (optional)"}
          <textarea
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button
            variant={kind === "cancel" ? "destructive" : "primary"}
            onClick={submit}
            isLoading={saving}
            disabled={saving}
          >
            {kind === "cancel"
              ? "Cancel e-way bill"
              : kind === "close"
                ? "Close e-way bill"
                : "Save"}
          </Button>
        </div>
      </div>
    </SlideOverPanel>
  );
}
