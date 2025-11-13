"use client";
import { liteClient } from "algoliasearch/lite";
import {
	SearchDialog,
	SearchDialogClose,
	SearchDialogContent,
	SearchDialogFooter,
	SearchDialogHeader,
	SearchDialogIcon,
	SearchDialogInput,
	SearchDialogList,
	SearchDialogOverlay,
	type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { useI18n } from "fumadocs-ui/contexts/i18n";
import { useRouter } from "next/navigation";
import { CustomSearchResultItem } from "@/components/custom-search-result";
import { useCustomDocsSearch } from "@/lib/search/client";

const appId = `${process.env.NEXT_PUBLIC_ALGOLIA_ID}`;
const apiKey = `${process.env.NEXT_PUBLIC_ALGOLIA_KEY}`;
const client = liteClient(appId, apiKey);

export default function CustomSearchDialog(props: SharedProps) {
	const { locale } = useI18n(); // (optional) for i18n
	const router = useRouter();

	// Now using your custom search implementation with customization options
	const { search, setSearch, query } = useCustomDocsSearch({
		type: "custom-algolia",
		client,
		indexName: "document",
		locale,
		// Add your custom options here:
		customFilters: [
			// Example: Filter by content type
			// 'type:"documentation"',
			// 'published:true'
		],
		customRankingCriteria: [
			// Example: Custom ranking criteria
			// 'desc(popularity)',
			// 'asc(difficulty_level)'
		],
		enablePersonalization: false, // Set to true if you want personalized results
		delay: 150, // Custom debounce delay
	});

	return (
		<SearchDialog
			search={search}
			onSearchChange={setSearch}
			isLoading={query.isLoading}
			{...props}
		>
			<SearchDialogOverlay />
			<SearchDialogContent>
				<SearchDialogHeader>
					<SearchDialogIcon />
					<SearchDialogInput />
					<SearchDialogClose />
				</SearchDialogHeader>
				<SearchDialogList
					items={query.data !== "empty" ? query.data : null}
					Item={({ item, onClick }) => (
						<CustomSearchResultItem
							result={item}
							query={search}
							onSelect={() => {
								onClick();
								router.push(item.url);
								// Close the dialog after selection
								if (props.onOpenChange) {
									props.onOpenChange(false);
								}
							}}
						/>
					)}
				/>
				<SearchDialogFooter>
					<a
						href="https://algolia.com"
						rel="noreferrer noopener"
						className="ms-auto text-xs text-fd-muted-foreground"
					>
						Search powered by Algolia
					</a>
				</SearchDialogFooter>
			</SearchDialogContent>
		</SearchDialog>
	);
}
