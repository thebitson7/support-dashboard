import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Clock,
  FileText,
  Globe,
  Home,
  MapPin,
  Search,
  Shield,
  Ticket,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href?: string; // present for leaf items
  icon: LucideIcon;
  children?: NavItem[]; // present for expandable groups
};

export const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "AMS Tickets", href: "/ams-tickets", icon: Ticket },
  {
    label: "Lookups",
    icon: Search,
    children: [
      {
        label: "User Working Hours",
        href: "/lookups/user-working-hours",
        icon: Clock,
      },
      { label: "Sites", href: "/lookups/sites", icon: MapPin },
      { label: "Countries", href: "/lookups/countries", icon: Globe },
      {
        label: "Work Done Codes",
        href: "/lookups/work-done-codes",
        icon: ClipboardCheck,
      },
      { label: "Holidays", href: "/lookups/holidays", icon: CalendarDays },
    ],
  },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Job Sheets", href: "/job-sheets", icon: FileText },
  { label: "Administration", href: "/administration", icon: Shield },
];
