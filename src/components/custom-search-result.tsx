"use client";
import { type ComponentProps, Fragment, type ReactNode } from "react";
import type { HighlightedText } from "@/lib/search/shared";
import { cn } from "@/lib/utils";

// Import the actual fumadocs type (content is ReactNode, not string)
type FumadocsReactSortedResult = {
	id: string;
	type: "page" | "heading" | "text";
	url: string;
	content: ReactNode;
	contentWithHighlights?: HighlightedText[];
	external?: boolean;
};

// Our result interface for internal use
export interface CustomSearchResult {
	id: string;
	type: "page" | "heading" | "text";
	url: string;
	content: string;
	contentWithHighlights?: HighlightedText[];
	external?: boolean;
	title?: string;
	preview?: string;
	section?: string;
	filename?: string;
}

export type { FumadocsReactSortedResult as ReactSortedResult };

function renderHighlights(highlights: HighlightedText[]): ReactNode {
	return highlights.map((node, i) => {
		const key = `${node.type}-${node.content}-${i}`;
		if (node.styles?.highlight) {
			return (
				<span key={key} className="text-fd-primary bg-fd-primary/10">
					{node.content}
				</span>
			);
		}
		return <Fragment key={key}>{node.content}</Fragment>;
	});
}

export function CustomSearchResultItem({
	result,
	className,
	renderHighlights: render = renderHighlights,
	onSelect,
	query,
	...props
}: ComponentProps<"button"> & {
	renderHighlights?: typeof renderHighlights;
	result: FumadocsReactSortedResult & {
		title?: string;
		filename?: string;
		section?: string;
		preview?: string;
	};
	onSelect?: () => void;
	query?: string;
}) {
	const handleClick = () => {
		if (onSelect) {
			onSelect();
		}
	};

	// Create highlighter for title and URL
	const getHighlighted = (text: string) => {
		if (!query || !text) return text;

		const { createContentHighlighter } = require("@/lib/search/shared");
		const highlighter = createContentHighlighter(query);
		const highlighted = highlighter.highlight(text);

		return render(highlighted);
	};

	// Extract filename from URL or use title
	const getDisplayTitle = () => {
		if (result.filename) return result.filename;
		if ((result as { title?: string }).title)
			return (result as { title?: string }).title;

		// Extract filename from URL as fallback
		const urlParts = result.url.split("/");
		const lastPart = urlParts[urlParts.length - 1];
		return lastPart || result.url;
	};

	// Get content preview (limit to ~150 characters)
	const getPreview = () => {
		if (result.contentWithHighlights) {
			return render(result.contentWithHighlights);
		}

		// Handle preview field or convert content to string
		const preview = (result as { preview?: string }).preview;
		if (preview) {
			return preview.length <= 150
				? preview
				: `${preview.substring(0, 147)}...`;
		}

		// Convert ReactNode content to string for preview
		const contentStr =
			typeof result.content === "string"
				? result.content
				: String(result.content || "");

		return contentStr.length <= 150
			? contentStr
			: `${contentStr.substring(0, 147)}...`;
	};

	return (
		<button
			type="button"
			className={cn(
				"relative flex flex-col items-start gap-2 p-4 text-start rounded-lg border border-transparent transition-all duration-200",
				"hover:bg-fd-accent hover:text-fd-accent-foreground hover:border-fd-border",
				"focus:outline-none focus:ring-2 focus:ring-fd-primary focus:ring-offset-2",
				"group w-full",
				className,
			)}
			onClick={handleClick}
			{...props}
		>
			{/* Header with title and type badge */}
			<div className="flex items-center justify-between w-full min-w-0">
				<div className="flex items-center gap-2 min-w-0 flex-1">
					{/* Title */}
					<h3 className="font-semibold text-sm truncate group-hover:text-fd-accent-foreground">
						{getHighlighted(getDisplayTitle() as string)}
					</h3>
				</div>

				{/* Type Badge */}
				{/*<span className="flex-shrink-0 text-xs bg-fd-muted text-fd-muted-foreground px-2 py-1 rounded-full">
					{result.type}
				</span>*/}
			</div>

			{/* URL/Path */}
			<div className="text-xs text-fd-muted-foreground truncate w-full font-mono">
				{getHighlighted(result.url)}
			</div>

			{/* Content Preview */}
			<div className="text-sm text-fd-popover-foreground/80 line-clamp-2 leading-relaxed">
				{getPreview()}
			</div>

			{/* Section Info */}
			{(result as { section?: string }).section && (
				<div className="text-xs text-fd-muted-foreground flex items-center gap-1">
					<span>in</span>
					<span className="font-medium">
						{(result as { section?: string }).section}
					</span>
				</div>
			)}
		</button>
	);
}
