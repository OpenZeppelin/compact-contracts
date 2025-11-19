"use client";

import { latestStable } from "content/monitor/latest-versions";
import { Callout } from "fumadocs-ui/components/callout";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MonitorOldVersionBanner() {
	const pathname = usePathname();

	// Only show on monitor pages
	if (!pathname.startsWith("/monitor")) return null;

	// Check if this is an old version (not latest stable)
	// Only match actual version patterns (e.g., 1.0.x, 2.1.x, etc.)
	const versionMatch = pathname.match(/^\/monitor\/([\d.]+x)/);

	if (!versionMatch) {
		// This is development version (no version in path), not old version
		return null;
	}

	const currentVersion = versionMatch[1];

	// Only show if this is NOT the latest stable version
	if (currentVersion === latestStable) {
		return null;
	}

	// Generate the latest version URL
	const latestVersionUrl = pathname.replace(
		`/monitor/${currentVersion}`,
		`/monitor/${latestStable}`,
	);

	return (
		<Link
			href={latestVersionUrl}
			className="inline-flex items-center gap-1 mt-2 text-sm font-medium hover:underline transition-all"
		>
			<Callout title="Outdated Version" type="warn">
				You're viewing an older version (v{currentVersion}). The latest
				documentation is available for the current version. Click here to visit
				latest version.
			</Callout>
		</Link>
	);
}
