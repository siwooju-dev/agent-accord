import {
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  FileText,
  Handshake,
  History,
  LayoutGrid,
  Lock,
  MessagesSquare,
  Network,
  PenLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Truck,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

/** Thin wrapper over Lucide so the app keeps one icon vocabulary. */
const icons = {
  overview: LayoutGrid,
  conditions: SlidersHorizontal,
  negotiation: MessagesSquare,
  agreement: Handshake,
  audit: History,
  arrow: ArrowRight,
  check: Check,
  alert: CircleAlert,
  clock: Clock,
  wallet: Wallet,
  spark: Sparkles,
  box: Box,
  shield: ShieldCheck,
  close: X,
  chevron: ChevronDown,
  file: FileText,
  network: Network,
  lock: Lock,
  pen: PenLine,
  truck: Truck,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={2} className={className} aria-hidden="true" />;
}
