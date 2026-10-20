/* PLACEHOLDER LOGO — swap for the real brand mark when there is one.
 *
 * A film frame with a pencil-stroke spark, drawn inline so it needs no asset
 * pipeline. Keep the component's props (size, withWordmark) when replacing
 * it and every header picks the new mark up. app/icon.svg is the matching
 * placeholder favicon. */

export function LogoMark({ size = 28, className = '' }) {
  return (
    <svg
      className={`logoMark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Never Bored logo (placeholder)"
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#E8A33D" />
      <rect x="7" y="9" width="18" height="14" rx="2" fill="none" stroke="#1B1400" strokeWidth="2.2" />
      <path d="M7 12.5h18M7 19.5h18" stroke="#1B1400" strokeWidth="1.2" opacity="0.45" />
      <path
        d="M11.5 20 L15 14.5 L17.5 17.5 L20.5 12.5"
        fill="none"
        stroke="#1B1400"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Logo({ size = 28, withWordmark = true, className = '' }) {
  return (
    <span className={`logo ${className}`}>
      <LogoMark size={size} />
      {withWordmark ? <span className="logoWord">Never Bored</span> : null}
    </span>
  );
}
