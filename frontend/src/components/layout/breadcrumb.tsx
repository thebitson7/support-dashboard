import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * The trail above every page title except Home's: "Home › Section › Page".
 * The last item is the current page; any other item without an `href` is a
 * plain label (e.g. the "Lookups" group, which has no page of its own).
 */
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  const trail = [{ label: "Home", href: "/" }, ...items];
  return (
    <nav aria-label="Breadcrumb">
      <ol className="text-label flex flex-wrap items-center gap-1.5">
        {trail.map((item, index) => {
          const current = index === trail.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {index > 0 && <ChevronRight aria-hidden className="size-4" strokeWidth={2} />}
              {current ? (
                <span aria-current="page" className="font-semibold text-foreground">
                  {item.label}
                </span>
              ) : item.href ? (
                <Link
                  href={item.href}
                  className="rounded-sm transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {item.label}
                </Link>
              ) : (
                <span>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
