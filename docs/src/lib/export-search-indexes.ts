import type { DocumentRecord } from "fumadocs-core/search/algolia";
import { source } from "@/lib/source";

export async function exportSearchIndexes() {
	const results: DocumentRecord[] = [];

	// Define version paths to exclude (keeping only latest versions)
	const excludedVersions = [
		"/3.x/",
		"/4.x/",
		"/1.0.0/",
		"/0.1.0/",
		"/0.2.0/",
		"/2.0.0/",
		"/1.0.0/",
	];

	const filteredPages = source
		.getPages()
		.filter(
			(page) =>
				!excludedVersions.some((excluded) => page.url.includes(excluded)),
		);

	for (const page of filteredPages) {
		const data = await page.data.load();
		results.push({
			_id: page.url,
			structured: data.structuredData,
			url: page.url,
			title: page.data.title,
			description: page.data.description,
			extra_data: data.body,
		});
	}

	return results;
}
