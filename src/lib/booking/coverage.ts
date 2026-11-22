import { z } from "zod";

export const siteFields = {
  zip: z.string().trim().regex(/^\d{5}$/).optional(),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(200).optional(),
};

export type Site = { zip?: string; city?: string; address?: string };
export type ServiceArea = { serviceZips: string[]; serviceCities: string[] };

export const validZip = (zip?: string) => Boolean(zip && /^\d{5}$/.test(zip));

export function coverageError(area: ServiceArea, site?: Site) {
  if (!area.serviceZips.length && !area.serviceCities.length) return null;
  if (!validZip(site?.zip)) return "Please provide the five-digit site ZIP code.";
  if (site?.zip && area.serviceZips.includes(site.zip)) return null;
  const city = site?.city?.trim().toLowerCase();
  if (city && area.serviceCities.some((allowed) => allowed.toLowerCase() === city)) return null;
  return "That address is outside our service area.";
}
