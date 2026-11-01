import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { TaskLifecycleRecord } from "../services/task-lifecycle-logging.js";

export interface ActivityPublication {
  companyId: string;
  payload: Record<string, unknown>;
  pluginEvent: PluginEvent | null;
  lifecycleRecord?: TaskLifecycleRecord | Record<string, unknown> | null;
}
