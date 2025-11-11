"use client";

import { latestStable } from "content/relayer/latest-versions";
import { Callout } from "fumadocs-ui/components/callout";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function RelayerDevelopmentBanner() {
	const pathname = usePathname();

	// Only show on relayer pages at root (development version)
	if (!pathname.startsWith("/relayer")) return null;

	// Check if this is the development version (no version in path)
	// Only match actual version patterns (e.g., 1.0.x, 1.1.x, etc.)
	const versionMatch = pathname.match(/^\/relayer\/([\d.]+x)/);

	// If there's a version segment, don't show banner
	if (versionMatch) {
		return null;
	}

	// Generate the stable version URL by replacing the path
	const stableVersionUrl = pathname.replace(
		/^\/relayer/,
		`/relayer/${latestStable}`,
	);

	return (
		<Callout title="Development Documentation" type="info">
			You're viewing documentation for unreleased features from the main branch.
			For production use, see the{" "}
			<Link
				href={stableVersionUrl}
				className="underline hover:text-fd-primary transition-colors"
			>
				latest stable version (v{latestStable})
			</Link>
			.
		</Callout>
	);
}
