"use client";

import { useState } from "react";

export function BookingBrand({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  return (
    <header className="space-y-3">
      {logoUrl && logoUrl !== brokenUrl &&
        // Customers supply the image host. Load it directly without routing it through the app's image optimiser.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-11 max-w-40 object-contain object-left" onError={() => setBrokenUrl(logoUrl)} referrerPolicy="no-referrer" />}
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Book with {name}</h1>
    </header>
  );
}
