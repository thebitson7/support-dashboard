"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { CircleAlert, KeyRound, LoaderCircle, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import type { AdminUser } from "@/types/administration";
import { ApiError, apiPatch, apiPost } from "@/lib/api";
import { displayName, type Role } from "@/lib/auth";
import { SearchCombobox, type ComboOption } from "@/components/common/search-combobox";
import { Field, RequiredMark, describedBy, errorId, fieldId } from "@/components/common/form-field";
import { PasswordField } from "@/components/administration/password-field";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type Values = {
  username: string;
  first_name: string;
  last_name: string;
  role: Role;
  timezone: string;
  is_active: boolean;
  password: string;
};
type FieldName = keyof Values;
const FIELDS: FieldName[] = [
  "username",
  "first_name",
  "last_name",
  "role",
  "timezone",
  "is_active",
  "password",
];
const DEFAULT_ZONE = "Asia/Kuala_Lumpur";

/** Every IANA zone the browser knows (the API validates the same names). */
const ZONES: ComboOption[] = (() => {
  let names: string[];
  try {
    names = Intl.supportedValuesOf("timeZone");
  } catch {
    names = [DEFAULT_ZONE, "Asia/Manila", "Indian/Maldives", "Asia/Singapore", "UTC"];
  }
  return names.map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") }));
})();
const zoneOption = (zone: string): ComboOption | null =>
  zone
    ? (ZONES.find((z) => z.value === zone) ?? { value: zone, label: zone.replace(/_/g, " ") })
    : null;

const ROLES: { value: Role; title: string; description: string }[] = [
  {
    value: "staff",
    title: "Staff",
    description:
      "Sees and logs their own work only: their tickets view, Job Sheets and Working Hours.",
  },
  {
    value: "admin",
    title: "Admin",
    description:
      "Full access: everyone's working hours and Job Sheets, Team Activity reports, managing lookups, and this page, including granting admin to others.",
  },
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** DRF 400 bodies -> per-field messages (known fields) + one line for the rest. */
function splitErrors(data: unknown, known: string[]) {
  const fields: Record<string, string> = {};
  const other: string[] = [];
  if (isRecord(data)) {
    for (const [key, value] of Object.entries(data)) {
      const message = Array.isArray(value) ? value.map(String).join(" ") : String(value);
      if (known.includes(key)) fields[key] = message;
      else other.push(message);
    }
  }
  return { fields, general: other.join(" ") || null };
}

function generalMessage(err: unknown, action: string): string {
  if (err instanceof ApiError && err.status === 429) {
    const minutes = err.retryAfterSeconds ? Math.ceil(err.retryAfterSeconds / 60) : null;
    return `Too many changes in a short time. Try again${minutes ? ` in ${minutes} min` : " later"}.`;
  }
  if (err instanceof ApiError && err.status === 403) return "Only admins can manage users.";
  if (err instanceof ApiError && (err.status === 0 || err.status === 502)) {
    return "Couldn't reach the server. Your entries are kept; try again.";
  }
  return `Something went wrong while ${action}. Your entries are kept; try again.`;
}

/**
 * Add a user (user = null) or edit one. Mount with a fresh `key` per
 * opening. `self` marks the signed-in admin's own account: the server
 * refuses to let them remove their own admin role or deactivate themselves,
 * so those controls are disabled here, with the reason.
 */
export function UserFormDialog({
  user,
  isSelf,
  open,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null;
  isSelf: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const creating = user === null;
  const [values, setValues] = useState<Values>(() =>
    user
      ? { ...user, password: "" }
      : {
          username: "",
          first_name: "",
          last_name: "",
          role: "staff",
          timezone: DEFAULT_ZONE,
          is_active: true,
          password: "",
        },
  );
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const inFlight = useRef(false);
  const roleGroupId = useId();

  const clientErrors = useMemo(() => {
    const errors: Partial<Record<FieldName, string>> = {};
    if (creating && !values.username.trim()) errors.username = "Choose a username.";
    if (!values.timezone) errors.timezone = "Choose a time zone.";
    if (creating && !values.password) errors.password = "Set a password, or generate one.";
    return errors;
  }, [creating, values]);
  const error = (name: FieldName) =>
    serverErrors[name] ?? (attempted ? clientErrors[name] : undefined);
  const set = <K extends FieldName>(name: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [name]: value }));
    setServerErrors((e) => ({ ...e, [name]: "" }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setAttempted(true);
    const firstInvalid = FIELDS.find((f) => clientErrors[f]);
    if (firstInvalid) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setGeneral(null);
    try {
      const saved = creating
        ? await apiPost<AdminUser>("/accounts/admin/users/", {
            username: values.username.trim(),
            first_name: values.first_name.trim(),
            last_name: values.last_name.trim(),
            role: values.role,
            timezone: values.timezone,
            is_active: values.is_active,
            password: values.password,
          })
        : await apiPatch<AdminUser>(`/accounts/admin/users/${user.id}/`, {
            first_name: values.first_name.trim(),
            last_name: values.last_name.trim(),
            role: values.role,
            timezone: values.timezone,
            is_active: values.is_active,
          });
      toast.success(creating ? "User added" : "User updated", {
        description: creating
          ? `${displayName(saved)} can sign in as “${saved.username}”. Share the password with them directly.`
          : displayName(saved),
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const { fields, general: rest } = splitErrors(err.data, FIELDS);
        setServerErrors(fields);
        setGeneral(rest);
        const first = FIELDS.find((f) => fields[f]);
        if (first) document.getElementById(fieldId(first))?.focus();
      } else {
        setGeneral(generalMessage(err, "saving"));
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const title = creating ? "Add user" : `Edit ${displayName(user)}`;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))]"
          initialFocus={() =>
            document.getElementById(fieldId(creating ? "username" : "first_name"))
          }
        >
          <form
            onSubmit={submit}
            noValidate
            aria-busy={submitting}
            className="flex min-h-0 flex-col"
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 pt-5 pb-4">
              <div className="grid gap-1">
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                  {creating
                    ? "Create an account. Choose or generate a password and give it to the person directly."
                    : `Signed in as “${user.username}”.${isSelf ? " This is your own account." : ""}`}
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="-mr-2 shrink-0 rounded-full"
              >
                <X aria-hidden />
              </Button>
            </header>

            <div className="scrollbar-styled min-h-0 overflow-y-auto px-6 py-5">
              {general && (
                <div
                  role="alert"
                  className="mb-5 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-destructive/30"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  {general}
                </div>
              )}
              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                {creating ? (
                  <Field
                    name="username"
                    label="Username"
                    required
                    error={error("username")}
                    hint="Used to sign in. Can't be changed later."
                    className="sm:col-span-2"
                  >
                    <Input
                      id={fieldId("username")}
                      value={values.username}
                      onChange={(e) => set("username", e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={150}
                      {...describedBy("username", error("username"), true)}
                      className="h-9 font-mono"
                    />
                  </Field>
                ) : null}
                <Field name="first_name" label="First name" error={error("first_name")}>
                  <Input
                    id={fieldId("first_name")}
                    value={values.first_name}
                    onChange={(e) => set("first_name", e.target.value)}
                    maxLength={150}
                    {...describedBy("first_name", error("first_name"))}
                    className="h-9"
                  />
                </Field>
                <Field name="last_name" label="Last name" error={error("last_name")}>
                  <Input
                    id={fieldId("last_name")}
                    value={values.last_name}
                    onChange={(e) => set("last_name", e.target.value)}
                    maxLength={150}
                    {...describedBy("last_name", error("last_name"))}
                    className="h-9"
                  />
                </Field>

                {/* Role: two described choices, since Admin is a real grant of access. */}
                <fieldset
                  className="grid gap-2 sm:col-span-2"
                  aria-describedby={error("role") ? errorId("role") : undefined}
                >
                  <legend id={roleGroupId} className="mb-1.5 text-sm font-medium">
                    Role
                    <RequiredMark />
                  </legend>
                  <div
                    className="grid gap-2 sm:grid-cols-2"
                    role="radiogroup"
                    aria-labelledby={roleGroupId}
                  >
                    {ROLES.map((role, index) => {
                      const checked = values.role === role.value;
                      // Your own account can't be demoted (the server refuses it too).
                      const locked = isSelf && role.value !== "admin";
                      return (
                        <label
                          key={role.value}
                          className={cn(
                            "relative flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors duration-150 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                            checked
                              ? "border-primary bg-accent/60"
                              : "border-control hover:bg-muted/60",
                            locked && "cursor-not-allowed opacity-60",
                          )}
                        >
                          <input
                            id={index === 0 ? fieldId("role") : undefined}
                            type="radio"
                            name="role"
                            value={role.value}
                            checked={checked}
                            disabled={locked}
                            onChange={() => set("role", role.value)}
                            className="mt-1 size-4 accent-(--primary)"
                          />
                          <span className="grid gap-0.5">
                            <span className="flex items-center gap-1.5 text-sm font-semibold">
                              {role.value === "admin" && (
                                <ShieldAlert className="size-4 text-primary" aria-hidden />
                              )}
                              {role.title}
                            </span>
                            <span className="text-caption">{role.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {error("role") ? (
                    <p
                      id={errorId("role")}
                      className="flex items-center gap-1.5 text-xs font-medium text-destructive"
                    >
                      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                      {error("role")}
                    </p>
                  ) : isSelf ? (
                    <p className="text-caption">
                      You can&apos;t remove your own admin access; another admin can.
                    </p>
                  ) : values.role === "admin" && user?.role !== "admin" ? (
                    <p className="text-caption font-medium text-foreground">
                      This gives {creating ? "them" : displayName(user)} full admin access.
                    </p>
                  ) : null}
                </fieldset>

                <Field
                  name="timezone"
                  label="Time zone"
                  required
                  error={error("timezone")}
                  hint="Decides which day is “today” for them."
                >
                  <SearchCombobox
                    id={fieldId("timezone")}
                    aria-labelledby={`${fieldId("timezone")}-label`}
                    aria-describedby={error("timezone") ? errorId("timezone") : undefined}
                    value={zoneOption(values.timezone)}
                    onChange={(option) => set("timezone", option?.value ?? "")}
                    options={ZONES}
                    placeholder="Search time zones…"
                    emptyText="No time zone matches."
                    invalid={Boolean(error("timezone"))}
                  />
                </Field>

                <div className="flex items-start gap-3 self-center sm:pt-6">
                  <Switch
                    id={fieldId("is_active")}
                    checked={values.is_active}
                    onCheckedChange={(checked) => set("is_active", checked)}
                    disabled={isSelf}
                    aria-describedby={`${fieldId("is_active")}-hint`}
                    className="mt-0.5"
                  />
                  <div className="grid gap-0.5">
                    <label htmlFor={fieldId("is_active")} className="text-sm font-medium">
                      Active
                    </label>
                    <p id={`${fieldId("is_active")}-hint`} className="text-caption">
                      {error("is_active") ||
                        (isSelf
                          ? "You can't deactivate your own account."
                          : values.is_active
                            ? "Can sign in."
                            : "Can't sign in; their history is kept.")}
                    </p>
                  </div>
                </div>

                {creating ? (
                  <Field
                    name="password"
                    label="Password"
                    required
                    error={error("password")}
                    hint="At least 10 characters, not common or all numbers. Generate one to be safe."
                    className="sm:col-span-2"
                  >
                    <PasswordField
                      name="password"
                      value={values.password}
                      onChange={(v) => set("password", v)}
                      error={error("password")}
                      hasHint
                    />
                  </Field>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 sm:col-span-2">
                    <div className="grid gap-0.5">
                      <p className="text-sm font-medium">Password</p>
                      <p className="text-caption">
                        Set a new one if they&apos;ve forgotten it; they&apos;ll be signed out
                        everywhere.
                      </p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => setResetOpen(true)}>
                      <KeyRound aria-hidden />
                      Reset password…
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-3">
              <p className="text-caption">
                <RequiredMark /> Required field
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="min-w-28">
                  {submitting && (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                  )}
                  {submitting ? "Saving…" : creating ? "Add user" : "Save changes"}
                </Button>
              </div>
            </footer>
          </form>
        </DialogContent>
      </Dialog>

      {user && (
        <ResetPasswordDialog
          key={String(resetOpen)}
          user={user}
          open={resetOpen}
          onOpenChange={setResetOpen}
        />
      )}
    </>
  );
}

/** Confirmed, separate from the main form: a reset signs the person out everywhere. */
function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const name = displayName(user);

  async function reset() {
    if (!password) {
      setError("Set the new password, or generate one.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await apiPatch(`/accounts/admin/users/${user.id}/`, { new_password: password });
      toast.success("Password reset", {
        description: `${name} has been signed out everywhere. Share the new password with them directly.`,
      });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? (splitErrors(err.data, ["new_password"]).fields.new_password ?? err.message)
          : generalMessage(err, "resetting the password"),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent className="w-[min(30rem,calc(100vw-2rem))]">
        <div className="grid gap-1">
          <AlertDialogTitle>Reset {name}&apos;s password?</AlertDialogTitle>
          <AlertDialogDescription>
            Their current password stops working and they&apos;re signed out on every device.
          </AlertDialogDescription>
        </div>
        <Field name="new_password" label="New password" error={error} hint="At least 10 characters">
          <PasswordField
            name="new_password"
            value={password}
            onChange={setPassword}
            error={error}
            hasHint
          />
        </Field>
        <div className="flex justify-end gap-2">
          <AlertDialogClose render={<Button variant="ghost" />} disabled={pending}>
            Cancel
          </AlertDialogClose>
          <Button variant="destructive" onClick={() => void reset()} disabled={pending}>
            {pending && (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            Reset password
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
