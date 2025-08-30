// Simple, friendly 64x64 SVG presets. Keep payloads tiny.
export const presets: Record<string, string> = {
  p1: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
        <rect rx="12" width="64" height="64" fill="url(#g1)"/>
        <circle cx="24" cy="28" r="4" fill="#0f172a"/><circle cx="40" cy="28" r="4" fill="#0f172a"/>
        <rect x="22" y="40" width="20" height="4" rx="2" fill="#0f172a"/>
      </svg>`,
  p2: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect rx="12" width="64" height="64" fill="#22d3ee"/>
        <circle cx="32" cy="24" r="12" fill="#fff"/>
        <rect x="14" y="36" width="36" height="12" rx="6" fill="#0ea5e9"/>
      </svg>`,
  p3: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect rx="12" width="64" height="64" fill="#34d399"/>
        <circle cx="24" cy="28" r="5" fill="#052e16"/><circle cx="40" cy="28" r="5" fill="#052e16"/>
        <path d="M20 42c6 6 18 6 24 0" stroke="#052e16" stroke-width="4" fill="none" stroke-linecap="round"/>
      </svg>`,
  p4: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect rx="12" width="64" height="64" fill="#f59e0b"/>
        <circle cx="20" cy="26" r="5" fill="#78350f"/><circle cx="44" cy="26" r="5" fill="#78350f"/>
        <rect x="18" y="40" width="28" height="6" rx="3" fill="#78350f"/>
      </svg>`,
  p5: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect rx="12" width="64" height="64" fill="#f472b6"/>
        <circle cx="32" cy="32" r="16" fill="#fff"/>
        <circle cx="26" cy="30" r="3" fill="#9d174d"/><circle cx="38" cy="30" r="3" fill="#9d174d"/>
        <path d="M24 40c4 4 12 4 16 0" stroke="#9d174d" stroke-width="3" fill="none" stroke-linecap="round"/>
      </svg>`,
  p6: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect rx="12" width="64" height="64" fill="#94a3b8"/>
        <rect x="10" y="18" width="44" height="28" rx="8" fill="#111827"/>
        <circle cx="22" cy="32" r="4" fill="#facc15"/><circle cx="32" cy="32" r="4" fill="#22d3ee"/><circle cx="42" cy="32" r="4" fill="#f472b6"/>
      </svg>`,
  p7: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect rx="12" width="64" height="64" fill="#ef4444"/>
        <path d="M16 44L48 20" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
        <path d="M48 44L16 20" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
      </svg>`,
  p8: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect rx="12" width="64" height="64" fill="#0f172a"/>
        <path d="M8 48h48" stroke="#60a5fa" stroke-width="6" stroke-linecap="round"/>
        <circle cx="20" cy="28" r="4" fill="#60a5fa"/><circle cx="32" cy="28" r="4" fill="#60a5fa"/><circle cx="44" cy="28" r="4" fill="#60a5fa"/>
      </svg>`
};

// Public API used by the app
export function getPresetIds(): string[] {
  return Object.keys(presets);
}
