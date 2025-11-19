import {
	type FileObject,
	printErrors,
	scanURLs,
	validateFiles,
} from "next-validate-link";
import type { InferPageType } from "fumadocs-core/source";
import { source } from "@/lib/source";
import { writeFileSync } from "fs";
import {
	arbitrumStylusTree,
	ethereumEvmTree,
	impactTree,
	midnightTree,
	polkadotTree,
	starknetTree,
	stellarTree,
	uniswapTree,
	zamaTree,
	type NavigationNode,
	type NavigationPage,
	type NavigationFolder,
} from "@/navigation";

async function checkLinks() {
	// Parse command line arguments
	const outputFile = process.argv.includes("--output")
		? process.argv[process.argv.indexOf("--output") + 1]
		: null;

	const scope = process.argv.includes("--scope")
		? process.argv[process.argv.indexOf("--scope") + 1]
		: null;

	const ignoreFragments = !process.argv.includes("--no-ignore-fragments");

	const pages = await Promise.all(
		source.getPages().map(async (page) => {
			return {
				value: {
					slug: page.slugs,
				},
				hashes: await getHeadings(page),
			};
		}),
	);

	const scanned = await scanURLs({
		// pick a preset for your React framework
		preset: "next",
		populate: {
			"(docs)/[...slug]": pages,
		},
	});

	const validationResults = await validateFiles(await getFiles(scope), {
		scanned,
		// check `href` attributes in different MDX components
		markdown: {
			components: {
				Card: { attributes: ["href"] },
			},
		},
		ignoreFragment: ignoreFragments,
		// check relative paths
		checkRelativePaths: "as-url",
	});

	// Validate navigation URLs if requested
	let navigationErrors: Array<{ tree: string; url: string; reason: string }> =
		[];
	navigationErrors = await validateNavigationUrls(scanned);

	if (outputFile) {
		// Generate custom output format for file
		let output = "";
		let totalErrors = 0;
		let totalFiles = 0;

		for (const result of validationResults) {
			totalFiles++;
			if (result.errors.length > 0) {
				output += `Invalid URLs in ${result.file}:\n`;
				for (const error of result.errors) {
					totalErrors++;
					output += `${error.url}: ${error.reason} at line ${error.line} column ${error.column}\n`;
				}
				output += "------\n";
			}
		}

		// Add navigation errors to output
		if (navigationErrors.length > 0) {
			output += `\nInvalid URLs in Navigation Trees:\n`;
			for (const error of navigationErrors) {
				totalErrors++;
				output += `${error.tree}: ${error.url} - ${error.reason}\n`;
			}
			output += "------\n";
		}

		output += `\nSummary: ${totalErrors} errors found in ${validationResults.filter((r) => r.errors.length > 0).length} files out of ${totalFiles} total files`;
		if (navigationErrors.length > 0) {
			output += ` + ${navigationErrors.length} navigation errors`;
		}
		output += `\n`;

		writeFileSync(outputFile, output);
		console.log(`Results saved to ${outputFile}`);
		console.log(
			`${totalErrors} errors found in ${validationResults.filter((r) => r.errors.length > 0).length} files`,
		);
		if (navigationErrors.length > 0) {
			console.log(`${navigationErrors.length} navigation errors found`);
		}
	} else {
		// Use default printErrors for console output
		printErrors(validationResults, true);

		// Print navigation errors
		if (navigationErrors.length > 0) {
			console.log("\n❌ Navigation URL Errors:");
			for (const error of navigationErrors) {
				console.log(`  ${error.tree}: ${error.url} - ${error.reason}`);
			}
		}
	}
}

async function getHeadings({
	data,
}: InferPageType<typeof source>): Promise<string[]> {
	const pageData = await data.load();
	const tocHeadings = pageData.toc.map((item) => item.url.slice(1));

	// Also extract actual anchor IDs from the content for API reference pages
	const content = await data.getText("raw");
	const anchorRegex = /<a id="([^"]+)"><\/a>/g;
	const anchorIds: string[] = [];
	let match: any;

	while ((match = anchorRegex.exec(content)) !== null) {
		anchorIds.push(match[1]);
	}

	// Combine TOC headings and actual anchor IDs, removing duplicates
	const allHeadings = [...new Set([...tocHeadings, ...anchorIds])];

	return allHeadings;
}

function getFiles(scope?: string | null) {
	let pages = source.getPages();

	// Filter pages based on scope if provided
	if (scope) {
		pages = pages.filter((page) => {
			// Convert scope pattern to regex
			// /contracts/* becomes ^/contracts/.*
			// contracts/* becomes ^.*contracts/.*
			const pattern = scope
				.replace(/\*/g, ".*")
				.replace(/^\//, "^/")
				.replace(/^(?!\^)/, "^.*");

			const regex = new RegExp(pattern);
			return regex.test(page.url) || regex.test(page.absolutePath);
		});
	}

	const promises = pages.map(
		async (page): Promise<FileObject> => ({
			path: page.absolutePath,
			content: await page.data.getText("raw"),
			url: page.url,
			data: page.data,
		}),
	);

	return Promise.all(promises);
}

function extractUrlsFromNavigation(
	nodes: NavigationNode[],
	urls: string[] = [],
): string[] {
	for (const node of nodes) {
		if (node.type === "page") {
			const page = node as NavigationPage;
			// Only validate internal URLs (not external links)
			if (!page.external && page.url) {
				urls.push(page.url);
			}
		} else if (node.type === "folder") {
			const folder = node as NavigationFolder;
			if (folder.index && !folder.index.external) {
				urls.push(folder.index.url);
			}
			if (folder.children) {
				extractUrlsFromNavigation(folder.children, urls);
			}
		}
	}
	return urls;
}

async function validateNavigationUrls(
	scanned: Awaited<ReturnType<typeof scanURLs>>,
): Promise<Array<{ tree: string; url: string; reason: string }>> {
	const navigationTrees = {
		"Ethereum & EVM": ethereumEvmTree,
		"Arbitrum Stylus": arbitrumStylusTree,
		Stellar: stellarTree,
		Midnight: midnightTree,
		Starknet: starknetTree,
		"Zama FHEVM": zamaTree,
		"Uniswap Hooks": uniswapTree,
		Polkadot: polkadotTree,
		"OpenZeppelin Impact": impactTree,
	};

	const errors: Array<{ tree: string; url: string; reason: string }> = [];

	for (const [treeName, tree] of Object.entries(navigationTrees)) {
		const urls = extractUrlsFromNavigation(tree.children);

		for (const url of urls) {
			// Split URL into path and fragment
			const [urlPath, fragment] = url.split("#");

			// Check if the URL path exists in the scanned pages
			// scanned.urls is a Map<string, UrlMeta>
			const found = scanned.urls.has(urlPath);

			if (!found) {
				// Check fallback URLs (dynamic routes)
				const foundInFallback = scanned.fallbackUrls.some((fallback) =>
					fallback.url.test(urlPath),
				);

				if (!foundInFallback) {
					errors.push({
						tree: treeName,
						url,
						reason: "URL not found in site pages",
					});
				}
			} else if (fragment) {
				// If URL has a fragment, validate that the fragment exists on the page
				const urlMeta = scanned.urls.get(urlPath);
				if (urlMeta?.hashes && !urlMeta.hashes.includes(fragment)) {
					errors.push({
						tree: treeName,
						url,
						reason: `Fragment '#${fragment}' not found on page`,
					});
				}
			}
		}
	}

	return errors;
}

void checkLinks();
