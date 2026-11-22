import type { DateTime } from "luxon";

export function repeatedTimeOffset(time: DateTime) {
  return time.getPossibleOffsets().length > 1 ? `UTC${time.toFormat("ZZ")}` : undefined;
}
