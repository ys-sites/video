import { brand } from "../index.js";

/** The same upstream symbol and product wordmark in every application entry. */
export function BrandLogo({ compact = false, variant = "product" }: { compact?: boolean; variant?: "product" | "editor" }) {
  return <span role="img" aria-label={variant === "editor" ? brand.editorName : brand.productName} data-brand={variant} className={`motion-brand-lockup${compact ? " motion-brand-lockup--responsive" : ""}`} />;
}
