import micromatch from "micromatch";
import { visit } from "unist-util-visit";

/**
 * A replacement rule applied to MDX/Markdown files.
 *
 * - Use `include` to match files via glob(s).
 * - Or use `includeFn` for custom logic (receives the normalized file path or undefined).
 * - `replacements` maps placeholders like `{{key}}` → "value".
 * - If `exclusive` is true, the first matching rule stops further replacements for that node.
 */
export type Rule = {
	include?: string | string[];
	includeFn?: (info: { path?: string }) => boolean;
	replacements: Record<string, string>;
	exclusive?: boolean;
};

type File = { path: string; history: string[] };

/**
 * Multi-rule remark plugin to replace placeholders in text, inlineCode and code blocks.
 *
 * Placeholders are written as `{{key}}` and replaced with the corresponding string
 * from the active rule's `replacements` map.
 *
 * Safe defaults:
 * - If `file.path` is missing (virtual content), rules are considered active unless
 *   their `includeFn` explicitly returns false.
 * - Empty/whitespace patterns are ignored; if no valid patterns are left,
 *   the rule falls back to "match all".
 *
 * Example usage (Fumadocs / MDX config):
 *
 *   import { defineConfig } from "fumadocs-mdx/config";
 *   import remarkReplaceMulti, { Rule } from "@/lib/remark-replace-multi";
 *
 *   const rules: Rule[] = [
 *     { include: "content/docs/**",   replacements: { version: "3.0.0", api: "/docs/api"   }, exclusive: true },
 *     { include: "content/guides/**", replacements: { version: "2.2.0", api: "/guides/api" }, exclusive: true },
 *   ];
 *
 *   export default defineConfig({
 *     mdxOptions: {
 *       remarkPlugins: (prev) => [[remarkReplaceMulti, rules], ...prev],
 *     },
 *   });
 */
export default function remarkReplaceMulti(rules: Rule[]) {
	// --- helpers ---------------------------------------------------------------

	/** Normalize vfile path (may be missing in virtual files). */
	const getPath = (file?: File): string | undefined => {
		const raw =
			(typeof file?.path === "string" && file.path) ||
			(Array.isArray(file?.history) && file.history[0]) ||
			undefined;
		return raw ? raw.replace(/\\/g, "/") : undefined;
	};

	/** Turn include into a clean, non-empty patterns array (or ["** /*"]). */
	const toPatterns = (include?: string | string[]): string[] => {
		const arr = Array.isArray(include) ? include : include ? [include] : [];
		const cleaned = arr.map((p) => p.trim()).filter((p) => p.length > 0);
		return cleaned.length ? cleaned : ["**/*"];
	};

	/** Does this rule apply to the given file path? */
	const isRuleActive = (rule: Rule, path?: string): boolean => {
		if (rule.includeFn) return rule.includeFn({ path });
		// If we don't have a path, default to active (virtual files).
		if (!path) return true;
		return micromatch.isMatch(path, toPatterns(rule.include));
	};

	/** Replace all `{{key}}` with values from `map`. */
	const replaceAll = (input: string, map: Record<string, string>): string => {
		let out = input;
		for (const [k, v] of Object.entries(map)) {
			out = out.split(`{{${k}}}`).join(String(v));
		}
		return out;
	};

	// --- plugin ---------------------------------------------------------------

	// biome-ignore lint/suspicious/noExplicitAny: third-party type, safe here
	return (tree: any, file?: File) => {
		const path = getPath(file);

		// Collect rules that apply to this file.
		const active = rules.filter((r) => isRuleActive(r, path));
		if (active.length === 0) return;

		// Apply replacements to text & code nodes.
		visit(tree, ["text", "inlineCode", "code"], (node: { value: string }) => {
			if (typeof node.value !== "string") return;

			for (const rule of active) {
				node.value = replaceAll(node.value, rule.replacements);
				if (rule.exclusive) break; // stop after first exclusive rule
			}
		});

		// 2) Markdown links/images: replace in the URL
		visit(tree, ["link", "image", "definition"], (node: { url: string }) => {
			if (typeof node.url !== "string") return;
			for (const rule of active) {
				node.url = replaceAll(node.url, rule.replacements);
				if (rule.exclusive) break;
			}
		});
	};
}
