import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useDebounce } from "@/lib/utils/use-debounce";
import type { AlgoliaOptions } from "./algolia";
import type { SortedResult } from "./shared";

export interface CustomSearchOptions extends AlgoliaOptions {
	type: "custom-algolia";
	// Add any additional custom options here
	delay?: number;
}

export interface UseSearchResult {
	search: string;
	setSearch: (value: string) => void;
	query: {
		data: SortedResult[] | "empty";
		isLoading: boolean;
		error: Error | null;
	};
}

export function useCustomDocsSearch(
	options: CustomSearchOptions,
): UseSearchResult {
	const [search, setSearch] = useState("");
	const debouncedValue = useDebounce(search, options.delay ?? 100);

	const query = useQuery({
		queryKey: [
			"custom-search",
			debouncedValue,
			options.indexName,
			options.locale,
			options.tag,
		],
		queryFn: async (): Promise<SortedResult[] | "empty"> => {
			// Dynamic import to avoid including in SSR bundle
			const { searchDocs } = await import("./algolia");
			const results = await searchDocs(debouncedValue, options);

			return results.length === 0 ? "empty" : results;
		},
		enabled: debouncedValue.length > 0,
		staleTime: 1000 * 60 * 5, // 5 minutes
		gcTime: 1000 * 60 * 10, // 10 minutes
	});

	return {
		search,
		setSearch,
		query: {
			data: query.data ?? "empty",
			isLoading: query.isLoading || query.isFetching,
			error: query.error,
		},
	};
}
