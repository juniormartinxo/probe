import type { Cli } from "../generation-request.ts";
import { agy } from "./agy.ts";
import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { grok } from "./grok.ts";
import type { Provider } from "./provider.ts";

// Uma invocação predefinida por CLI, com o nome que o Cloak registra para ela.
export const providers: Record<Cli, Provider> = { claude, codex, grok, agy };
