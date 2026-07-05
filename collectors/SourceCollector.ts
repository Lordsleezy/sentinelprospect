import { BaseCollector } from "./BaseCollector";
import { normalizePlanningRecord } from "./normalize";
import type { CollectorConfig, RawSourceRecord } from "./types";

export class SourceCollector extends BaseCollector {
  readonly sourceName: string;
  readonly sourceType: string;
  readonly baseUrl: string;
  readonly jurisdiction: string;
  readonly enabled: boolean;
  readonly notes: string;

  constructor(config: CollectorConfig) {
    super();
    this.sourceName = config.sourceName;
    this.sourceType = config.sourceType;
    this.baseUrl = config.baseUrl;
    this.jurisdiction = config.jurisdiction;
    this.enabled = config.enabled;
    this.notes = config.notes;
  }

  async collect(): Promise<RawSourceRecord[]> {
    // Real adapters should replace this with source-specific API, feed, HTML, or PDF extraction.
    return [];
  }

  normalize(record: RawSourceRecord) {
    return normalizePlanningRecord(record);
  }
}
