"use client";

import type { ComponentProps } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

const swap = "absolute size-5 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]";

/**
 * Light/dark switch. Both icons are always rendered and swapped purely with
 * the `dark:` variant (rotate + scale + fade), so there is no hydration
 * mismatch and no need to wait for `resolvedTheme` to be known.
 */
export function ThemeToggle({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      className={cn(
        "relative size-10 shrink-0 rounded-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent",
        className,
      )}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
      }}
    >
      <Sun
        className={cn(
          swap,
          "rotate-0 scale-100 opacity-100 dark:-rotate-90 dark:scale-0 dark:opacity-0",
        )}
      />
      <Moon
        className={cn(
          swap,
          "rotate-90 scale-0 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100",
        )}
      />
    </Button>
  );
}
