"use client";

import {
	latestAlpha,
	latestStable,
} from "content/contracts-cairo/latest-versions";
import { Callout } from "fumadocs-ui/components/callout";
import Link from "next/link";
import { usePathname } from "next/navigation";

type AlphaTarget = {
	base: string;
	stableSegment?: string;
	stablePath?: string;
};

const ALPHA_TARGETS: AlphaTarget[] = [
	{ base: "/contracts", stableSegment: "5.x" },
	{ base: "/contracts-cairo", stableSegment: latestStable },
	{ base: "/contracts-stylus", stablePath: "/contracts-stylus" },
	{ base: "/stellar-contracts", stablePath: "/stellar-contracts" },
	{ base: "/substrate-runtimes", stablePath: "/substrate-runtimes" },
];

export function AlphaBanner() {
	const pathname = usePathname();
	const target = ALPHA_TARGETS.find(({ base }) =>
		pathname.startsWith(`${base}/alpha`),
	);

	if (!target) return null;

	const stableUrl = target.stableSegment
		? pathname.replace(
				`${target.base}/alpha`,
				`${target.base}/${target.stableSegment}`,
			)
		: (target.stablePath ?? target.base);

	return (
		<Link href={stableUrl} className="hover:underline transition-all">
			<Callout title="Alpha Version" type="warn">
				You're viewing an unaudited alpha version <code>v{latestAlpha}</code>.
				Click here to visit the latest stable release.
			</Callout>
		</Link>
	);
}
