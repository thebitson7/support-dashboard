// The sidebar's collapsed state, persisted in localStorage. Its own module so
// the app shell's placeholder (shown while the sidebar's code loads) can be
// exactly as wide as the sidebar it stands in for.
//
// Read through useSyncExternalStore so the server render (expanded) and the
// first client render agree, then the stored value is applied after hydration.

const STORAGE_KEY = "sidebar-collapsed";
export const EXPANDED_WIDTH = 256; // w-64
export const COLLAPSED_WIDTH = 64; // w-16

const listeners = new Set<() => void>();

export function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

export function getSnapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function getServerSnapshot() {
  return false;
}

export function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage unavailable (private mode etc.): the toggle still works, it
    // just won't persist.
  }
  listeners.forEach((listener) => listener());
}
