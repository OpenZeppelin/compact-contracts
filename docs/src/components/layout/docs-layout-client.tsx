"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { baseOptions } from "@/app/layout.config";
import {
	ArbitrumIcon,
	EthereumIcon,
	MidnightIcon,
	PolkadotIcon,
	StarknetIcon,
	StellarIcon,
	UniswapIcon,
	ZamaIcon,
} from "@/components/icons";
import { DocsLayout } from "@/components/layout/docs";
import { useNavigationTree } from "@/hooks/use-navigation-tree";

interface DocsLayoutClientProps {
	children: ReactNode;
}

export function DocsLayoutClient({ children }: DocsLayoutClientProps) {
	const currentTree = useNavigationTree();
	const pathname = usePathname();

	// Determine if shared paths should be included in Stellar tab based on sessionStorage
	const tabs = useMemo(() => {
		// Don't show ecosystem tabs on impact pages
		if (pathname.startsWith("/impact")) {
			return [];
		}

		const isSharedPath =
			pathname.startsWith("/monitor") ||
			pathname.startsWith("/relayer") ||
			pathname.startsWith("/ui-builder");
		const lastEcosystem =
			typeof window !== "undefined"
				? sessionStorage.getItem("lastEcosystem")
				: null;

		// Include shared paths in Stellar tab only if coming from Stellar context
		const stellarUrls =
			isSharedPath && lastEcosystem === "stellar"
				? new Set(["/stellar-contracts", "/monitor", "/relayer", "/ui-builder"])
				: new Set(["/stellar-contracts"]);

		// Include shared paths in Polkadot tab only if coming from Polkadot context
		const polkadotUrls =
			isSharedPath && lastEcosystem === "polkadot"
				? new Set(["/substrate-runtimes", "/monitor", "/relayer"])
				: new Set(["/substrate-runtimes"]);

		const arbitrumStylusUrls =
			isSharedPath && lastEcosystem === "contracts-stylus"
				? new Set(["/contracts-stylus", "/monitor", "/relayer"])
				: new Set(["/contracts-stylus"]);

		return [
			{
				title: "Ethereum & EVM",
				url: "/contracts",
				icon: <EthereumIcon className="w-5 h-5" />,
				urls: new Set([
					"/contracts",
					"/community-contracts",
					"/upgrades-plugins",
					"/wizard",
					"/relayer",
					"/monitor",
					"/ui-builder",
					"/upgrades",
					"/defender",
					"/tools",
				]),
			},
			{
				title: "Arbitrum Stylus",
				url: "/contracts-stylus",
				icon: <ArbitrumIcon className="w-5 h-5" />,
				urls: arbitrumStylusUrls,
			},
			{
				title: "Starknet",
				url: "/contracts-cairo",
				icon: <StarknetIcon className="w-5 h-5" />,
			},
			{
				title: "Stellar",
				url: "/stellar-contracts",
				icon: <StellarIcon className="w-5 h-5" />,
				urls: stellarUrls,
			},
			{
				title: "Midnight",
				url: "/contracts-compact",
				icon: <MidnightIcon className="w-5 h-5" />,
			},
			{
				title: "Polkadot",
				url: "/substrate-runtimes",
				icon: <PolkadotIcon className="w-5 h-5" />,
				urls: polkadotUrls,
			},
			{
				title: "Uniswap Hooks",
				url: "/uniswap-hooks",
				icon: <UniswapIcon className="w-5 h-5" />,
			},
			{
				title: "Zama FHEVM",
				url: "/confidential-contracts",
				icon: <ZamaIcon className="w-5 h-5" />,
			},
		];
	}, [pathname]);

	return (
		<DocsLayout
			tree={currentTree}
			nav={{ ...baseOptions, mode: "top", transparentMode: "none" }}
			{...baseOptions}
			sidebar={{
				tabs,
			}}
		>
			{children}
		</DocsLayout>
	);
}
