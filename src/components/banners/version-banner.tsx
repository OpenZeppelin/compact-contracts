"use client";

import { latestStable } from "content/contracts-cairo/latest-versions";
import { Callout } from "fumadocs-ui/components/callout";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function VersionBanner() {
	const pathname = usePathname();

	if (pathname.startsWith("/monitor") || pathname.startsWith("/relayer"))
		return null;
	// Check if this is a versioned page (contains version patterns)
	const versionMatch = pathname.match(/\/([\d.]+x?)(?:\/|$)/);

	if (!versionMatch) return null;

	const version = versionMatch[1];

	// Define current versions for each ecosystem
	const currentVersions: Record<string, { version: string; path: string }> = {
		contracts: { version: "5.x", path: "/contracts/5.x" },
		"cairo-contracts": { version: latestStable, path: "/cairo-contracts" },
		"contracts-stylus": { version: "latest", path: "/contracts-stylus" },
		"stellar-contracts": { version: "latest", path: "/stellar-contracts" },
		"substrate-runtimes": { version: "latest", path: "/substrate-runtimes" },
	};

	// Determine which ecosystem this page belongs to
	let ecosystem: string | null = null;
	let currentVersion: string | null = null;
	let currentPath: string | null = null;

	for (const [key, info] of Object.entries(currentVersions)) {
		if (pathname.includes(`/${key}/`)) {
			ecosystem = key;
			currentVersion = info.version;
			currentPath = info.path;
			break;
		}
	}

	if (!ecosystem || !currentVersion || !currentPath) return null;

	// Check if this is actually an old version
	const isOldVersion = version !== currentVersion && version !== "latest";

	if (!isOldVersion) return null;

	// Generate the current version URL by replacing the version in the path
	const currentVersionUrl = pathname.replace(
		`/${version}`,
		currentVersion === "latest" ? "" : `/${currentVersion}`,
	);

	return (
		<Link
			href={currentVersionUrl}
			className="inline-flex items-center gap-1 mt-2 text-sm font-medium hover:underline transition-all"
		>
			<Callout title="Outdated Version" type="warn">
				You're viewing an older version (v{version}) The latest documentation is
				available for the current version. Click here to visit latest version.
			</Callout>
		</Link>
	);
}
