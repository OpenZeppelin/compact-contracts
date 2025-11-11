# Custom Algolia Search Implementation

This directory contains a custom implementation of Algolia search for Fumadocs, giving you full control over search behavior and customization options.

## Files

- `algolia.ts` - Core Algolia search implementation with custom options
- `client.ts` - React hook for using the custom search functionality

## Features

### Custom Filtering
Add custom filters to your search queries:

```typescript
const { search, setSearch, query } = useCustomDocsSearch({
  type: "custom-algolia",
  client,
  indexName: "document",
  locale,
  customFilters: [
    'type:"documentation"',    // Filter by content type
    'published:true',          // Only show published content
    'difficulty:"beginner"',   // Filter by difficulty level
  ],
});
```

### Custom Ranking
Define custom ranking criteria for search results:

```typescript
const { search, setSearch, query } = useCustomDocsSearch({
  type: "custom-algolia",
  client,
  indexName: "document",
  customRankingCriteria: [
    'desc(popularity)',        // Prioritize popular content
    'asc(difficulty_level)',   // Show easier content first
    'desc(updated_at)',        // Show recently updated content
  ],
});
```

### Personalization
Enable Algolia's personalization features:

```typescript
const { search, setSearch, query } = useCustomDocsSearch({
  type: "custom-algolia",
  client,
  indexName: "document",
  enablePersonalization: true,
});
```

## Extending the Implementation

### Adding New Search Parameters

To add new search parameters, extend the `AlgoliaOptions` interface in `algolia.ts`:

```typescript
export interface AlgoliaOptions {
  // ... existing options
  maxResults?: number;
  searchableAttributes?: string[];
  facetFilters?: string[][];
}
```

Then update the `searchDocs` function to use these new parameters:

```typescript
export async function searchDocs(
  query: string,
  options: AlgoliaOptions,
): Promise<SortedResult[]> {
  // ... existing code
  
  if (options.maxResults) {
    searchParams.hitsPerPage = options.maxResults;
  }
  
  if (options.searchableAttributes) {
    searchParams.searchableAttributes = options.searchableAttributes;
  }
  
  // ... rest of implementation
}
```

### Custom Result Processing

You can customize how search results are processed by modifying the `groupResults` function:

```typescript
function groupResults(results: AlgoliaSearchHit[]): SortedResult[] {
  const map = new Map<string, SortedResult>();

  for (const item of results) {
    // Add your custom processing logic here
    const customScore = calculateCustomScore(item);
    
    // ... existing processing
  }

  return Array.from(map.values())
    .sort((a, b) => b.customScore - a.customScore); // Custom sorting
}
```

## Example Usage

Here's a complete example of how to use the custom search with various options:

```typescript
import { useCustomDocsSearch } from "@/lib/search/client";

function MySearchComponent() {
  const { search, setSearch, query } = useCustomDocsSearch({
    type: "custom-algolia",
    client: algoliaClient,
    indexName: "documents",
    locale: "en",
    tag: "v5.x",
    customFilters: [
      'category:"smart-contracts"',
      'published:true',
    ],
    customRankingCriteria: [
      'desc(views)',
      'desc(last_updated)',
    ],
    enablePersonalization: true,
    delay: 200,
  });

  return (
    <SearchDialog
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
    >
      {/* Your search UI components */}
    </SearchDialog>
  );
}
```

## Advanced Customizations

For more advanced customizations, you can:

1. **Add search analytics** - Track search queries and results
2. **Implement search suggestions** - Show suggested queries as users type
3. **Add faceted search** - Allow filtering by categories, tags, etc.
4. **Customize highlighting** - Control how search terms are highlighted
5. **Add search shortcuts** - Implement keyboard shortcuts for search

See the Algolia documentation for more advanced features and customization options.