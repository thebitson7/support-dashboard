// Shape of an AMS ticket row. The mock generator (src/lib/mock-tickets.ts)
// returns these today; a real API response should be mapped onto the same
// type so the table never changes.

export type TicketStatus = "Open" | "Closed";

export type AmsTicket = {
  id: string;
  siteName: string;
  siteOcn: string;
  cmsTicketNo: string;
  /** All timestamps are epoch milliseconds (UTC). */
  receivedAt: number;
  status: TicketStatus;
  /** Boolean flag shown as a checkbox. */
  pre: boolean;
  /** null while the ticket is Open. */
  closedBy: string | null;
  createdBy: string;
  /** Hours, at most 2 decimals. */
  durationHours: number;
  /** null while the ticket is Open. */
  cmsClosedOn: number | null;
  /** null while the ticket is Open. */
  serviceClosedDate: number | null;
};
