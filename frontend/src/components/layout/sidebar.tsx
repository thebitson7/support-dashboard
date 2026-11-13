"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, MotionConfig, motion, type Variants } from "framer-motion";
import { ChevronRight, ChevronsLeft, ChevronsRight, LogOut, type LucideIcon } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { navItems, type NavBadgeKey, type NavItem } from "@/config/nav";
import {
  COLLAPSED_WIDTH,
  EXPANDED_WIDTH,
  getServerSnapshot,
  getSnapshot,
  subscribe,
  writeCollapsed,
} from "@/components/layout/sidebar-state";
import { urgentCount } from "@/lib/attention";
import { displayName, initials, useAuth, type AuthUser } from "@/lib/auth";
import { useUrgentTickets } from "@/components/attention/urgent-tickets-provider";

// --- Motion tokens ------------------------------------------------------------
// One easing curve ("ease-out-expo"-like) drives every sidebar animation.

const EASE = [0.22, 1, 0.36, 1] as const;
const WIDTH_DURATION = 0.32;
const WIDTH_DELAY_ON_COLLAPSE = 0.08; // let labels fade before the width shrinks
const FADE_DURATION = 0.12;
const FADE_DELAY_ON_EXPAND = 0.14; // let the width open before labels fade in
const PILL_ID = "nav-active-pill";
const PRESS = { duration: 0.16, ease: EASE };

// Tailwind hooks for the base-ui tooltip/popover enter (fade + scale) and a
// quicker exit. tw-animate-css reads --tw-duration and --tw-ease.
const POPUP_MOTION = "duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-closed:duration-100";

// `animated` stays false until the user first toggles, so a stored
// "collapsed" state applies instantly on load instead of visibly animating.
const SidebarContext = createContext({ collapsed: false, animated: false });

function useFadeTransition() {
  const { collapsed, animated } = useContext(SidebarContext);
  return {
    duration: animated ? FADE_DURATION : 0,
    delay: animated && !collapsed ? FADE_DELAY_ON_EXPAND : 0,
    ease: EASE,
  };
}

// --- Helpers ------------------------------------------------------------------

function isRouteActive(pathname: string, href?: string) {
  if (!href) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const rowBase =
  "relative flex h-10 w-full items-center gap-3 rounded-full px-2.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring";
const rowIdle = "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground";
// The dark-on-orange text colour waits for the sliding pill to arrive so the
// label is never dark-on-navy mid-transition.
const activeText = "text-sidebar-primary-foreground [transition-delay:200ms] duration-150";
const rowActive = activeText;

/** Press feedback + hover propagation for a clickable row. */
function Pressable({ children }: { children: ReactNode }) {
  return (
    // framer-motion adds tabindex="0" to any element with a press gesture unless
    // it already has one. The real link/button inside is the tab stop, so the
    // wrapper opts out with -1 (otherwise every item is focused twice).
    <motion.div tabIndex={-1} whileHover="hover" whileTap={{ scale: 0.97 }} transition={PRESS}>
      {children}
    </motion.div>
  );
}

/**
 * The active highlight. With a `layoutId` the one pill is shared by every
 * nav row, so framer-motion slides it from the previous active row to the
 * new one. Without one (the collapsed flyout) it is a plain static pill.
 */
function ActivePill({ layoutId }: { layoutId?: string }) {
  return (
    <motion.span
      layoutId={layoutId}
      transition={{ duration: 0.35, ease: EASE }}
      style={{ borderRadius: 9999 }}
      className="absolute inset-0 z-0 bg-sidebar-primary"
      aria-hidden
    />
  );
}

function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <motion.span
      variants={{ hover: { scale: 1.1 } }}
      transition={{ duration: 0.2, ease: EASE }}
      className="relative z-10 flex shrink-0"
    >
      <Icon className="size-5" />
    </motion.span>
  );
}

function Label({ children }: { children: ReactNode }) {
  const { collapsed } = useContext(SidebarContext);
  const transition = useFadeTransition();
  return (
    <motion.span
      initial={false}
      animate={{ opacity: collapsed ? 0 : 1 }}
      transition={transition}
      className="relative z-10 min-w-0 flex-1 truncate text-left"
    >
      {children}
    </motion.span>
  );
}

// --- Badges -------------------------------------------------------------------

type NavBadgeState = { count: number; critical: boolean; description: string };

/** The live count behind a nav item's `badge`, or null when there's nothing to show. */
function useNavBadge(key: NavBadgeKey | undefined): NavBadgeState | null {
  const { data } = useUrgentTickets();
  if (key !== "ticketsToClose" || !data) return null;
  const count = urgentCount(data.counts);
  if (count === 0) return null;
  return {
    count,
    critical: data.counts.critical > 0,
    description: `${count} ${count === 1 ? "ticket needs" : "tickets need"} closing`,
  };
}

// Fixed colours: the sidebar is navy in both themes. White on this red is
// 5.6:1, black on the brand orange 8.3:1.
const badgeTone = (critical: boolean) =>
  critical ? "bg-[#c62a1d] text-white" : "bg-sidebar-primary text-sidebar-primary-foreground";

function NavBadge({ badge }: { badge: NavBadgeState }) {
  const { collapsed } = useContext(SidebarContext);
  if (collapsed) {
    // A dot on the icon's corner; the count is in the link's accessible name and tooltip.
    return (
      <span
        aria-hidden
        className={cn(
          "absolute top-1.5 left-7 z-20 size-2.5 rounded-full ring-2 ring-sidebar",
          badgeTone(badge.critical),
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "relative z-10 grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
        badgeTone(badge.critical),
      )}
    >
      {badge.count > 99 ? "99+" : badge.count}
    </span>
  );
}

// --- Items ------------------------------------------------------------------

function LeafItem({ item, active }: { item: NavItem; active: boolean }) {
  const { collapsed } = useContext(SidebarContext);
  const badge = useNavBadge(item.badge);
  // A leaf without a route is a config mistake; render nothing rather than a dead link.
  if (!item.href) return null;
  const name = badge ? `${item.label}, ${badge.description}` : item.label;
  return (
    <Pressable>
      <Tooltip disabled={!collapsed}>
        <TooltipTrigger
          render={
            <Link
              href={item.href}
              aria-label={name}
              aria-current={active ? "page" : undefined}
              className={cn(rowBase, active ? rowActive : rowIdle)}
            />
          }
        >
          {active && <ActivePill layoutId={PILL_ID} />}
          <NavIcon icon={item.icon} />
          <Label>{item.label}</Label>
          {badge && <NavBadge badge={badge} />}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={16} className={POPUP_MOTION}>
          {name}
        </TooltipContent>
      </Tooltip>
    </Pressable>
  );
}

const itemVariants: Variants = {
  closed: { opacity: 0, x: -10, transition: { duration: 0.12 } },
  open: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE } },
};

const listVariants: Variants = {
  closed: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: 0.28, ease: EASE },
      opacity: { duration: 0.16, ease: EASE },
    },
  },
  open: {
    height: "auto",
    opacity: 1,
    transition: {
      height: { duration: WIDTH_DURATION, ease: EASE },
      opacity: { duration: 0.24, ease: EASE },
      delayChildren: 0.06,
      staggerChildren: 0.035,
    },
  },
};

function ChildLink({
  item,
  active,
  pillId,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  pillId?: string;
  onNavigate?: () => void;
}) {
  if (!item.href) return null;
  return (
    <Pressable>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex h-9 w-full items-center gap-3 rounded-full px-3 text-[13px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          active
            ? activeText
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        {active && <ActivePill layoutId={pillId} />}
        <motion.span
          variants={{ hover: { scale: 1.5 } }}
          transition={{ duration: 0.2, ease: EASE }}
          className={cn(
            "relative z-10 size-1.5 shrink-0 rounded-full bg-current",
            !active && "opacity-50",
          )}
        />
        <span className="relative z-10 truncate">{item.label}</span>
      </Link>
    </Pressable>
  );
}

function GroupItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const { collapsed } = useContext(SidebarContext);
  const fade = useFadeTransition();
  const children = item.children ?? [];
  const childActive = children.some((child) => isRouteActive(pathname, child.href));

  // Starts expanded when the current route lives inside this group.
  const [expanded, setExpanded] = useState(childActive);
  const [flyoutOpen, setFlyoutOpen] = useState(false);

  const highlighted = childActive && collapsed; // group icon stands in for its active child
  const showChildren = expanded && !collapsed;

  return (
    <div>
      <Pressable>
        <Popover
          open={collapsed && flyoutOpen}
          onOpenChange={(open) => {
            if (collapsed) setFlyoutOpen(open);
          }}
        >
          <PopoverTrigger
            openOnHover={collapsed}
            delay={150}
            closeDelay={150}
            aria-label={item.label}
            aria-expanded={collapsed ? flyoutOpen : expanded}
            onClick={() => {
              if (!collapsed) setExpanded((value) => !value);
            }}
            className={cn(
              rowBase,
              highlighted
                ? rowActive
                : cn(rowIdle, childActive && "font-semibold text-sidebar-foreground"),
            )}
          >
            {highlighted && <ActivePill layoutId={PILL_ID} />}
            <NavIcon icon={item.icon} />
            <Label>{item.label}</Label>
            <motion.span
              initial={false}
              animate={{
                rotate: showChildren ? 90 : 0,
                opacity: collapsed ? 0 : 1,
              }}
              transition={{
                rotate: { duration: 0.3, ease: EASE },
                opacity: fade,
              }}
              className="relative z-10 flex shrink-0"
            >
              <ChevronRight className="size-4" />
            </motion.span>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={16}
            className={cn(
              "w-56 gap-1 bg-sidebar p-2 text-sidebar-foreground ring-sidebar-border",
              POPUP_MOTION,
            )}
          >
            <p className="px-3 pt-1 pb-1.5 text-xs font-medium text-sidebar-foreground/70">
              {item.label}
            </p>
            {children.map((child) => (
              <ChildLink
                key={child.href}
                item={child}
                active={isRouteActive(pathname, child.href)}
                onNavigate={() => setFlyoutOpen(false)}
              />
            ))}
          </PopoverContent>
        </Popover>
      </Pressable>

      <AnimatePresence initial={false}>
        {showChildren && (
          <motion.div
            key="children"
            variants={listVariants}
            initial="closed"
            animate="open"
            exit="closed"
            className="overflow-hidden"
          >
            <div className="my-1 ml-[21px] flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
              {children.map((child) => (
                <motion.div key={child.href} variants={itemVariants}>
                  <ChildLink
                    item={child}
                    active={isRouteActive(pathname, child.href)}
                    pillId={PILL_ID}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- User menu ----------------------------------------------------------------

function Avatar({ user }: { user: AuthUser }) {
  return (
    <span
      aria-hidden
      className="relative z-10 grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground"
    >
      {initials(user)}
    </span>
  );
}

function RoleBadge({ role }: { role: AuthUser["role"] }) {
  return (
    <span
      className={cn(
        "inline-flex h-4.5 items-center rounded-full px-1.5 text-[10px] font-semibold tracking-wide uppercase",
        role === "admin"
          ? "bg-sidebar-primary/20 text-sidebar-primary"
          : "bg-sidebar-accent text-sidebar-foreground/75",
      )}
    >
      {role}
    </span>
  );
}

/** Who is signed in (always visible) and the way out. */
function UserMenu() {
  const { user, logout } = useAuth();
  const { collapsed } = useContext(SidebarContext);
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const name = displayName(user);

  if (collapsed) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Account: ${name}`}
          className="mx-auto flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Avatar user={user} />
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={16}
          className={cn(
            "w-56 gap-2 bg-sidebar p-3 text-sidebar-foreground ring-sidebar-border",
            POPUP_MOTION,
          )}
        >
          <div className="grid gap-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            <RoleBadge role={user.role} />
          </div>
          <Button
            variant="ghost"
            className="h-9 justify-start rounded-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent"
            onClick={logout}
          >
            <LogOut />
            Log out
          </Button>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className="flex items-center gap-2.5 pl-0.5">
      <Avatar user={user} />
      <div className="grid min-w-0 flex-1 justify-items-start gap-0.5">
        <p className="w-full truncate text-sm font-semibold" title={name}>
          {name}
        </p>
        <RoleBadge role={user.role} />
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Log out"
              className={headerButton}
              onClick={logout}
            />
          }
        >
          <LogOut className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={16} className={POPUP_MOTION}>
          Log out
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// --- Sidebar ------------------------------------------------------------------

const headerButton =
  "size-10 shrink-0 rounded-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent";

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  // Admin-only entries aren't offered to anyone else (the pages guard
  // themselves too, and the API is the real authority).
  const items = navItems.filter((item) => !item.adminOnly || user?.role === "admin");
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [animated, setAnimated] = useState(false);
  const fade = {
    duration: animated ? FADE_DURATION : 0,
    delay: animated && !collapsed ? FADE_DELAY_ON_EXPAND : 0,
    ease: EASE,
  };
  const ToggleIcon = collapsed ? ChevronsRight : ChevronsLeft;

  return (
    <MotionConfig reducedMotion="user">
      <SidebarContext.Provider value={{ collapsed, animated }}>
        <TooltipProvider delay={150}>
          <motion.aside
            initial={false}
            animate={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
            transition={{
              duration: animated ? WIDTH_DURATION : 0,
              delay: animated && collapsed ? WIDTH_DELAY_ON_COLLAPSE : 0,
              ease: EASE,
            }}
            style={{ width: EXPANDED_WIDTH }}
            className="flex h-dvh shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
          >
            <div className="flex h-16 shrink-0 items-center justify-between px-3">
              <motion.span
                initial={false}
                animate={{
                  opacity: collapsed ? 0 : 1,
                  width: collapsed ? 0 : "auto",
                }}
                transition={fade}
                className="overflow-hidden text-lg font-extrabold tracking-tight whitespace-nowrap"
              >
                {/* padding lives on the inner span: a padded box can't shrink to 0 width */}
                <span className="block pl-2.5">SupportOS</span>
              </motion.span>
              <div className="flex items-center">
                <motion.div
                  initial={false}
                  animate={{
                    opacity: collapsed ? 0 : 1,
                    width: collapsed ? 0 : 40,
                  }}
                  transition={fade}
                  className="overflow-hidden"
                  inert={collapsed}
                >
                  <ThemeToggle />
                </motion.div>
                <Button
                  variant="ghost"
                  size="icon"
                  className={headerButton}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  onClick={() => {
                    setAnimated(true);
                    writeCollapsed(!collapsed);
                  }}
                >
                  <ToggleIcon className="size-5" />
                </Button>
              </div>
            </div>

            <nav
              aria-label="Main"
              className="flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-3 pb-4"
            >
              {items.map((item) =>
                item.children ? (
                  <GroupItem key={item.label} item={item} pathname={pathname} />
                ) : (
                  <LeafItem
                    key={item.href}
                    item={item}
                    active={isRouteActive(pathname, item.href)}
                  />
                ),
              )}

              {/* The header has no room for the theme toggle at 64px, so it
                  drops below the nav items while collapsed. */}
              <AnimatePresence initial={false}>
                {collapsed && (
                  <motion.div
                    key="theme-footer"
                    initial={{ opacity: 0 }}
                    animate={{
                      opacity: 1,
                      transition: { duration: 0.2, delay: 0.2, ease: EASE },
                    }}
                    exit={{ opacity: 0, transition: { duration: 0.08 } }}
                    className="mt-2 border-t border-sidebar-border pt-2"
                  >
                    <Tooltip>
                      <TooltipTrigger render={<ThemeToggle />} />
                      <TooltipContent side="right" sideOffset={16} className={POPUP_MOTION}>
                        Toggle theme
                      </TooltipContent>
                    </Tooltip>
                  </motion.div>
                )}
              </AnimatePresence>
            </nav>

            <div className="shrink-0 border-t border-sidebar-border px-3 py-3">
              <UserMenu />
            </div>
          </motion.aside>
        </TooltipProvider>
      </SidebarContext.Provider>
    </MotionConfig>
  );
}
