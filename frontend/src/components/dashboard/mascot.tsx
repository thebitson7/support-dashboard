/**
 * "Sparky", the support-desk mascot: an original little robot with a headset.
 * Drawn entirely from theme tokens so it re-tints in light and dark.
 */
export function Mascot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true" focusable="false">
      {/* antenna */}
      <line
        x1="60"
        y1="14"
        x2="60"
        y2="28"
        stroke="var(--foreground)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="60" cy="12" r="6" fill="var(--primary)" />
      {/* ears / headset cups */}
      <rect x="10" y="52" width="12" height="26" rx="6" fill="var(--primary)" />
      <rect x="98" y="52" width="12" height="26" rx="6" fill="var(--primary)" />
      {/* headband */}
      <path
        d="M16 56 C16 22 104 22 104 56"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* mic boom */}
      <path
        d="M104 74 C104 92 90 98 76 98"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="74" cy="98" r="5" fill="var(--primary)" />
      {/* head */}
      <rect x="22" y="30" width="76" height="64" rx="26" fill="var(--foreground)" />
      {/* face plate */}
      <rect x="30" y="40" width="60" height="42" rx="18" fill="var(--background)" opacity="0.16" />
      {/* eyes */}
      <ellipse cx="47" cy="58" rx="6" ry="8" fill="var(--primary)" />
      <ellipse cx="73" cy="58" rx="6" ry="8" fill="var(--primary)" />
      <circle cx="49" cy="55" r="2" fill="var(--foreground)" />
      <circle cx="75" cy="55" r="2" fill="var(--foreground)" />
      {/* smile */}
      <path
        d="M50 74 Q60 82 70 74"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
