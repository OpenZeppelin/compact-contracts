import type { LiteClient } from "algoliasearch/lite";
import type { HighlightedText, SortedResult } from "./shared";

export interface AlgoliaOptions {
	indexName: string;
	client: LiteClient;
	tag?: string;
	locale?: string;
	// Add your custom options here
	customFilters?: string[];
	customRankingCriteria?: string[];
	enablePersonalization?: boolean;
}

export interface AlgoliaSearchHit {
	objectID?: string;
	url: string;
	title: string;
	description?: string;
	content?: string;
	structured?: {
		heading_1?: string;
		heading_2?: string;
		heading_3?: string;
		content?: string;
	};
	tag?: string;
	locale?: string;
	section_id?: string;
	_highlightResult?: {
		title?: { value: string };
		content?: { value: string };
		structured?: {
			content?: { value: string };
		};
	};
}

function parseAlgoliaHighlights(highlightedText: string): HighlightedText[] {
	// Algolia uses <em> tags for highlights
	const parts = highlightedText.split(/(<em>.*?<\/em>)/);
	const result: HighlightedText[] = [];

	for (const part of parts) {
		if (!part) continue;

		if (part.startsWith("<em>") && part.endsWith("</em>")) {
			const content = part.replace(/<\/?em>/g, "");
			if (content) {
				result.push({
					type: "text",
					content,
					styles: { highlight: true },
				});
			}
		} else if (part) {
			result.push({
				type: "text",
				content: part,
			});
		}
	}

	return result.length > 0
		? result
		: [{ type: "text", content: highlightedText }];
}

function groupResults(
	results: AlgoliaSearchHit[],
	query: string,
): SortedResult[] {
	const grouped: SortedResult[] = [];
	const scannedUrls = new Set<string>();
	const { createContentHighlighter } = require("./shared");
	const highlighter = createContentHighlighter(query);

	for (const hit of results) {
		const url = hit.url;
		const title = hit.title;
		const content =
			hit.content ?? hit.structured?.content ?? hit.description ?? "";

		// Extract additional metadata
		const urlParts = url.split("/");
		const filename = urlParts[urlParts.length - 1] || title;
		const section =
			urlParts.length > 2 ? urlParts[urlParts.length - 2] : undefined;

		// Get highlighted content if available
		const highlightedContent =
			hit._highlightResult?.content?.value ??
			hit._highlightResult?.structured?.content?.value;

		const contentWithHighlights = highlightedContent
			? parseAlgoliaHighlights(highlightedContent)
			: highlighter.highlight(content);

		// Add page-level result (only once per URL like fumadocs)
		if (!scannedUrls.has(url)) {
			scannedUrls.add(url);

			grouped.push({
				id: url,
				type: "page",
				url,
				content: title,
				// Add our custom fields
				title,
				filename,
				section,
				preview:
					content && content.length > 150
						? `${content.substring(0, 147)}...`
						: content,
			} as SortedResult & {
				title?: string;
				filename?: string;
				section?: string;
				preview?: string;
				contentWithHighlights?: HighlightedText[];
			});
		}

		// Add content-level result (like fumadocs)
		const sectionId = hit.section_id || hit.objectID;
		const contentUrl = sectionId ? `${url}#${sectionId}` : url;

		grouped.push({
			id: hit.objectID || `${url}#${Date.now()}-${Math.random()}`,
			type: content === title ? "heading" : "text",
			url: contentUrl,
			content,
			contentWithHighlights,
			// Add our custom fields
			title,
			filename,
			section,
			preview:
				content && content.length > 150
					? `${content.substring(0, 147)}...`
					: content,
		} as SortedResult & {
			title?: string;
			filename?: string;
			section?: string;
			preview?: string;
			contentWithHighlights?: HighlightedText[];
		});
	}

	return grouped;
}

export async function searchDocs(
	query: string,
	options: AlgoliaOptions,
): Promise<SortedResult[]> {
	if (query.length === 0) return [];

	// Build search parameters with customizations
	const searchParams: Record<string, unknown> = {
		attributesToRetrieve: [
			"title",
			"description",
			"content",
			"url",
			"structured",
			"tag",
			"locale",
		],
		attributesToHighlight: ["title", "content", "structured.content"],
		hitsPerPage: 20, // Increase to get more results before distinct filtering
		distinct: 1, // Limit to 1 result per distinct attribute
	};

	// Add tag filter if specified
	const filters: string[] = [];
	if (options.tag) {
		filters.push(`tag:"${options.tag}"`);
	}

	// Add locale filter if specified
	if (options.locale) {
		filters.push(`locale:"${options.locale}"`);
	}

	// Add custom filters
	if (options.customFilters && options.customFilters.length > 0) {
		filters.push(...options.customFilters);
	}

	if (filters.length > 0) {
		searchParams.filters = filters.join(" AND ");
	}

	// Add custom ranking criteria
	if (
		options.customRankingCriteria &&
		options.customRankingCriteria.length > 0
	) {
		searchParams.customRanking = options.customRankingCriteria;
	}

	// Enable personalization if specified
	if (options.enablePersonalization) {
		searchParams.enablePersonalization = true;
	}

	try {
		const response = await options.client.search({
			requests: [
				{
					indexName: options.indexName,
					query,
					...searchParams,
				},
			],
		});
		const searchResult = response.results[0];
		if ("hits" in searchResult) {
			return groupResults(searchResult.hits as AlgoliaSearchHit[], query);
		}
		return [];
	} catch (error) {
		console.error("Algolia search error:", error);
		return [];
	}
}
