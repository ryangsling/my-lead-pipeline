export type VapiEraseTarget = {
  callId: string;
  assistantIds: string[];
  verifiedCredential?: string;
};

export type GoogleEraseTarget = {
  appointmentId: string;
  eventId: string;
  calendarId: string;
  periods: { start: string; end: string }[];
};
