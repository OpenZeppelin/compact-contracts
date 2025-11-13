#!/usr/bin/env node

const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { glob } = require("glob");

async function convertAdocFiles(directory, apiRoute = "contracts/5.x/api") {
	if (!directory) {
		console.error("Usage: node convert-adoc.js <directory> [apiRoute]");
		process.exit(1);
	}

	const adocFiles = await glob(`${directory}/**/*.adoc`);

	for (const adocFile of adocFiles) {
		console.log(`Processing: ${adocFile}`);

		const dir = path.dirname(adocFile);
		const filename = path.basename(adocFile, ".adoc");
		const mdxFile = path.join(dir, `${filename}.mdx`);

		try {
			// Read original file
			let content = await fs.readFile(adocFile, "utf8");

			// Replace code blocks with includes
			content = content.replace(
				/```solidity\s*\ninclude::api:example\$([^[\]]+)\[\]\s*\n```/g,
				"<include cwd lang='solidity'>./examples/$1</include>",
			);

			content = content.replace(
				/\[source,solidity\]\s*\n----\s*\ninclude::api:example\$([^[\]]+)\[\]\s*\n----/g,
				"<include cwd lang='solidity'>./examples/$1</include>",
			);

			// Replace TIP: and NOTE: callouts with <Callout> tags
			content = content.replace(
				/^(TIP|NOTE):\s*(.+)$/gm,
				"<Callout>\n$2\n</Callout>",
			);

			content = content.replace(
				/^(IMPORTANT|WARNING|CAUTION):\s*(.+)$/gm,
				"<Callout type='warn'>\n$2\n</Callout>",
			);

			// Handle multi-line callouts
			content = content.replace(
				/^(TIP|NOTE):\s*\n((?:.*\n?)*?)(?=\n\n|$)/gm,
				"<Callout>\n$2\n</Callout>",
			);

			content = content.replace(
				/^(IMPORTANT|WARNING|CAUTION):\s*\n((?:.*\n?)*?)(?=\n\n|$)/gm,
				"<Callout type='warn'>\n$2\n</Callout>",
			);
			// Write preprocessed content
			const tempFile = path.join(dir, `temp_${filename}.adoc`);
			await fs.writeFile(tempFile, content, "utf8");

			// Run downdoc
			execSync(`pnpm dlx downdoc "${tempFile}"`, { stdio: "pipe" });

			// Find the generated .md file
			const tempMdFile = path.join(dir, `temp_${filename}.md`);
			let mdContent = await fs.readFile(tempMdFile, "utf8");

			// Fix HTML entities globally
			mdContent = mdContent
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#x27;/g, "'")
				.replace(/&#x2F;/g, "/")
				.replace(/&amp;/g, "&"); // This should be last to avoid double-decoding

			// Convert api: links to dynamic api route and change .adoc to .mdx
			mdContent = mdContent.replace(
				/\(api:([^)]+)\.adoc([^)]*)\)/g,
				`(/${apiRoute}/$1$2)`,
			);

			// Add forward slash to image paths
			mdContent = mdContent.replace(
				/!\[([^\]]*)\]\(([^/)][^)]*\.(png|jpg|jpeg|gif|svg|webp))\)/g,
				"![$1](/$2)",
			);

			// Fix xref: links - remove xref: and convert .adoc to .mdx
			mdContent = mdContent.replace(
				/xref:\[([^\]]+)\]\(([^)]+)\)/g,
				"[$1]($2)",
			);

			// Fix .adoc internal links to .mdx
			mdContent = mdContent.replace(/\]\(([^)]+)\.adoc([^)]*)\)/g, "]($1$2)");

			// Fix curly bracket file references {filename} -> filename, but preserve braces in code blocks
			const parts = mdContent.split(/(```[\s\S]*?```)/g);
			mdContent = parts
				.map((part, index) => {
					// Every odd index is a code block (```...```)
					if (index % 2 === 1) {
						return part; // Preserve code blocks as-is
					} else {
						// Remove curly brackets from non-code-block parts only
						return part.replace(/\{([^}]+)\}/g, "$1");
					}
				})
				.join("");

			// Fix HTML-style callouts <dl><dt><strong>📌 NOTE</strong></dt><dd> ... </dd></dl>
			// Handle multi-line callouts by using a more permissive pattern
			mdContent = mdContent.replace(
				/<dl><dt><strong>[📌🔔ℹ️]\s*(NOTE|TIP|INFO)<\/strong><\/dt><dd>([\s\S]*?)<\/dd><\/dl>/gu,
				"<Callout>\n$2\n</Callout>",
			);

			mdContent = mdContent.replace(
				/<dl><dt><strong>[⚠️🚨❗]\s*(WARNING|IMPORTANT|CAUTION|DANGER)<\/strong><\/dt><dd>([\s\S]*?)<\/dd><\/dl>/g,
				"<Callout type='warn'>\n$2\n</Callout>",
			);

			// Handle cases where </dd></dl> might be missing or malformed
			mdContent = mdContent.replace(
				/<dl><dt><strong>[📌🔔ℹ️]\s*(NOTE|TIP|INFO)<\/strong><\/dt><dd>([\s\S]*?)(?=\n\n|<dl>|$)/gu,
				"<Callout>\n$2\n</Callout>",
			);

			mdContent = mdContent.replace(
				/<dl><dt><strong>[⚠️🚨❗]\s*(WARNING|IMPORTANT|CAUTION|DANGER)<\/strong><\/dt><dd>([\s\S]*?)(?=\n\n|<dl>|$)/g,
				"<Callout type='warn'>\n$2\n</Callout>",
			);

			// Fix xref patterns with complex anchors like xref:#ISRC6-\\__execute__[...]
			mdContent = mdContent.replace(
				/xref:#([^[\]]+)\[([^\]]+)\]/g,
				"[$2](#$1)",
			);

			// Fix simple xref patterns
			mdContent = mdContent.replace(/xref:([^[\s]+)\[([^\]]+)\]/g, "[$2]($1)");

			// Clean up orphaned HTML tags from malformed callouts
			// Handle orphaned <dl><dt><strong>EMOJI TYPE</strong></dt><dd> without closing tags
			mdContent = mdContent.replace(
				/<dl><dt><strong>[📌🔔ℹ️]\s*(NOTE|TIP|INFO)<\/strong><\/dt><dd>\s*\n([\s\S]*?)(?=\n\n|<dl>|$)/gu,
				"<Callout>\n$2\n</Callout>",
			);

			mdContent = mdContent.replace(
				/<dl><dt><strong>[⚠️🚨❗]\s*(WARNING|IMPORTANT|CAUTION|DANGER)<\/strong><\/dt><dd>\s*\n([\s\S]*?)(?=\n\n|<dl>|$)/g,
				"<Callout type='warn'>\n$2\n</Callout>",
			);

			// Clean up any remaining orphaned HTML tags
			mdContent = mdContent.replace(
				/<dl><dt><strong>.*?<\/strong><\/dt><dd>/g,
				"",
			);
			mdContent = mdContent.replace(/<\/dd><\/dl>/g, "");
			mdContent = mdContent.replace(/<dd>/g, "");
			mdContent = mdContent.replace(/<\/dd>/g, "");
			mdContent = mdContent.replace(/<dl>/g, "");
			mdContent = mdContent.replace(/<\/dl>/g, "");

			// Fix AsciiDoc monospace formatting (++ to backticks)
			// Handle ++text++ -> `text`
			mdContent = mdContent.replace(/\+\+([^+]+)\+\+/g, "`$1`");

			// Fix any remaining ++ that might be standalone
			mdContent = mdContent.replace(/\+\+/g, "");
			// Extract title
			const headerMatch = mdContent.match(/^#+\s+(.+)$/m);
			const title = headerMatch ? headerMatch[1].trim() : filename;

			// Remove the first H1 from content
			const contentWithoutFirstH1 = mdContent
				.replace(/^#+\s+.+$/m, "")
				.replace(/^\n+/, "");

			// Create MDX with frontmatter
			const mdxContent = `---
title: ${title}
---

${contentWithoutFirstH1}`;

			await fs.writeFile(mdxFile, mdxContent, "utf8");

			// Cleanup
			await fs.unlink(tempMdFile);
			await fs.unlink(tempFile);
			await fs.unlink(adocFile);

			console.log("  ✓ Converted successfully");
		} catch (error) {
			console.log(`  ✗ Error: ${error.message}`);
		}
	}
}

// Process files to remove curly brackets after conversion
function processFile(filePath) {
	try {
		// Only process .mdx files (skip .adoc files)
		if (!filePath.endsWith(".mdx")) {
			console.log(`Skipped: ${filePath}`);
			return;
		}

		const content = fsSync.readFileSync(filePath, "utf8");
		// Split content by code blocks and process non-code-block parts only
		const parts = content.split(/(```[\s\S]*?```)/g);
		const modifiedContent = parts
			.map((part, index) => {
				// Every odd index is a code block (```...```)
				if (index % 2 === 1) {
					return part; // Preserve code blocks as-is
				} else {
					// Remove curly brackets from non-code-block parts
					return part.replace(/[{}]/g, "");
				}
			})
			.join("");

		fsSync.writeFileSync(filePath, modifiedContent, "utf8");
		console.log(`Processed: ${filePath}`);
	} catch (error) {
		console.error(`Error processing ${filePath}: ${error.message}`);
	}
}

function crawlDirectory(dirPath) {
	try {
		const items = fsSync.readdirSync(dirPath);

		for (const item of items) {
			const itemPath = path.join(dirPath, item);
			const stats = fsSync.statSync(itemPath);

			if (stats.isDirectory()) {
				crawlDirectory(itemPath);
			} else if (stats.isFile()) {
				processFile(itemPath);
			}
		}
	} catch (error) {
		console.error(`Error crawling directory ${dirPath}: ${error.message}`);
	}
}

const directory = process.argv[2];
const apiRoute = process.argv[3];

async function main() {
	await convertAdocFiles(directory, apiRoute);
	// Run bracket processing after conversion
	crawlDirectory(directory);
}

main().catch(console.error);
