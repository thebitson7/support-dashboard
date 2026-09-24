import type { AmsTicket } from "@/types/tickets";

// Deterministic mock generator for the AMS Tickets table (~2,800 rows).
// Everything comes from a seeded PRNG, so server and client always agree and
// the dataset is stable between reloads. Swap `MOCK_TICKETS` for an API
// response mapped onto AmsTicket and nothing else needs to change.

const TICKET_COUNT = 2800;
const DAY_MS = 86_400_000;
/** "Now" for the mock data (fixed, so the output never changes). */
const ANCHOR = Date.UTC(2026, 8, 24, 9, 30);
const SPAN_DAYS = 92;

// mulberry32: tiny, fast, good enough for mock data.
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SITE_NAMES = [
  "NG Teng Fong General Hospital",
  "Penang Adventist Hospital",
  "Frimley Park Hospital",
  "Sunway Velocity",
  "Mount Elizabeth Hospital Singapore",
  "Singapore Med Lab Cebu NRA",
  "Gleneagles Hospital Kuala Lumpur",
  "Raffles Hospital Singapore",
  "Bumrungrad International Hospital",
  "Samitivej Sukhumvit Hospital",
  "Siriraj Hospital Laboratory",
  "St. Luke's Medical Center Global City",
  "Makati Medical Center",
  "The Medical City Ortigas",
  "Hospital Cardiologi Jakarta",
  "Siloam Hospitals Lippo Village",
  "Mayapada Hospital Kuningan",
  "Prince of Wales Hospital Hong Kong",
  "Queen Mary Hospital Laboratory",
  "Tan Tock Seng Hospital",
  "Changi General Hospital",
  "Khoo Teck Puat Hospital",
  "Subang Jaya Medical Centre",
  "Pantai Hospital Kuala Lumpur",
  "Prince Court Medical Centre",
  "Hospital Sultanah Aminah Johor",
  "Auckland City Hospital Labs",
  "Middlemore Hospital Diagnostics",
  "Royal Brisbane and Women's Hospital",
  "Fiji Pearl Pathology Suva",
  "Port Moresby General Hospital",
  "Vinmec Central Park Hospital",
  "FV Hospital Ho Chi Minh City",
  "Bangkok Hospital Phuket",
  "Bangladesh Specialized Hospital Dhaka",
  "Apollo Hospitals Colombo",
];

const STAFF = ["Syed", "Naleefa", "Wahida", "Maher", "Rukesh", "Abdul_Karem", "Jeremy"];

const CMS_PREFIXES = ["RA", "RC", "RB", "TA", "SA"];

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function generate(): AmsTicket[] {
  const rng = createRng(20260924);
  const int = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];

  // One stable OCN per site (a few sites also have a second OCN).
  const siteOcns = SITE_NAMES.map((_, i) => {
    const primary = `OCN0${pad(int(1000, 9999), 4)}-801-00`;
    const secondary = i % 7 === 0 ? `OCN0${pad(int(1000, 9999), 4)}-802-00` : null;
    return secondary ? ([primary, secondary] as const) : ([primary] as const);
  });
  // Uneven volume: a few big sites, a long tail of small ones.
  const weights = SITE_NAMES.map((_, i) => 1 / (1 + i * 0.28));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const pickSite = (): number => {
    let r = rng() * totalWeight;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  };

  const rows: Omit<AmsTicket, "id">[] = [];
  for (let n = 0; n < TICKET_COUNT; n++) {
    const siteIndex = pickSite();
    const ocns = siteOcns[siteIndex];

    // Working hours skew (06:00–20:59), fewer tickets on weekends.
    let dayOffset = int(0, SPAN_DAYS - 1);
    const hour = int(6, 20);
    const minute = int(0, 59);
    let receivedAt = Date.UTC(2026, 8, 24, hour, minute) - dayOffset * DAY_MS;
    const weekday = new Date(receivedAt).getUTCDay();
    if ((weekday === 0 || weekday === 6) && rng() < 0.65) {
      dayOffset += weekday === 6 ? 1 : 2;
      receivedAt = Date.UTC(2026, 8, 24, hour, minute) - dayOffset * DAY_MS;
    }
    if (receivedAt > ANCHOR) receivedAt -= DAY_MS;

    // Recent tickets are far more likely to still be open (~17% overall).
    const ageDays = (ANCHOR - receivedAt) / DAY_MS;
    const openChance = Math.min(0.9, 0.06 + 1.6 * Math.exp(-ageDays / 6));
    const isOpen = rng() < openChance;

    const createdBy = pick(STAFF);
    const base = {
      siteName: SITE_NAMES[siteIndex],
      siteOcn: pick(ocns),
      cmsTicketNo: `${int(150000, 159999)}${pick(CMS_PREFIXES)}${pad(int(1000000, 9999999), 7)}`,
      receivedAt,
      pre: rng() < 0.28,
      createdBy,
    };

    if (isOpen) {
      // Half untouched (0h), half with a little partial time logged.
      const partial = rng() < 0.5 ? 0 : Math.round((0.05 + rng() * 0.85) * 100) / 100;
      rows.push({
        ...base,
        status: "Open",
        closedBy: null,
        durationHours: partial,
        cmsClosedOn: null,
        serviceClosedDate: null,
      });
      continue;
    }

    const durationHours = Math.round((0.1 + Math.pow(rng(), 1.5) * 2.9) * 100) / 100;
    let serviceClosedDate =
      receivedAt + Math.round(durationHours * 3_600_000) + int(0, 25) * 60_000;
    let cmsClosedOn = serviceClosedDate + int(5, 150) * 60_000;
    let received = receivedAt;
    // Nothing can be closed in the future: slide the whole ticket earlier.
    if (cmsClosedOn > ANCHOR) {
      const shift = cmsClosedOn - ANCHOR + int(1, 120) * 60_000;
      received -= shift;
      serviceClosedDate -= shift;
      cmsClosedOn -= shift;
    }
    rows.push({
      ...base,
      receivedAt: received,
      status: "Closed",
      closedBy: rng() < 0.7 ? createdBy : pick(STAFF),
      durationHours,
      cmsClosedOn,
      serviceClosedDate,
    });
  }

  // Default order: newest ticket first.
  rows.sort((a, b) => b.receivedAt - a.receivedAt);
  return rows.map((row, i) => ({ ...row, id: `T${pad(i + 1, 4)}` }));
}

export const MOCK_TICKETS: AmsTicket[] = generate();
