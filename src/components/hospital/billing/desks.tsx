import {
  Building2,
  FlaskConical,
  HeartPulse,
  Pill,
  ScanLine,
  Scissors,
  Siren,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import type { ReceiptDeskKey } from "@/lib/hospital/catalog";

export const DESK_ICONS: Record<ReceiptDeskKey, LucideIcon> = {
  clinics: Stethoscope,
  er: Siren,
  lab: FlaskConical,
  radiology: ScanLine,
  surgery: Scissors,
  icu: HeartPulse,
  pharmacy: Pill,
  other: Building2,
};
