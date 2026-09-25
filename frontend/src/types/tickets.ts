// Shape of an AMS ticket row, as the table renders it. API rows are mapped
// onto it in src/lib/tickets-api.ts (toAmsTicket).

export type TicketStatus = "Open" | "Closed";

export type AmsTicket = {
  id: string;
  siteName: string;
  siteOcn: string;
  cmsTicketNo: string;
  /** All timestamps are epoch milliseconds. */
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
