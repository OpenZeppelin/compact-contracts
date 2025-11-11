"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

export interface VersionConfig {
	label: string;
	value: string;
	path: string;
	isStable: boolean;
}

export interface VersionSelectorProps {
	/**
	 * The path prefix to check (e.g., "/monitor", "/relayer")
	 */
	pathPrefix: string;

	/**
	 * Array of available versions
	 */
	versions: VersionConfig[];

	/**
	 * Optional: Custom fallback version index when no version is detected
	 * Defaults to finding the "development" version or the last item
	 */
	fallbackVersionIndex?: number;
}

export function VersionSelector({
	pathPrefix,
	versions,
	fallbackVersionIndex,
}: VersionSelectorProps) {
	const pathname = usePathname();
	const router = useRouter();

	// Only show on pages matching the path prefix
	if (!pathname.startsWith(pathPrefix)) return null;

	// Detect current version from pathname
	const getCurrentVersion = () => {
		// Check if pathname includes a version slug
		const escapedPrefix = pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const versionMatch = pathname.match(
			new RegExp(`^${escapedPrefix}/([^/]+)`),
		);

		if (versionMatch && versionMatch[1] !== "") {
			const versionSlug = versionMatch[1];
			// Try to find matching version
			const version = versions.find((v) => v.value === versionSlug);
			if (version) return version;
		}

		// If no version in path, return development version or fallback
		const developmentVersion = versions.find((v) => v.value === "development");
		if (developmentVersion) return developmentVersion;

		// Use custom fallback index or last item
		const fallbackIndex =
			fallbackVersionIndex !== undefined
				? fallbackVersionIndex
				: versions.length - 1;

		return versions[fallbackIndex];
	};

	const currentVersion = getCurrentVersion();

	const handleVersionChange = (version: VersionConfig) => {
		let newPath: string;

		if (pathname === pathPrefix || pathname === `${pathPrefix}/`) {
			// On index page
			newPath = version.path;
		} else {
			// On subpage - preserve the subpage path
			const escapedPrefix = pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			// Match and remove only version patterns (e.g., /1.0.x/, /1.1.x/)
			// This regex removes prefix and optional version segment, keeping page paths
			const subPath = pathname.replace(
				new RegExp(`^${escapedPrefix}(?:/[\\d.]+x)?`),
				"",
			);
			newPath = version.path + (subPath || "");
		}

		router.push(newPath);
	};

	return (
		<Popover>
			<PopoverTrigger className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-fd-border bg-fd-background hover:bg-fd-accent/50 transition-colors">
				<span className="font-medium">{currentVersion.label}</span>
				<ChevronDown className="h-4 w-4 opacity-50" />
			</PopoverTrigger>
			<PopoverContent className="w-64 p-2">
				<div className="space-y-1">
					{versions.map((version) => (
						<button
							type="button"
							key={version.value}
							onClick={() => handleVersionChange(version)}
							className={`
                w-full text-left px-3 py-2 rounded-md text-sm transition-colors
                ${
									currentVersion.value === version.value
										? "bg-fd-primary text-fd-primary-foreground font-medium"
										: "hover:bg-fd-accent"
								}
              `}
						>
							<div className="flex items-center justify-between">
								<span>{version.label}</span>
								{currentVersion.value === version.value && (
									<svg
										className="h-4 w-4"
										fill="currentColor"
										viewBox="0 0 20 20"
										aria-label="Selected version"
									>
										<title>Selected version</title>
										<path
											fillRule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clipRule="evenodd"
										/>
									</svg>
								)}
							</div>
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
