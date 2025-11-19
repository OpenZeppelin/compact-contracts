import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import remarkReplace from "@/lib/remark-replace";
import { CAIRO_REPLACEMENTS as cairoContractReplacements } from "content/contracts-cairo/cairo-replacements";
import { REPLACEMENTS as compactContractReplacements } from "content/contracts-compact/utils/replacements";

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.vercel.app/docs/mdx/collections#define-docs
export const docs = defineDocs({
	dir: "content",
	// Async mode - enables runtime compilation for faster dev server startup
	docs: {
		async: true,
	},
	// To switch back to sync mode (pre-compilation), comment out the docs config above and uncomment below:
	// (sync mode - pre-compiles all content at build time)
	// No additional config needed for sync mode - just remove the docs config
});

export default defineConfig({
	mdxOptions: {
		rehypeCodeOptions: {
			fallbackLanguage: "plaintext",
			themes: {
				light: "github-light",
				dark: "github-dark",
			},
		},
		remarkPlugins: [
			remarkMath,
			remarkMdxMermaid,
			[
				remarkReplace,
				[...cairoContractReplacements, compactContractReplacements],
			],
		],
		rehypePlugins: (v) => [rehypeKatex, ...v],
	},
});
