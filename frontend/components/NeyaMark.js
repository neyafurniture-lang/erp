'use client';

/** Marque NEYA — alignée sur neya-craft-flow (Lovable) */
export default function NeyaMark({ className = 'h-8 w-8' }) {
  return (
    <svg
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      <rect width="40" height="40" rx="10" fill="var(--primary, #D86B30)" />
      <path
        d="M11 29V11h3.4l10.2 12.1V11H28v18h-3.4L14.4 16.9V29H11z"
        fill="var(--primary-foreground, #fffdfb)"
      />
    </svg>
  );
}
