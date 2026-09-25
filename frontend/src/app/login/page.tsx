"use client";

import { useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { CircleAlert, Eye, EyeOff, LoaderCircle, LogIn } from "lucide-react";
import { cn } from "cn";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EASE } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/layout/theme-toggle";

type Field = "username" | "password";

const REQUIRED_MESSAGE: Record<Field, string> = {
  username: "Enter your username.",
  password: "Enter your password.",
};

function waitPhrase(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Incorrect username or password.";
    if (error.status === 429) {
      return error.retryAfterSeconds
        ? `Too many sign-in attempts. Try again in ${waitPhrase(error.retryAfterSeconds)}.`
        : "Too many sign-in attempts. Please wait a few minutes and try again.";
    }
    if (error.status === 0 || error.status === 502) {
      return "Couldn't reach the server. Check your connection and try again.";
    }
  }
  return "Something went wrong while signing in. Please try again.";
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 text-xs font-medium text-destructive">
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const [values, setValues] = useState<Record<Field, string>>({ username: "", password: "" });
  const [touched, setTouched] = useState<Record<Field, boolean>>({
    username: false,
    password: false,
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const inFlight = useRef(false); // guards double-submit before React re-renders
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const ids = { username: useId(), password: useId(), banner: useId() };

  const missing: Record<Field, boolean> = {
    username: !values.username.trim(),
    password: !values.password,
  };
  const fieldError = (field: Field) =>
    touched[field] && missing[field] ? REQUIRED_MESSAGE[field] : null;

  function update(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    // The banner described the previous attempt; editing starts a new one.
    setServerError(null);
  }

  function fieldProps(field: Field) {
    const error = fieldError(field);
    // Each field points at its own message plus the banner, so a screen reader
    // re-reading the field hears why the last attempt failed.
    const describedBy = [error && `${ids[field]}-error`, serverError && ids.banner]
      .filter(Boolean)
      .join(" ");
    return {
      id: ids[field],
      name: field,
      required: true,
      value: values[field],
      onChange: (e: ChangeEvent<HTMLInputElement>) => update(field, e.target.value),
      onBlur: () => setTouched((t) => ({ ...t, [field]: true })),
      "aria-invalid": Boolean(error || serverError) || undefined,
      "aria-describedby": describedBy || undefined,
      className: "h-10",
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    setTouched({ username: true, password: true });
    if (missing.username || missing.password) {
      // Focus the first field that needs attention; its message is linked.
      (missing.username ? usernameRef : passwordRef).current?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setServerError(null);
    try {
      // Success: AppShell sees the signed-in user and redirects.
      await login(values.username.trim(), values.password);
    } catch (err) {
      setServerError(describeError(err));
      if (err instanceof ApiError && err.status === 401) {
        // Keep the username, clear the wrong password and put the cursor
        // there: the banner (role="alert") announces what happened.
        setValues((v) => ({ ...v, password: "" }));
        setTouched((t) => ({ ...t, password: false }));
        passwordRef.current?.focus();
      }
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const usernameError = fieldError("username");
  const passwordError = fieldError("password");

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex min-h-dvh flex-1 items-center justify-center bg-background p-6">
        <ThemeToggle className="absolute top-4 right-4 text-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted" />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="w-full max-w-sm"
        >
          <Card className="gap-6 px-6 py-8 shadow-elev-2 [--card-spacing:--spacing(6)]">
            <div className="grid justify-items-center gap-3 text-center">
              <span
                aria-hidden
                className="grid size-12 place-items-center rounded-full bg-sidebar text-lg font-extrabold text-sidebar-foreground dark:ring-1 dark:ring-sidebar-border"
              >
                S
              </span>
              <div className="grid gap-1">
                <h1 className="text-2xl font-extrabold tracking-tight">Sign in to SupportOS</h1>
                <p className="text-label">Use your support team account</p>
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              noValidate
              aria-busy={submitting}
              aria-label="Sign in"
              className="grid gap-4"
            >
              <AnimatePresence initial={false}>
                {serverError && (
                  <motion.div
                    key="banner"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <p
                      id={ids.banner}
                      role="alert"
                      className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-destructive/30"
                    >
                      <CircleAlert
                        className="mt-0.5 size-4 shrink-0 text-destructive"
                        aria-hidden
                      />
                      {serverError}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid gap-1.5">
                <label htmlFor={ids.username} className="text-sm font-medium">
                  Username
                </label>
                <Input
                  ref={usernameRef}
                  {...fieldProps("username")}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
                {usernameError && (
                  <FieldError id={`${ids.username}-error`}>{usernameError}</FieldError>
                )}
              </div>

              <div className="grid gap-1.5">
                <label htmlFor={ids.password} className="text-sm font-medium">
                  Password
                </label>
                <div className="relative">
                  <Input
                    ref={passwordRef}
                    {...fieldProps("password")}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="h-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    aria-controls={ids.password}
                    className={cn(
                      "absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-muted-foreground transition-colors outline-none hover:text-foreground",
                      "focus-visible:ring-3 focus-visible:ring-ring/50",
                    )}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
                {passwordError && (
                  <FieldError id={`${ids.password}-error`}>{passwordError}</FieldError>
                )}
              </div>

              <Button type="submit" size="lg" className="mt-1 h-10 w-full" disabled={submitting}>
                {submitting ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <LogIn aria-hidden />
                )}
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </Card>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
