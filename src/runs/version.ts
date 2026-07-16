import { createHash } from "node:crypto";

import skillLock from "@/skills/skills.lock.json";

export const SKILL_BUNDLE_VERSION = createHash("sha256")
  .update(JSON.stringify(skillLock))
  .digest("hex");
