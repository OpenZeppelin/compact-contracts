"use client";

import { latestStable } from "content/monitor/latest-versions";
import { Callout } from "fumadocs-ui/components/callout";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MonitorDevelopmentBanner() {
	const pathname = usePathname();

	// Only show on monitor pages at root (development version)
	if (!pathname.startsWith("/monitor")) return null;

	// Check if this is the development version (no version in path)
	// Only match actual version patterns
	const versionMatch = pathname.match(/^\/monitor\/([\d.]+x)/);
	// If there's a version segment , don't show banner
	if (versionMatch) {
		return null;
	}

	// Generate the stable version URL by replacing the path
	const stableVersionUrl = pathname.replace(
		/^\/monitor/,
		`/monitor/${latestStable}`,
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
