export function BrandLogo({ className = '' }) {
  return (
    <span className={`brand-logo ${className}`.trim()} aria-hidden="true">
      <img className="brand-logo-black" src="/assets/brand-logo-black.png" alt="" />
      <img className="brand-logo-white" src="/assets/brand-logo-white.png" alt="" />
    </span>
  );
}
