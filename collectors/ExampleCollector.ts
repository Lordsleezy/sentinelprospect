import { BaseCollector } from "./BaseCollector";
import { normalizePlanningRecord } from "./normalize";
import type { RawSourceRecord } from "./types";

export class ExampleCollector extends BaseCollector {
  readonly sourceName = "Disabled Example Planning Feed";
  readonly sourceType = "Planning Portal";
  readonly baseUrl = "";

  async collect(): Promise<RawSourceRecord[]> {
    return [];
  }

  normalize(record: RawSourceRecord) {
    return normalizePlanningRecord(record);
  }
}
