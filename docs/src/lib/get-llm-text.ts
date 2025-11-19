import fs from "node:fs/promises";
import type { InferPageType } from "fumadocs-core/source";
import { remarkInclude } from "fumadocs-mdx/config";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import type { source } from "./source";

const processor = remark()
	.use(remarkMdx)
	// needed for Fumadocs MDX
	.use(remarkInclude)
	.use(remarkGfm);

export async function getLLMText(page: InferPageType<typeof source>) {
	try {
		const processed = await processor.process({
			path: page.absolutePath,
			value: await fs.readFile(page.absolutePath),
		});

		// note: it doesn't escape frontmatter, it's up to you.
		return `# ${page.data.title}
URL: ${page.url}

${processed.value}`;
	} catch (error) {
		console.error(`Error processing page: ${page.absolutePath}`, error);
		throw error;
	}
}
