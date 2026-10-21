/* The content list's type filter. A closed set of values, so the api module
 * and the screen agree without either importing the other's module. */
import type { ContentType } from "@maleo/shared";

export type ContentTypeFilter = "all" | ContentType;
