import { ruleHandlers } from "./handlers/rules-handlers.js";
import { sessionHandlers } from "./handlers/session-handlers.js";
import { type HandlerContext } from "./handlers/shared.js";
import { systemHandlers } from "./handlers/system-handlers.js";
import { updaterHandlers } from "./handlers/updater-handlers.js";

export type { HandlerContext };

export const handlers = {
  ...sessionHandlers,
  ...ruleHandlers,
  ...systemHandlers,
  ...updaterHandlers
} as const;

