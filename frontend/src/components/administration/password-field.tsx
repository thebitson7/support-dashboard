"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Wand2 } from "lucide-react";

import { describedBy, fieldId } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// No look-alikes (0/O, 1/l/I), so a generated password can be read out.
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*-_=+?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** A uniformly random index below `n` (rejection sampling: no modulo bias). */
function randomIndex(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer);
  while (buffer[0] >= limit);
  return buffer[0] % n;
}

/**
 * 16 characters from the browser's cryptographic RNG, with at least one of
 * each character class. Generated here, so the server never has to send a
 * password back; it only checks the one it's given.
 */
export function generatePassword(length = 16): string {
  const pick = (set: string) => set[randomIndex(set.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * A password input with Show/Hide, Generate and Copy. The admin passes it on
 * to the person themselves: it isn't shown again after saving.
 */
export function PasswordField({
  name,
  value,
  onChange,
  error,
  hasHint = false,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** The surrounding Field shows a hint, which the input should point at. */
  hasHint?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. no permission): the field can still be read.
      setVisible(true);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            id={fieldId(name)}
            type={visible ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            {...describedBy(name, error, hasHint)}
            className="h-9 pr-9 font-mono tracking-wide"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {visible ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => {
            onChange(generatePassword());
            setVisible(true);
          }}
        >
          <Wand2 aria-hidden />
          Generate
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          onClick={() => void copy()}
          disabled={!value}
          aria-label={copied ? "Copied" : "Copy password"}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </Button>
      </div>
      {/* Announces the copy for screen readers. */}
      <span className="sr-only" aria-live="polite">
        {copied ? "Password copied to the clipboard." : ""}
      </span>
    </div>
  );
}
