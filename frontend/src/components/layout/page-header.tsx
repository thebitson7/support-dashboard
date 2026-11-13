"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Plus, type LucideIcon } from "lucide-react";

import { EASE } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Breadcrumb, type BreadcrumbItem } from "@/components/layout/breadcrumb";

/**
 * The top of every signed-in page except Home: breadcrumb, title, one line
 * of description, and the page's actions on the right (wrapping below on
 * narrow screens). One component, so every page lines up the same way.
 */
export function PageHeader({
  trail,
  title,
  description,
  actions,
}: {
  /** The breadcrumb after "Home"; the last item is this page. */
  trail: BreadcrumbItem[];
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="grid gap-3">
      <Breadcrumb items={trail} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          {description && <p className="text-label">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * A page's primary action ("New ticket", "Add user"…): full size, brand
 * orange, a lift on hover and a press-in on click, the same on every page.
 */
export function PrimaryAction({
  icon: Icon = Plus,
  onClick,
  children,
}: {
  icon?: LucideIcon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.16, ease: EASE }}
    >
      <Button
        size="lg"
        onClick={onClick}
        className="h-10 gap-2 rounded-full px-5 font-semibold shadow-elev-1 transition-shadow duration-200 hover:bg-primary hover:shadow-elev-hover"
      >
        <Icon className="size-4.5" strokeWidth={2.5} aria-hidden />
        {children}
      </Button>
    </motion.div>
  );
}
