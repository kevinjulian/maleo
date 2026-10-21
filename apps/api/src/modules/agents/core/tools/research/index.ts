/* research domain — web search + page fetch + bounded research pass. */
import type { AnyToolDef } from "../../types.ts";
import { searchWeb } from "./search-web.ts";
import { readWebPage } from "./read-web-page.ts";
import { researchTopic } from "./research-topic.ts";

export const researchTools: AnyToolDef[] = [searchWeb, readWebPage, researchTopic];
