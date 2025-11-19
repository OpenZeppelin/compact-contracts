"use client";

import { MonitorVersionSelector } from "../selectors/monitor-version-selector";
import { RelayerVersionSelector } from "../selectors/relayer-version-selector";
import { AlphaBanner } from "./alpha-banner";
import { MonitorDevelopmentBanner } from "./monitor-development-banner";
import { MonitorOldVersionBanner } from "./monitor-old-version-banner";
import { RelayerDevelopmentBanner } from "./relayer-development-banner";
import { RelayerOldVersionBanner } from "./relayer-old-version-banner";
import { VersionBanner } from "./version-banner";

export function Banners() {
	return (
		<>
			<AlphaBanner />
			<VersionBanner />
			<MonitorDevelopmentBanner />
			<MonitorOldVersionBanner />
			<MonitorVersionSelector />
			<RelayerDevelopmentBanner />
			<RelayerOldVersionBanner />
			<RelayerVersionSelector />
		</>
	);
}
